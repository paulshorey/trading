"""Historical market chunks from Databento TBBO files.

Each chunk is one session of one contract: the trades a live session would have
assigned to that session's slots. `strategy_core.engine.split_by_second` turns a
session into the one-second chunks a live session processes.
"""

from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import databento as db
import numpy as np
from strategy_core.engine import MarketChunk
from strategy_core.execution import ExecutionConfig
from strategy_core.market import NS, UNDEF_PRICE, Product, Trades

from .calendars import Session
from .catalog import DbnFile, verify

F_BAD_TS_RECV, F_MAYBE_BAD_BOOK = 1 << 3, 1 << 2
SIDES = {b"B": 1, b"A": -1}  # Databento: B = buyer aggressor, A = seller aggressor
DAY = 86_400 * NS


class DayCache:
    """Decoded TBBO days (all instruments) with their symbol mappings, least recently used."""

    def __init__(self, size: int = 4):
        self.size, self.items = size, OrderedDict()

    def get(self, file: DbnFile) -> tuple[np.ndarray, dict]:
        key = file.path
        if key not in self.items:
            verify(file)
            store = db.DBNStore.from_file(file.path)
            self.items[key] = (store.to_ndarray(), store.mappings)
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
        flags=records["flags"].astype(np.uint8),
    )


def utc_day(ns: int) -> date:
    return datetime.fromtimestamp(ns // NS, UTC).date()


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

    def chunks(self) -> Iterator[MarketChunk]:
        sessions = [*self.warmup, *self.trading]
        start = len(self.warmup)
        previous = None
        for i in range(start, len(sessions)):
            s = sessions[i]
            contract = self.contract or self.front_contract(sessions[i - 1] if i else None, s)
            if contract != previous:
                for w in sessions[max(i - len(self.warmup), 0) : i]:
                    yield self.session_chunk(contract, w, tradable=False)
                previous = contract
            yield self.session_chunk(contract, s, tradable=True)

    def day_files(self, session: Session) -> list[tuple[date, DbnFile | None]]:
        first, last = utc_day(session.open), utc_day(session.close - 1)
        days = [first + timedelta(days=k) for k in range((last - first).days + 1)]
        return [(d, self.files.get(d)) for d in days]

    def session_trades(self, symbol: str, session: Session) -> tuple[Trades, np.ndarray]:
        """A contract's trades for a session, in receive order, and the covered intervals."""
        parts, coverage = [], []
        for day, file in self.day_files(session):
            if file is None or not file.covered:
                continue
            records, mappings = self.cache.get(file)
            self.used_files[file.path.name] = file
            day_ns = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()) * NS
            coverage.append((day_ns, day_ns + DAY))
            iid = instrument_id(mappings, symbol, day)
            if iid is None:
                continue
            sel = (records["instrument_id"] == iid) & (records["action"] == b"T")
            parts.append(to_trades(records[sel]))
        trades = Trades.concat(parts)
        known = trades.ts_recv + self.config.feed_latency
        delay = self.config.close_delay
        inside = (known >= session.open + delay) & (known < session.close + delay)
        return trades.take(inside), np.array(coverage, np.int64).reshape(-1, 2)

    def session_chunk(self, contract: str, session: Session, tradable: bool) -> MarketChunk:
        trades, coverage = self.session_trades(contract, session)
        label = f"{session.trade_date} {contract}" + ("" if tradable else " (warmup)")
        self.quality[label] = raw_quality(trades)
        return MarketChunk(contract, session.open, session.close, trades, coverage, label, tradable)

    def front_contract(self, previous: Session | None, session: Session) -> str:
        """The outright with the most volume in the previous session, switching at the open."""
        if previous is not None:
            volumes = self.outright_volumes(previous)
            if volumes:
                return max(volumes, key=volumes.get)
        raise ValueError(
            f"Cannot choose the {self.product.root} front contract for {session.trade_date} "
            "without the previous session's data; set `contract` (for example GCZ6) or add "
            "a warmup session with data."
        )

    def outright_volumes(self, session: Session) -> dict[str, int]:
        volumes: dict[str, int] = {}
        for day, file in self.day_files(session):
            if file is None or not file.covered:
                continue
            records, mappings = self.cache.get(file)
            ts = records["ts_recv"].astype(np.int64)
            in_session = (ts >= session.open) & (ts < session.close) & (records["action"] == b"T")
            for symbol in mappings:
                if not self.product.is_outright(symbol):
                    continue
                iid = instrument_id(mappings, symbol, day)
                if iid is not None:
                    sel = in_session & (records["instrument_id"] == iid)
                    volumes[symbol] = volumes.get(symbol, 0) + int(records["size"][sel].sum())
        return {k: v for k, v in volumes.items() if v > 0}


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
