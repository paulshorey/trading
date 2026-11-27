"""Product calendars and their source-local rules for dated futures research."""

import csv
import hashlib
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import cache, lru_cache
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pandas_market_calendars as mcal

from .features import FeatureSpec, Unit
from .market import NS, PRODUCTS

DAY = timedelta(days=1)
DATA = Path(__file__).with_name("schedules")
METALS = ("GC", "SI", "PL", "MGC")
EQUITIES = ("ES", "NQ", "RTY", "YM")
PROFILES = {"metals": METALS, "equities": EQUITIES, "all": METALS + EQUITIES}


@dataclass(frozen=True)
class Rule:
    event: str
    profile: str
    venue: str
    zone: str
    local_time: str
    calendar: str
    anchor: str
    source: str
    valid_from: date
    valid_through: date

    def applies(self, day: date) -> bool:
        return self.valid_from <= day <= self.valid_through


def _read(name):
    with (DATA / name).open() as stream:
        return list(csv.DictReader(stream))


RULES = tuple(
    Rule(**(row | {key: date.fromisoformat(row[key]) for key in ("valid_from", "valid_through")}))
    for row in _read("rules.csv")
)
START = min(r.valid_from for r in RULES)
END = max(r.valid_through for r in RULES)

BY_EVENT = {r.event: r for r in sorted(RULES, key=lambda rule: rule.valid_from)}
for rule in RULES:
    if (
        rule.valid_through < rule.valid_from
        or sum(r.event == rule.event and r.applies(rule.valid_from) for r in RULES) != 1
    ):
        raise ValueError(f"Invalid or overlapping clock rule {rule.event} on {rule.valid_from}")


@cache
def rule_on(event, day):
    return next(r for r in RULES if r.event == event and r.applies(day))


PUBLISHED = _read("published.csv")
DATED_KEYS = frozenset(row["event"] for row in PUBLISHED)
ACTIVE = tuple(r for r in BY_EVENT.values() if r.calendar != "published" or r.event in DATED_KEYS)
NAMES = tuple(f"clock.{r.event}_s" for r in ACTIVE)
EVENT_SPECS = tuple(
    FeatureSpec(name, Unit.SECONDS, f"Seconds since {rule.event} in this futures session")
    for name, rule in zip(NAMES, ACTIVE, strict=True)
)
SPECS = (
    *EVENT_SPECS,
    FeatureSpec("clock.short_globex_session", Unit.RATIO, "Session shorter than 23 hours"),
)


def edition_digest() -> str:
    digest = hashlib.sha256()
    for path in (Path(__file__), DATA / "rules.csv", DATA / "published.csv"):
        digest.update(path.read_bytes())
    for root in PROFILES["all"]:
        digest.update(f"{root}={PRODUCTS[root].calendar}".encode())
    for package in ("pandas", "tzdata", "pandas-market-calendars", "exchange-calendars"):
        digest.update(f"{package}={version(package)}".encode())
    return digest.hexdigest()


EDITION = edition_digest()


@cache
def zone(name):
    # Read the pinned wheel even when the host's zoneinfo database is present.
    with files("tzdata.zoneinfo").joinpath(*name.split("/")).open("rb") as stream:
        return ZoneInfo.from_file(stream, key=name)


def instant(day: date, wall: time, name: str) -> pd.Timestamp:
    return (
        pd.Timestamp(datetime.combine(day, wall))
        .tz_localize(zone(name), ambiguous="raise", nonexistent="raise")
        .tz_convert("UTC")
    )


@dataclass(frozen=True)
class Occurrence:
    event: str
    trade_date: date  # venue label, including Monday for an ordinary Friday SHFE night
    at: pd.Timestamp
    source: str
    known_at: pd.Timestamp | None = None


@cache
def schedule(name, year):
    return mcal.get_calendar(name).schedule(f"{year}-01-01", f"{year}-12-31")


# SGE's published exchange holidays and pre-holiday night closures.
SGE_HOLIDAYS = "https://en.sge.com.cn/eng_news_Announcement/10002445"
SGE_BREAKS = (
    ("2026-01-01", "2026-01-04"),
    ("2026-02-15", "2026-02-23"),
    ("2026-04-04", "2026-04-06"),
    ("2026-05-01", "2026-05-05"),
    ("2026-06-19", "2026-06-21"),
    ("2026-09-25", "2026-09-27"),
    ("2026-10-01", "2026-10-07"),
)


def wall_occurrence(rule, day, *, on=None, shift=0, source=None):
    wall = datetime.combine(on or day, time.fromisoformat(rule.local_time)) + timedelta(
        minutes=shift
    )
    return Occurrence(
        rule.event, day, instant(wall.date(), wall.time(), rule.zone), source or rule.source
    )


def cme_rule(rule, row, day):
    regular = row.market_close - row.market_open == pd.Timedelta(hours=23)
    shift = 0
    source = rule.source
    if not regular:
        # Only these abbreviated sessions have verified settlement notices in this edition.
        holiday = {
            (2025, 11, 28): "thanksgiving",
            (2026, 11, 27): "thanksgiving",
            (2025, 12, 24): "christmas",
            (2026, 12, 24): "christmas",
        }.get((day.year, day.month, day.day))
        if not holiday or (rule.calendar == "regular_metals" and rule.event != "gc_tas_end"):
            return None
        shift = (
            -180 if rule.calendar == "index_settlement" else -60 if holiday == "christmas" else 0
        )
        source = f"https://www.cmegroup.com/tools-information/holiday-calendar/files/{day.year}/{holiday}-holiday-settlement-times-{day.year}.pdf"
        if rule.event == "gc_tas_end":
            source = "https://www.cmegroup.com/trading-hours.html"
    occurrence = wall_occurrence(rule, day, shift=shift, source=source)
    return occurrence if row.market_open <= occurrence.at <= row.market_close else None


def shanghai_gold(day, rules):
    if any(a <= day.isoformat() <= b for a, b in SGE_BREAKS):
        return
    previous = day - timedelta(days=3 if day.weekday() == 0 else 1)
    # Only a weekend may separate the previous night segment and today's day session.
    # The first weekday after an exchange holiday starts with the day segment.
    no_night = any(previous.isoformat() <= b < day.isoformat() for _, b in SGE_BREAKS)
    source = (
        SGE_HOLIDAYS if day.year == 2026 else "https://en.sge.com.cn/eng_news_Announcement/10002127"
    )
    for rule in rules:
        local_day = day
        if rule.anchor:
            if no_night:
                continue
            local_day = previous + DAY if rule.anchor == "overnight_end" else previous
        yield wall_occurrence(rule, day, on=local_day, source=source)


UK_CLOSURES = frozenset(
    [
        "2025-12-25",
        "2025-12-26",
        "2026-01-01",
        "2026-04-03",
        "2026-04-06",
        "2026-05-04",
        "2026-05-25",
        "2026-08-31",
        "2026-12-25",
        "2026-12-28",
    ]
)


def london(day, rules, calendar):
    if calendar == "wmr":
        # LSEG's 2026 service alterations for the 16:00 London spot fix.
        if day.year != 2026 or day.isoformat() in ("2026-01-01", "2026-04-03", "2026-12-25"):
            return
    elif day.isoformat() in UK_CLOSURES:
        return
    for rule in rules:
        eve = day.month == 12 and day.day in (24, 31)
        if eve and calendar == "lme":
            if day.year != 2025 or rule.event in (
                "lme_cu_afternoon",
                "lme_cu_afternoon_end",
                "lme_cu_kerb_end",
            ):
                continue
            yield wall_occurrence(
                rule,
                day,
                shift=-140 if rule.event == "lme_ring_close" else 0,
                source="https://www.lme.com/api/sitecore/MemberNoticesSearchApi/Download?id=da38fa69-e11a-4e11-8d2a-07721f5a8256",
            )
            continue
        if eve and rule.event.endswith("_pm"):
            continue
        yield wall_occurrence(rule, day)


@cache
def globex_trade_date(day):
    # Until CME's 2026-06-19 Globex change, a traded Friday holiday kept
    # Friday's electronic trade date. Afterward it uses the next clearing date.
    if day.weekday() == 4 and day < date(2026, 6, 19):
        return day
    labels = schedule("CME_TradeDate", day.year).index
    i = labels.searchsorted(pd.Timestamp(day))
    if i == len(labels):
        return schedule("CME_TradeDate", day.year + 1).index[0].date()
    return labels[i].date()


def _calendar_records(calendar, year, product_calendar):
    rules = [
        r
        for r in RULES
        if r.calendar == calendar and r.valid_from.year <= year <= r.valid_through.year
    ]
    if not rules:
        return
    if calendar == "osaka":
        if year != 2026:
            return
        # Holiday trading shares the next regular JPX clearing date. Bounds here
        # are venue trading dates, so include the previous regular day's night.
        regular = schedule("JPX", year).index
        for local in pd.bdate_range("2025-12-30", "2026-12-30"):
            day = local.date()
            if day.isoformat() in ("2025-12-31", "2026-01-01", "2026-01-02", "2026-11-23"):
                continue
            for rule in rules:
                night = rule.anchor in ("night", "overnight_end")
                idx = regular.searchsorted(local, side="right" if night else "left")
                if idx >= len(regular) or (day.year < year and not night):
                    continue
                on = day + DAY if rule.anchor == "overnight_end" else day
                yield wall_occurrence(
                    rule,
                    regular[idx].date(),
                    on=on,
                    source="https://www.jpx.co.jp/english/derivatives/rules/holidaytrading/",
                )
        return
    if calendar == "published":
        for row in PUBLISHED:
            day = date.fromisoformat(row["trade_date"])
            if day.year == year:
                r = rule_on(row["event"], day)
                yield Occurrence(
                    r.event,
                    day,
                    instant(day, time.fromisoformat(row["local_time"]), r.zone),
                    row["source"],
                    pd.Timestamp(row["known_at"]).tz_convert("UTC"),
                )
        return
    if calendar in ("sge", "bullion", "lme", "wmr"):
        for ts in pd.bdate_range(max(START, date(year, 1, 1)), min(END, date(year, 12, 31))):
            day = ts.date()
            if calendar == "sge":
                yield from shanghai_gold(day, [r for r in rules if r.applies(day)])
            else:
                yield from london(day, [r for r in rules if r.applies(day)], calendar)
        return
    exchange = {
        "product": product_calendar,
        "regular_metals": "CMEGlobex_GC",
        "metal_settlement": "CMEGlobex_GC",
        "index_settlement": PRODUCTS["ES"].calendar,
    }.get(calendar, calendar)
    for row in schedule(exchange, year).itertuples():
        day = row.Index.date()
        if not START <= day <= END:
            continue
        trade_date = globex_trade_date(day) if calendar == "product" else day
        for r in rules:
            if not r.applies(trade_date):
                continue
            if calendar in ("regular_metals", "metal_settlement", "index_settlement"):
                item = cme_rule(r, row, day)
                if item:
                    yield item
                continue
            anchor = r.anchor
            if calendar in ("SHFE_AU", "SHFE_CU"):
                has_night = row.market_open < row.day_open
                if not has_night and (
                    anchor in ("market_open", "night_close") or anchor.startswith("night_")
                ):
                    continue
                # One opening call auction, in the first segment actually traded.
                if has_night and anchor.startswith("day_minus"):
                    continue
            offsets = {
                "close_minus_10m": ("market_close", 10),
                "night_minus_5m": ("market_open", 5),
                "night_minus_1m": ("market_open", 1),
                "day_minus_5m": ("day_open", 5),
                "day_minus_1m": ("day_open", 1),
            }
            field, minutes = offsets.get(anchor, (anchor, 0))
            # The calendar supplies actual dates and holiday hours. Re-localize its wall time
            # using the pinned release, including each end of an overnight session separately.
            local = (getattr(row, field) - pd.Timedelta(minutes=minutes)).tz_convert(
                mcal_zone(exchange)
            )
            yield Occurrence(
                r.event, trade_date, instant(local.date(), local.time(), r.zone), r.source
            )


@cache
def mcal_zone(exchange):
    return mcal.get_calendar(exchange).tz


@cache
def records(calendar, year, product_calendar=""):
    items = sorted(_calendar_records(calendar, year, product_calendar), key=lambda item: item.at)
    return tuple(item.at.value for item in items), tuple(items)


@lru_cache(maxsize=2048)
def session_events(root, opened, closed):
    """Intersect venue occurrences with the actual UTC futures session, including its open."""
    if root not in METALS + EQUITIES:
        return ()
    first = datetime.fromtimestamp(opened // NS, UTC).date()
    last = datetime.fromtimestamp(closed // NS, UTC).date()
    found = []
    # A Friday-night occurrence may belong to a venue trade date in the next year.
    for year in range(
        max(START.year, (first - DAY).year), min(END.year, (last + timedelta(days=7)).year) + 1
    ):
        for cal in dict.fromkeys(r.calendar for r in ACTIVE if root in PROFILES[r.profile]):
            ticks, items = records(cal, year, PRODUCTS[root].calendar if cal == "product" else "")
            for item in items[bisect_left(ticks, opened) : bisect_right(ticks, closed)]:
                if root in PROFILES[rule_on(item.event, item.trade_date).profile]:
                    found.append(item)
    return tuple(sorted(found, key=lambda item: item.at))


def feature_values(root, calendar, ends):
    """Identical end-of-row join for persisted training rows and the live engine."""
    n = len(ends)
    missing = np.full(n, np.nan)
    out = dict.fromkeys(NAMES, missing)
    indices = np.searchsorted(calendar.closes, ends)
    if n and indices[0] == indices[-1] and (n == 1 or np.all(indices == indices[0])):
        i = indices[0]
        opened, closed = int(calendar.opens[i]), int(calendar.closes[i])
        for item in session_events(root, opened, closed):
            distance = (ends - item.at.value) / NS
            if item.known_at is not None:
                distance[ends < item.known_at.value] = np.nan
            name = f"clock.{item.event}_s"
            previous = out[name]
            if previous is not missing:
                # Several speeches or release windows can share one session. Keep the
                # nearest known instant. Earlier wins at the midpoint between two.
                nearer = np.isnan(previous) | (np.abs(distance) < np.abs(previous))
                distance = np.where(nearer, distance, previous)
            out[name] = distance
        out["clock.short_globex_session"] = (
            np.full(n, float(closed - opened < 23 * 3600 * NS))
            if root in PROFILES["all"]
            else missing
        )
        return out
    out["clock.short_globex_session"] = missing
    for i in np.unique(indices):
        rows = indices == i
        for name, values in feature_values(root, calendar, ends[rows]).items():
            if np.isnan(values).all():
                continue
            if out[name] is missing:
                out[name] = np.full(n, np.nan)
            out[name][rows] = values
    return out
