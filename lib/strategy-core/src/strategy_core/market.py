"""Market primitives shared by historical replay and live sessions.

Times are UTC integer nanoseconds. Prices are Databento fixed-point integers: one
unit is 1e-9 of the quoted price. Raw prices stay inside data handling and
execution (order prices, fills, P&L); features and model inputs are normalized
(see `features.py`).
"""

from dataclasses import dataclass
from datetime import date

import numpy as np

NS = 1_000_000_000
PX = 1_000_000_000
SECOND = NS
MINUTE = 60 * NS
HOUR = 3600 * NS
UNDEF_PRICE = np.iinfo(np.int64).max  # Databento sentinel for an absent price
F_MAYBE_BAD_BOOK = 1 << 2  # Databento flag: an unrecoverable gap; the book may be wrong
F_BAD_TS_RECV = 1 << 3  # Databento flag: ts_recv is inaccurate
MONTH_CODES = "FGHJKMNQUVXZ"


@dataclass(frozen=True)
class Product:
    """A futures product. Contract-level metadata comes from each contract's raw symbol."""

    root: str
    name: str
    dataset: str
    tick_size: int  # fixed-point price units
    tick_value: float  # USD per tick per contract
    calendar: str  # pandas_market_calendars name for scheduled-open hours

    @property
    def parent_symbol(self) -> str:
        return f"{self.root}.FUT"

    def is_outright(self, symbol: str) -> bool:
        """True for a single contract such as GCZ6; false for spreads such as GCZ6-GCG7."""
        rest = symbol.removeprefix(self.root)
        return (
            rest != symbol and 2 <= len(rest) <= 3 and rest[0] in MONTH_CODES and rest[1:].isdigit()
        )

    def contract_month(self, symbol: str, on: date) -> date:
        """Delivery month of an outright seen trading on `on`: GCZ6 in 2026 is December 2026.
        One-digit years repeat each decade; the nearest decade not long expired wins."""
        if not self.is_outright(symbol):
            raise ValueError(f"{symbol!r} is not a {self.root} outright")
        rest = symbol.removeprefix(self.root)
        month, digits = MONTH_CODES.index(rest[0]) + 1, rest[1:]
        if len(digits) == 2:
            return date(2000 + int(digits), month, 1)
        year = on.year - on.year % 10 + int(digits)
        return date(year + 10 if year < on.year - 1 else year, month, 1)


EQUITY_INDEX = "CME Globex Equity"  # ES, NQ, YM, RTY share the CME equity-index schedule

# Tick sizes were checked against the downloaded TBBO prices; tick values follow the
# contract multipliers (GC 100 oz, SI 5,000 oz, PL 50 oz, ES $50, NQ $20, YM $5, RTY $50).
PRODUCTS = {
    "GC": Product("GC", "COMEX Gold", "GLBX.MDP3", 100_000_000, 10.0, "CMEGlobex_GC"),
    "SI": Product("SI", "COMEX Silver", "GLBX.MDP3", 5_000_000, 25.0, "CMEGlobex_SI"),
    "PL": Product("PL", "NYMEX Platinum", "GLBX.MDP3", 100_000_000, 5.0, "CMEGlobex_PL"),
    "ES": Product("ES", "E-mini S&P 500", "GLBX.MDP3", 250_000_000, 12.5, EQUITY_INDEX),
    "NQ": Product("NQ", "E-mini Nasdaq-100", "GLBX.MDP3", 250_000_000, 5.0, EQUITY_INDEX),
    "YM": Product("YM", "E-mini Dow ($5)", "GLBX.MDP3", 1_000_000_000, 5.0, EQUITY_INDEX),
    "RTY": Product("RTY", "E-mini Russell 2000", "GLBX.MDP3", 100_000_000, 5.0, EQUITY_INDEX),
    # Micro Gold: only the bundled one-day sample uses it.
    "MGC": Product("MGC", "Micro Gold", "GLBX.MDP3", 100_000_000, 1.0, "CMEGlobex_GC"),
}


@dataclass(frozen=True)
class Trades:
    """TBBO trades for one contract in receive order, each with the best bid and ask
    immediately before it: prices, displayed sizes, and displayed order counts.
    `side` is +1 buyer aggressor, -1 seller aggressor, 0 unknown."""

    ts_event: np.ndarray
    ts_recv: np.ndarray
    price: np.ndarray
    size: np.ndarray
    side: np.ndarray
    bid: np.ndarray
    ask: np.ndarray
    bid_size: np.ndarray
    ask_size: np.ndarray
    bid_count: np.ndarray
    ask_count: np.ndarray
    flags: np.ndarray

    FIELDS = (
        "ts_event",
        "ts_recv",
        "price",
        "size",
        "side",
        "bid",
        "ask",
        "bid_size",
        "ask_size",
        "bid_count",
        "ask_count",
        "flags",
    )
    DTYPES = (
        np.int64,
        np.int64,
        np.int64,
        np.int64,
        np.int8,
        np.int64,
        np.int64,
        np.int64,
        np.int64,
        np.int64,
        np.int64,
        np.uint8,
    )

    def __post_init__(self):
        n = len(self.ts_event)
        for name, dtype in zip(self.FIELDS, self.DTYPES, strict=True):
            value = getattr(self, name)
            if value.dtype != dtype or value.ndim != 1 or len(value) != n:
                raise ValueError(f"Trades.{name} must be a 1-D {np.dtype(dtype)} array, length {n}")

    def __len__(self) -> int:
        return len(self.ts_event)

    def take(self, index) -> "Trades":
        return Trades(*(getattr(self, name)[index] for name in self.FIELDS))

    @classmethod
    def empty(cls) -> "Trades":
        return cls(*(np.empty(0, dtype) for dtype in cls.DTYPES))

    @classmethod
    def concat(cls, parts: list["Trades"]) -> "Trades":
        if not parts:
            return cls.empty()
        return cls(*(np.concatenate([getattr(p, name) for p in parts]) for name in cls.FIELDS))

    def scaled(self, price_factor: int = 1, size_factor: int = 1) -> "Trades":
        """Copy with every price and size multiplied, for scale-invariance tests."""
        bid = np.where(self.bid == UNDEF_PRICE, UNDEF_PRICE, self.bid * price_factor)
        ask = np.where(self.ask == UNDEF_PRICE, UNDEF_PRICE, self.ask * price_factor)
        return Trades(
            self.ts_event,
            self.ts_recv,
            self.price * price_factor,
            self.size * size_factor,
            self.side,
            bid,
            ask,
            self.bid_size * size_factor,
            self.ask_size * size_factor,
            self.bid_count,
            self.ask_count,
            self.flags,
        )


@dataclass(frozen=True)
class SessionCalendar:
    """Scheduled-open intervals `[open, close)` in UTC nanoseconds from an exchange calendar.

    Windows count only scheduled-open time. Never derive closures from missing data."""

    name: str
    opens: np.ndarray
    closes: np.ndarray

    def __post_init__(self):
        o, c = self.opens, self.closes
        if o.dtype != np.int64 or c.dtype != np.int64 or len(o) != len(c):
            raise ValueError("Calendar opens and closes must be int64 arrays of equal length")
        if np.any(c <= o) or np.any(o[1:] < c[:-1]):
            raise ValueError("Calendar intervals must be positive, sorted, and non-overlapping")
        if np.any(o % MINUTE) or np.any(c % MINUTE):
            raise ValueError("Calendar boundaries must fall on whole minutes")

    def slot_ends(self, start: int, end: int, step: int) -> np.ndarray:
        """Ends `T` of scheduled-open slots `[T - step, T)` with `start < T <= end`."""
        first = np.searchsorted(self.closes, start, side="right")
        last = np.searchsorted(self.opens, end, side="left")
        parts = []
        for o, c in zip(self.opens[first:last], self.closes[first:last], strict=True):
            lo = max(int(o), start)
            lo = -(-lo // step) * step  # first slot start at or after lo
            hi = min(int(c), end)
            if lo + step <= hi:
                parts.append(np.arange(lo + step, hi + 1, step, dtype=np.int64))
        return np.concatenate(parts) if parts else np.empty(0, np.int64)

    def slot_ordinals(self, ends: np.ndarray, step: int) -> np.ndarray:
        """Trading-time index of each scheduled-open slot `[T - step, T)`: how many slots of
        `step` end at or before `T` since this calendar's first open. Closures add nothing,
        so slots `n` ordinals apart are exactly `n` scheduled-open steps apart. With a
        whole-hour origin, ordinal % 60 equals the clock minute until the first closure
        that is not a whole number of hours."""
        if MINUTE % step:
            raise ValueError("Slot ordinals need a step that divides one minute")
        index = np.searchsorted(self.closes, ends, side="left")
        safe = np.minimum(index, len(self.closes) - 1)
        if np.any(index >= len(self.closes)) or np.any(ends - step < self.opens[safe]):
            raise ValueError("Slot is outside the calendar's scheduled-open intervals")
        before = np.r_[0, np.cumsum((self.closes - self.opens) // step)[:-1]]
        return before[safe] + (ends - self.opens[safe]) // step

    def close_after(self, times: np.ndarray) -> np.ndarray:
        """Scheduled close of the session containing each slot end (open < T <= close)."""
        index = np.searchsorted(self.closes, times, side="left")
        if np.any(index >= len(self.closes)):
            raise ValueError("Time is after the last calendar session")
        return self.closes[index]
