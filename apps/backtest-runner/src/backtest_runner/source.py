"""Historical market chunks from Databento MBP-1 files.

Each chunk is one session of one contract: the trades, and for a session that trades the
book events, a live session would have assigned to that session's slots.
`strategy_core.engine.split_by_second` turns a session into the one-second chunks a live
session processes.
"""

from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import NamedTuple

import databento as db
import numpy as np
from strategy_core.bars import assignment_ns, assignment_times
from strategy_core.engine import MarketChunk
from strategy_core.execution import ExecutionConfig
from strategy_core.market import (
    ACTION_TRADE,
    F_BAD_TS_RECV,
    F_MAYBE_BAD_BOOK,
    NS,
    UNDEF_PRICE,
    UNDEF_SIZE,
    BookEvents,
    Product,
    Trades,
)

from .calendars import Session
from .catalog import MARKET, DbnFile, verify

SIDES = {b"B": 1, b"A": -1}  # Databento: B = bid or buyer aggressor, A = ask or seller aggressor
DAY = 86_400 * NS


class Day(NamedTuple):
    trades: np.ndarray  # the day's trade records (`action == "T"`), all instruments
    records: np.ndarray | None  # every record of the day, when the cache keeps books
    mappings: dict


class DayCache:
    """Decoded MBP-1 days (all instruments) with their symbol mappings, least recently used.
    A day's trade records are a few percent of its file. Every record is kept only when
    `book` is set (backtests, which fill orders at the book): ingestion reads trades alone,
    so its workers hold little memory."""

    def __init__(self, size: int = 4, book: bool = False):
        self.size, self.book, self.items = size, book, OrderedDict()

    def get(self, file: DbnFile) -> Day:
        key = file.path
        if key not in self.items:
            verify(file)
            store = db.DBNStore.from_file(file.path)
            if store.metadata.schema != MARKET:
                raise ValueError(f"{file.path.name} holds {store.metadata.schema}, not {MARKET}")
            records = store.to_ndarray()
            trades = records[records["action"] == b"T"]
            self.items[key] = Day(trades, records if self.book else None, store.mappings)
            while len(self.items) > self.size:
                self.items.popitem(last=False)
        self.items.move_to_end(key)
        return self.items[key]


def instrument_id(mappings: dict, symbol: str, day: date) -> int | None:
    """Instrument IDs are unique only within a day; resolve the raw symbol for this date."""
    for interval in mappings.get(symbol, []):
        if interval["start_date"] <= day < interval["end_date"]:
            return int(interval["symbol"])
    return None


def to_trades(records: np.ndarray) -> Trades:
    side = np.zeros(len(records), np.int8)
    for code, value in SIDES.items():
        side[records["side"] == code] = value
    return Trades(
        ts_event=records["ts_event"].astype(np.int64),
        ts_recv=records["ts_recv"].astype(np.int64),
        price=records["price"].astype(np.int64),
        size=records["size"].astype(np.int64),
        side=side,
        bid=records["bid_px_00"].astype(np.int64),
        ask=records["ask_px_00"].astype(np.int64),
        bid_size=records["bid_sz_00"].astype(np.int64),
        ask_size=records["ask_sz_00"].astype(np.int64),
        bid_count=records["bid_ct_00"].astype(np.int64),
        ask_count=records["ask_ct_00"].astype(np.int64),
        flags=records["flags"].astype(np.uint8),
    )


def to_book(records: np.ndarray) -> BookEvents:
    side = np.zeros(len(records), np.int8)
    for code, value in SIDES.items():
        side[records["side"] == code] = value
    return BookEvents(
        ts_event=records["ts_event"].astype(np.int64),
        ts_recv=records["ts_recv"].astype(np.int64),
        action=records["action"].view(np.uint8).copy(),
        side=side,
        price=records["price"].astype(np.int64),
        size=records["size"].astype(np.int64),
        bid=records["bid_px_00"].astype(np.int64),
        ask=records["ask_px_00"].astype(np.int64),
        bid_size=records["bid_sz_00"].astype(np.int64),
        ask_size=records["ask_sz_00"].astype(np.int64),
        bid_count=records["bid_ct_00"].astype(np.int64),
        ask_count=records["ask_ct_00"].astype(np.int64),
        flags=records["flags"].astype(np.uint8),
    )


def utc_day(ns: int) -> date:
    return datetime.fromtimestamp(ns // NS, UTC).date()


def day_ns(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()) * NS


@dataclass
class HistoricalSource:
    product: Product
    files: dict[date, DbnFile]
    warmup: list[Session]
    trading: list[Session]
    config: ExecutionConfig
    contract: str | None = None  # explicit raw symbol, or None for the front contract
    cache: DayCache = field(default_factory=DayCache)
    quality: dict[str, dict] = field(default_factory=dict)
    used_files: dict[str, DbnFile] = field(default_factory=dict)
    kept_front: set[date] = field(default_factory=set)  # rolls skipped for incomplete data
    # Sessions a contract replays before it trades after a roll. None: as many as `warmup`
    # holds. It is its own number because `warmup` may hold fewer: a session that was not
    # downloaded whole is left out of it, as storage leaves it out.
    roll_warmup: int | None = None

    def chunks(self) -> Iterator[MarketChunk]:
        sessions = [*self.warmup, *self.trading]
        start = len(self.warmup)
        lead = len(self.warmup) if self.roll_warmup is None else self.roll_warmup
        previous = None
        for i in range(start, len(sessions)):
            s = sessions[i]
            contract = self.contract or self.front_contract(
                sessions[i - 1] if i else None, s, previous
            )
            if contract != previous:
                for w in sessions[max(i - lead, 0) : i]:
                    yield self.session_chunk(contract, w, tradable=False)
                previous = contract
            yield self.session_chunk(contract, s, tradable=True)

    def day_files(self, session: Session) -> list[tuple[date, DbnFile | None]]:
        """UTC day files that can hold the session's trades, from the closure before it to
        late arrivals after its close."""
        first = utc_day(session.after)
        last = utc_day(session.close + self.config.close_delay)
        days = [first + timedelta(days=k) for k in range((last - first).days + 1)]
        return [(d, self.files.get(d)) for d in days]

    def session_trades(
        self, symbol: str, session: Session
    ) -> tuple[Trades, np.ndarray, list[date], dict[str, int]]:
        """A contract's trades for a session in receive order, its covered intervals, the days
        whose files do not list the contract, and the session's rejected trade records. A
        file covers its UTC day only inside its job's requested range (`DbnFile.window`).

        A trade record is accepted only with a defined price and a positive, defined size (a
        price may be zero or negative); rejected records are counted, never aggregated.

        A trade belongs to the session whose `[after, close)` holds its assignment time (the
        rule in `strategy_core.bars`), so opening trades that arrive within the close delay
        stay in the first second and trades during the preceding closure reach aggregation,
        which reports them as outside the schedule. A day counts as covered only when its
        file is usable and lists the contract."""
        parts, coverage, unmapped = [], [], []
        for day, file in self.day_files(session):
            if file is None or not file.covered:
                continue
            records, _, mappings = self.cache.get(file)
            self.used_files[file.path.name] = file
            iid = instrument_id(mappings, symbol, day)
            if iid is None:
                unmapped.append(day)
                continue
            window = file.window  # the day, bounded by the job's requested range
            if window[0] >= window[1]:
                continue
            coverage.append(window)
            parts.append(to_trades(records[records["instrument_id"] == iid]))
        trades = Trades.concat(parts)
        assign = assignment_times(trades, self.config.feed_latency, self.config.close_delay)
        inside = (assign >= session.after) & (assign < session.close)
        undefined, empty = trades.price == UNDEF_PRICE, trades.size <= 0
        unset = trades.size == UNDEF_SIZE  # Databento's sentinel for an absent size
        rejected = {
            "undefined_price": int(np.sum(inside & undefined)),
            "nonpositive_size": int(np.sum(inside & empty)),
            "undefined_size": int(np.sum(inside & unset)),
        }
        keep = inside & ~undefined & ~empty & ~unset
        return trades.take(keep), np.array(coverage, np.int64).reshape(-1, 2), unmapped, rejected

    def session_book(self, symbol: str, session: Session) -> BookEvents:
        """Every MBP-1 record of a contract assigned to the session, in receive order, from the
        same files and by the same rule as `session_trades`. Records of the closure before
        the session are included: they build the book the session opens with. Nothing is
        rejected here; a fill checks the book it reads."""
        parts = []
        for day, file in self.day_files(session):
            if file is None or not file.covered:
                continue
            _, records, mappings = self.cache.get(file)
            iid = instrument_id(mappings, symbol, day)
            window = file.window
            if iid is None or window[0] >= window[1]:
                continue
            parts.append(to_book(records[records["instrument_id"] == iid]))
        book = BookEvents.concat(parts)
        assign = assignment_ns(
            book.ts_event, book.ts_recv, self.config.feed_latency, self.config.close_delay
        )
        return book.take((assign >= session.after) & (assign < session.close))

    def stored_chunk(
        self, contract: str, session: Session
    ) -> tuple[MarketChunk, Trades, list[date], dict[str, int]]:
        """The chunk ingestion stores for a contract's session, with its trades, the days whose
        files do not list the contract, and its rejected records. Part of the source identity:
        what each stage reads comes from here. It carries the book events when the cache keeps
        them, which a stage that reads the book will need."""
        trades, coverage, unmapped, rejected = self.session_trades(contract, session)
        book = self.session_book(contract, session) if self.cache.book else None
        label = f"{session.trade_date} {contract}"
        chunk = MarketChunk(
            contract, session.open, session.close, trades, coverage, label, True, book
        )
        return chunk, trades, unmapped, rejected

    def session_chunk(self, contract: str, session: Session, tradable: bool) -> MarketChunk:
        """A session's chunk. A session that trades carries its book events when the cache
        keeps them; a warm-up session only builds features, which read trades."""
        trades, coverage, unmapped, rejected = self.session_trades(contract, session)
        book = self.session_book(contract, session) if tradable and self.cache.book else None
        label = f"{session.trade_date} {contract}" + ("" if tradable else " (warmup)")
        self.quality[label] = {
            **raw_quality(trades),
            **(book_quality(book) if book is not None else {}),
            "rejected_trades": rejected,
            "contract_unmapped_days": [d.isoformat() for d in unmapped],
            "front_kept_for_incomplete_data": session.trade_date in self.kept_front,
        }
        return MarketChunk(
            contract, session.open, session.close, trades, coverage, label, tradable, book
        )

    def front_contract(
        self, previous: Session | None, session: Session, current: str | None = None
    ) -> str:
        """The outright with the most volume in the previous session, switching at the open
        and only to a later delivery month (`next_front`). Partial data never decides a roll:
        without complete volume the current contract is kept, and with no current contract
        the run cannot start."""
        volumes = self.outright_volumes(previous) if previous is not None else None
        front, basis = next_front(self.product, volumes, current, session.trade_date)
        if basis == "kept":
            self.kept_front.add(session.trade_date)
        if front is not None:
            return front
        raise ValueError(
            f"Cannot choose the {self.product.root} front contract for {session.trade_date} "
            "without complete data for the previous session; set `contract` (for example "
            "GCZ6) or add a warmup session with data."
        )

    def outright_volumes(self, session: Session) -> dict[str, int] | None:
        """Volume per outright from trades assigned to the session's scheduled hours
        (`[open, close)`; closure records are excluded, as aggregation excludes them). Returns
        None when a day file overlapping those hours is missing, uncovered, covers only part of
        them, or lists none of the product's outrights, so partial data never decides a roll.
        Files read here count as run inputs. The CME calendars used here have no breaks inside
        a session."""
        volumes, complete = self.session_volumes(session)
        return volumes if complete else None

    def session_volumes(
        self, session: Session, *, partial: bool = False
    ) -> tuple[dict[str, int], bool]:
        """Outright volumes of the session's scheduled hours and whether the data is complete.
        Without `partial`, reading stops at the first incomplete day (as `outright_volumes`
        needs); with it, the available days are summed, for a contract's own extent."""
        volumes: dict[str, int] = {}
        complete = True
        for day, file in self.day_files(session):
            lo, hi = day_ns(day), day_ns(day) + DAY
            scheduled = (max(lo, session.open), min(hi, session.close))
            overlaps = scheduled[0] < scheduled[1]
            usable = file is not None and file.covered
            if usable:
                window = file.window
                usable = window[0] < window[1]
            if not usable or (
                overlaps and not (window[0] <= scheduled[0] and scheduled[1] <= window[1])
            ):
                if overlaps:
                    complete = False
                    if not partial:
                        return {}, False
                if not usable:
                    continue
            records, _, mappings = self.cache.get(file)
            self.used_files[file.path.name] = file
            ids = {
                symbol: iid
                for symbol in mappings
                if self.product.is_outright(symbol)
                and (iid := instrument_id(mappings, symbol, day)) is not None
            }
            if not ids:
                if overlaps:
                    complete = False
                    if not partial:
                        return {}, False
                continue
            assign = assignment_ns(
                records["ts_event"].astype(np.int64),
                records["ts_recv"].astype(np.int64),
                self.config.feed_latency,
                self.config.close_delay,
            )
            in_session = (
                (assign >= session.open)
                & (assign < session.close)
                & (records["price"] != UNDEF_PRICE)  # the same accepted trades as aggregation
                & (records["size"] > 0)
                & (records["size"] != UNDEF_SIZE)
            )
            for symbol, iid in ids.items():
                sel = in_session & (records["instrument_id"] == iid)
                volumes[symbol] = volumes.get(symbol, 0) + int(records["size"][sel].sum())
        return {k: v for k, v in volumes.items() if v > 0}, complete


def front_of(volumes: dict[str, int]) -> str:
    """The outright with the most volume; an exact tie goes to the first symbol in order."""
    return max(sorted(volumes), key=volumes.get)


def next_front(
    product: Product, volumes: dict[str, int] | None, current: str | None, on: date
) -> tuple[str | None, str]:
    """The roll rule shared by backtests and stored rows: the front contract of the session
    on `on` and why. `volumes` are the previous session's outright volumes, or None when its
    data is incomplete. The front only moves to a later delivery month, so the most volume
    returning to an expiring month never rolls back.

    Bases: `previous_session` (most volume), `forward_only` (the most volume was an earlier
    month; the current front is kept), `kept` (incomplete data), or "" with no front."""
    if volumes:
        best = front_of(volumes)
        if (
            current is not None
            and best != current
            and product.contract_month(best, on) < product.contract_month(current, on)
        ):
            return current, "forward_only"
        return best, "previous_session"
    if current is not None:
        return current, "kept"
    return None, ""


def raw_quality(t: Trades) -> dict:
    """Receive-order checks on the raw trades of one session."""
    n = len(t)
    book_ok = (t.bid != UNDEF_PRICE) & (t.ask != UNDEF_PRICE) & (t.bid <= t.ask)
    outside = book_ok & ((t.price > t.ask) | (t.price < t.bid))
    return {
        "trades": n,
        "event_time_inversions": int(np.sum(np.diff(t.ts_event) < 0)) if n else 0,
        "receive_order_violations": int(np.sum(np.diff(t.ts_recv) < 0)) if n else 0,
        "bad_ts_recv_flag": int(np.sum((t.flags & F_BAD_TS_RECV) > 0)),
        "maybe_bad_book_flag": int(np.sum((t.flags & F_MAYBE_BAD_BOOK) > 0)),
        "no_book": int(np.sum(~book_ok)),
        "outside_pre_trade_book": int(np.sum(outside)),
        "median_receive_lag_us": float(np.median(t.ts_recv - t.ts_event) / 1e3) if n else None,
    }


def book_quality(b: BookEvents) -> dict:
    """Checks on a session's book events. A crossed book (bid above ask) is never filled at."""
    two_sided = (b.bid != UNDEF_PRICE) & (b.ask != UNDEF_PRICE)
    quotes = b.action != ACTION_TRADE
    return {
        "book_events": len(b),
        "book_changes": int(np.sum(quotes)),
        "book_one_sided": int(np.sum(quotes & ~two_sided)),
        "book_crossed": int(np.sum(quotes & two_sided & (b.bid > b.ask))),
        "book_maybe_bad_flag": int(np.sum(quotes & ((b.flags & F_MAYBE_BAD_BOOK) > 0))),
    }
