"""Stage `clock_1s` (tier 1): where each second is in time (docs/project/clock-spec.md;
roadmap decision 43).

Nothing here reads a price or a trade. Every value follows from the row's end, the exchange
calendar, and the product: the time of day in the product's market time zone, how far the
session is from its close, where the row stands against the product's main market hours, and
the day of the week.

**Sessions and dates.** A row belongs to the calendar session whose `(open, close]` holds its
end. The session's trade date is the local date of its close in the market time zone (a Sunday
evening session closes on Monday and belongs to Monday). The zone's offset from UTC is taken
once per session, at its close: the clocks change on a Sunday morning, when no session is open.

**Main hours** are those of the product's main cash or floor market, in the market time zone
(`MAIN_HOURS`). A product without an entry, and a session that does not contain the main open
(a holiday), has no main hours: the two distances are undefined and `in_main` is 0. The
distances are clock seconds, not row counts: "how long until the stock market opens".

The stage keeps no state and needs no warm-up. It is stored at the end of every ten-second row
(`pipeline.SPARSE_STEPS`); the engine computes every second.
"""

from datetime import UTC, datetime, time, timedelta
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import numpy as np

from .columns import BIGINT, DOUBLE, Column, Table
from .engine import MarketChunk
from .features import Unit
from .market import NS, PRODUCTS
from .stages import Stage

ZONE = "America/New_York"  # the market time zone of every product so far
# The main hours of each product's cash or floor market, in `ZONE`: metals, the former COMEX
# floor hours, when most volume trades and settlement prices are set; equity indices, the
# stock market's hours.
METALS, EQUITIES = (time(8, 20), time(13, 30)), (time(9, 30), time(16, 0))
MAIN_HOURS: dict[str, tuple[time, time]] = {
    "GC": METALS,
    "SI": METALS,
    "PL": METALS,
    "MGC": METALS,
    "ES": EQUITIES,
    "NQ": EQUITIES,
    "YM": EQUITIES,
    "RTY": EQUITIES,
}
DAY = 86_400
FEATURES = (
    ("tod_sin", Unit.RATIO, "Sine of the time of day in the market time zone, on a 24-hour circle"),
    ("tod_cos", Unit.RATIO, "Cosine of the time of day in the market time zone"),
    ("session_left_s", Unit.SECONDS, "Scheduled seconds until this session closes"),
    ("session_frac", Unit.RATIO, "Share of the session that has passed, 0 at the open to 1"),
    ("session_short", Unit.RATIO, "1 when the session is shorter than the usual one, else 0"),
    ("main_open_s", Unit.SECONDS, "Clock seconds since the main hours opened; negative before"),
    ("main_close_s", Unit.SECONDS, "Clock seconds since the main hours closed; negative before"),
    ("in_main", Unit.RATIO, "1 inside the product's main market hours, else 0"),
    ("weekday", Unit.RATIO, "Trade date's day of the week: Monday 0 to Friday 1"),
)
COLUMNS = (
    Column("slot_ordinal", BIGINT, "Index counter of the second"),
    Column("end_ns", BIGINT, "Row end, UTC ns"),
    *(Column(name, DOUBLE, text, unit.value) for name, unit, text in FEATURES),
)


def root_of(contract: str) -> str | None:
    """The product of a contract symbol such as GCZ6, or None for one that is not a known
    outright (a test's synthetic contract): it then has no main hours."""
    for root, product in sorted(PRODUCTS.items(), key=lambda kv: -len(kv[0])):
        if product.is_outright(contract):
            return root
    return None


def session_facts(open_ns: int, close_ns: int, hours: tuple[time, time] | None) -> tuple:
    """Of one session: the zone's offset from UTC in seconds, the weekday of its trade date
    (Monday 0), and the main open and close in UTC ns (None when the product has no main hours
    or the session does not contain the main open)."""
    zone = ZoneInfo(ZONE)
    closes = datetime.fromtimestamp(close_ns / NS, UTC).astimezone(zone)
    offset = int(closes.utcoffset().total_seconds())
    main = None
    if hours is not None:
        day = closes.date()
        start, stop = (datetime.combine(day, t, zone) for t in hours)
        if stop <= start:
            stop += timedelta(days=1)
        first, last = (round(t.timestamp()) * NS for t in (start, stop))
        if open_ns < first <= close_ns:
            main = (first, last)
    return offset, closes.weekday(), main


class ClockStage(Stage):
    NAME = "clock_1s"
    TIER = 1
    RESOLUTION = "1s"
    INPUTS = ("bar_1s",)  # for its rows' index counters and ends only
    MODULES = ("stages", "columns", "stage_clock", "market")
    COLUMNS: ClassVar[tuple[Column, ...]] = COLUMNS
    STATE = ()

    def __init__(self, context):
        super().__init__(context)
        lengths = context.calendar.closes - context.calendar.opens if context.calendar else []
        # the usual session: the most common length in the calendar
        values, counts = np.unique(lengths, return_counts=True)
        self.usual = int(values[np.argmax(counts)]) if len(values) else 0
        self.sessions: dict[int, tuple] = {}  # facts by session index; derived, not state

    def settings(self) -> dict[str, Any]:
        return {
            "zone": ZONE,
            "main_hours": {
                root: [t.isoformat(timespec="minutes") for t in hours]
                for root, hours in MAIN_HOURS.items()
            },
            "usual_session": "the most common session length in the calendar",
        }

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        base = products["tables"]["bar_1s"]
        ordinal, end = base.values["slot_ordinal"], base.values["end_ns"]
        n = len(end)
        cal = self.context.calendar
        out = {name: np.full(n, np.nan) for name, _, _ in FEATURES}
        if n:
            hours = MAIN_HOURS.get(root_of(chunk.contract) or "")
            index = np.searchsorted(cal.closes, end, side="left")
            for i in np.unique(index).tolist():
                rows = index == i
                o, c = int(cal.opens[i]), int(cal.closes[i])
                if i not in self.sessions:
                    self.sessions[i] = session_facts(o, c, hours)
                offset, weekday, main = self.sessions[i]
                e = end[rows]
                angle = 2.0 * np.pi * (((e // NS) + offset) % DAY) / DAY
                out["tod_sin"][rows], out["tod_cos"][rows] = np.sin(angle), np.cos(angle)
                out["session_left_s"][rows] = (c - e) / NS
                out["session_frac"][rows] = (e - o) / (c - o)
                out["session_short"][rows] = float(c - o < self.usual)
                out["weekday"][rows] = min(weekday, 4) / 4.0
                out["in_main"][rows] = 0.0
                if main is not None:
                    out["main_open_s"][rows] = (e - main[0]) / NS
                    out["main_close_s"][rows] = (e - main[1]) / NS
                    out["in_main"][rows] = ((e > main[0]) & (e <= main[1])).astype(np.float64)
        nulls = {name: np.isnan(v) for name, v in out.items() if np.isnan(v).any()}
        return Table({"slot_ordinal": ordinal, "end_ns": end} | out, nulls)
