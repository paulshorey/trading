"""Simulated execution against MBP-1 trades and book events, shared by backtests, paper
sessions, and ML labels.

Timing model (see docs/project/engine.md):

- The second ending at `T` is computed at `T + close_delay`; that is the decision time.
- An order sent then reaches the exchange `order_latency` later.
- A marketable order fills when it arrives, at the best ask (buy) or bid (sell) the exchange
  showed at that moment: the state after the last book event at or before the arrival. Size
  beyond the displayed size pays `depth_penalty_ticks` (MBP-1 shows one price level).
- The target is a resting limit: it fills only when a trade prints beyond it
  (`limit_fill="through"`) or at it (`"touch"`); there is no queue position. The stop is a
  resting stop-market: a trade at or beyond it triggers it, and it fills at the book that
  trade left, never better than the triggering trade's price. Only trades that happened after
  the entry fill can trigger an exit.
- Time and session exits are market orders sent at the deadline.
- Reactions (cooldown, the hold timer) start when the engine learns of a fill: when the
  fill's second closes, never the earlier exchange time.

Trades and book events are scanned slot by slot, in receive order within a slot, which is how
a live session releases them. Every lookup is bounded by the slot of its own time, so a record
released later never changes an earlier fill and results are identical whether data arrives as
a session or second by second.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .market import (
    NS,
    SECOND,
    UNDEF_PRICE,
    UNDEF_SIZE,
    BookEvents,
    Product,
    SessionCalendar,
    Trades,
)
from .strategies import Bracket

MS = 1_000_000


@dataclass(frozen=True)
class ExecutionConfig:
    contracts: int = 1
    commission_per_contract: float = 2.5  # USD per contract per side; set for your broker
    feed_latency_ms: float = 5.0  # Databento receipt to this process
    close_delay_ms: float = 100.0  # wait after each second for late trades, then decide
    order_latency_ms: float = 50.0  # decision to exchange arrival
    limit_fill: str = "through"
    depth_penalty_ticks: int = 1
    cooldown_s: float = 10.0
    flat_before_close_s: int = 300

    def __post_init__(self):
        if type(self.contracts) is not int or not 1 <= self.contracts <= 100:
            raise ValueError("contracts must be an integer from 1 to 100")
        if self.limit_fill not in ("through", "touch"):
            raise ValueError('limit_fill must be "through" or "touch"')
        for name in (
            "commission_per_contract",
            "feed_latency_ms",
            "close_delay_ms",
            "order_latency_ms",
            "cooldown_s",
        ):
            value = getattr(self, name)
            if type(value) not in (int, float) or not 0 <= value <= 3_600_000:
                raise ValueError(f"{name} must be a nonnegative number")
        if self.close_delay_ms >= 1000:
            raise ValueError("close_delay_ms must be under one second")
        if type(self.depth_penalty_ticks) is not int or self.depth_penalty_ticks < 0:
            raise ValueError("depth_penalty_ticks must be a nonnegative integer")
        if type(self.flat_before_close_s) is not int or self.flat_before_close_s < 0:
            raise ValueError("flat_before_close_s must be a nonnegative integer")

    @property
    def feed_latency(self) -> int:
        return round(self.feed_latency_ms * MS)

    @property
    def close_delay(self) -> int:
        return round(self.close_delay_ms * MS)

    @property
    def order_latency(self) -> int:
        return round(self.order_latency_ms * MS)

    @property
    def cooldown(self) -> int:
        return round(self.cooldown_s * NS)

    @property
    def flat_before_close(self) -> int:
        return self.flat_before_close_s * NS


FILLED, WAIT, CANCELLED = "filled", "wait", "cancelled"


def slot_end(time: int) -> int:
    """End of the one-second slot `[T - 1 s, T)` containing `time`."""
    return (time // SECOND + 1) * SECOND


@dataclass(frozen=True)
class Quote:
    """The top of book after one book event."""

    bid: int
    ask: int
    bid_size: int
    ask_size: int
    ts_event: int

    @property
    def two_sided(self) -> bool:
        return UNDEF_PRICE not in (self.bid, self.ask) and self.bid <= self.ask


class BookView:
    """One chunk of a contract's book events in the order the engine processes them (by slot,
    then receive order), with the book carried in from earlier chunks (`before`)."""

    def __init__(
        self,
        book: BookEvents,
        slot_end: np.ndarray,
        before: Quote | None = None,
        ts_floor: int = 0,
    ):
        self.b, self.slot_end, self.before = book, slot_end, before
        self.n = len(book)
        self.ts_max = (
            np.maximum.accumulate(np.maximum(book.ts_event, ts_floor))
            if self.n
            else np.empty(0, np.int64)
        )

    @classmethod
    def empty(cls, before: Quote | None = None) -> "BookView":
        return cls(BookEvents.empty(), np.empty(0, np.int64), before)

    def quote(self, k: int) -> Quote | None:
        if k < 0:
            return self.before
        b = self.b
        return Quote(
            int(b.bid[k]),
            int(b.ask[k]),
            int(b.bid_size[k]),
            int(b.ask_size[k]),
            int(self.ts_max[k]),
        )

    def at(self, time: int) -> Quote | None:
        """The book the exchange showed at `time`: the state after the last event that happened
        at or before it, among events released by the close of the slot containing `time`.
        Call it from the chunk that contains that slot (earlier chunks are in `before`)."""
        by_time = int(np.searchsorted(self.ts_max, time, side="right"))
        by_slot = int(np.searchsorted(self.slot_end, slot_end(time), side="right"))
        return self.quote(min(by_time, by_slot) - 1)

    def known(self, end: int) -> Quote | None:
        """The latest book the engine holds when the slot ending at `end` closes."""
        return self.quote(int(np.searchsorted(self.slot_end, end, side="right")) - 1)

    @property
    def last(self) -> Quote | None:
        return self.quote(self.n - 1)


class ExecView:
    """One chunk of a contract's trades and book events for matching orders, in the order the
    engine processes them (by slot, then receive order). `known` is when the engine learns of
    each trade: when its slot closes. `end` is the end of the chunk's last slot: everything
    assigned to slots up to it has been released."""

    def __init__(
        self, trades: Trades, known: np.ndarray, book: BookView, end: int, ts_floor: int = 0
    ):
        self.t = trades
        self.n = len(trades)
        self.ts_max = (
            np.maximum.accumulate(np.maximum(trades.ts_event, ts_floor))
            if self.n
            else np.empty(0, np.int64)
        )
        self.known, self.book, self.end = known, book, end

    @classmethod
    def from_aggregation(
        cls,
        trades: Trades,
        order: np.ndarray,
        slot_end: np.ndarray,
        close_delay: int,
        book: BookView,
        end: int,
        ts_floor: int = 0,
    ) -> "ExecView":
        return cls(trades.take(order), slot_end + close_delay, book, end, ts_floor)

    def first_at_or_after(self, j: int, time: int) -> int:
        """Index of the first trade from `j` whose own event time is at or after `time`, else n.

        The running maximum gives a lower bound quickly (no earlier trade can qualify); the
        scan then checks actual event times, so an event-time inversion can never match a
        trade that happened before `time`."""
        k = j + int(np.searchsorted(self.ts_max[j:], time, side="left"))
        while k < self.n and self.t.ts_event[k] < time:
            later = np.flatnonzero(self.t.ts_event[k:] >= time)
            k = k + int(later[0]) if len(later) else self.n
        return k


@dataclass
class Position:
    """An entry order and, once filled, the open position with its bracket."""

    direction: int
    contracts: int
    contract: str
    signal_end: int
    decision_ns: int
    arrival_ns: int
    force_exit_ns: int
    atr: float
    features: dict
    decision_bid: int = UNDEF_PRICE  # the book the engine held when it decided
    decision_ask: int = UNDEF_PRICE
    entry_ns: int = 0
    entry_known_ns: int = 0
    entry_px: int = 0
    target_px: int = 0
    stop_px: int = 0
    exit_arrival_ns: int = 0
    timed_reason: str = ""
    best_px: int = 0
    worst_px: int = 0
    last_px: int = 0  # latest trade price after the entry, or the entry price
    flags: list[str] = field(default_factory=list)


class Simulator:
    def __init__(
        self, product: Product, config: ExecutionConfig, bracket: Bracket, calendar: SessionCalendar
    ):
        self.product, self.config, self.bracket, self.calendar = product, config, bracket, calendar

    def order(
        self,
        direction: int,
        contract: str,
        signal_end: int,
        atr: float,
        features: dict,
        view: ExecView,
    ) -> Position:
        c = self.config
        decision = signal_end + c.close_delay
        close = int(self.calendar.close_after(np.array([signal_end]))[0])
        pos = Position(
            direction,
            c.contracts,
            contract,
            signal_end,
            decision,
            decision + c.order_latency,
            close - c.flat_before_close,
            atr,
            features,
        )
        seen = view.book.known(signal_end)
        if seen is not None and seen.two_sided:
            pos.decision_bid, pos.decision_ask = seen.bid, seen.ask
        return pos

    def price(self, quote: Quote | None, side: int, contracts: int, flags: list[str]) -> int | None:
        """Price a marketable order of `side` (+1 buy, -1 sell) against `quote`, or None when
        the book shows no usable price on the side it needs."""
        if quote is None or not quote.two_sided:
            return None
        price = quote.ask if side > 0 else quote.bid
        shown = quote.ask_size if side > 0 else quote.bid_size
        if shown >= UNDEF_SIZE:  # an undefined displayed size shows nothing: pay the penalty
            shown = 0
        if contracts > shown:
            flags.append("beyond_displayed_size")
            price += side * self.config.depth_penalty_ticks * self.product.tick_size
        return price

    def fill(self, view: ExecView, pos: Position) -> tuple[str, int]:
        """Fill a pending entry at the book its order meets. Returns `WAIT` until the view
        covers the arrival, `CANCELLED` when the order arrives at or after the forced-exit time
        or meets no usable book, or `FILLED`; and when the engine learns the outcome."""
        at = pos.arrival_ns
        if view.end <= at:
            return WAIT, 0
        if at >= pos.force_exit_ns:
            return CANCELLED, pos.force_exit_ns
        known = slot_end(at) + self.config.close_delay
        px = self.price(view.book.at(at), pos.direction, pos.contracts, pos.flags)
        if px is None:
            return CANCELLED, known
        tick = self.product.tick_size
        pos.entry_px, pos.entry_ns, pos.entry_known_ns = px, at, known
        target = max(round(self.bracket.target_atr * pos.atr * 1e9 / tick), 1) * tick
        stop = max(round(self.bracket.stop_atr * pos.atr * 1e9 / tick), 1) * tick
        pos.target_px = pos.entry_px + pos.direction * target
        pos.stop_px = pos.entry_px - pos.direction * stop
        timer = pos.entry_known_ns + self.bracket.max_hold_s * NS
        deadline = min(timer, pos.force_exit_ns)
        pos.timed_reason = "time" if timer <= pos.force_exit_ns else "session_close"
        pos.exit_arrival_ns = deadline + self.config.order_latency
        pos.best_px = pos.worst_px = pos.last_px = pos.entry_px
        return FILLED, known

    def advance(self, view: ExecView, j: int, pos: Position) -> tuple[int, dict | None]:
        """Scan trades from j for the position's exit. Returns (next index, closed trade or None
        when more data is needed)."""
        n, t, delay = view.n, view.t, self.config.close_delay
        due = pos.exit_arrival_ns
        # No trade before the entry can trigger an exit; skip them without reading them.
        j = max(j, int(np.searchsorted(view.ts_max, pos.entry_ns, side="left")))
        # Trades that happened before the timed exit, released by the close of its slot.
        lim = min(
            view.first_at_or_after(j, due),
            j + int(np.searchsorted(view.known[j:], slot_end(due) + delay, side="right")),
        )
        prices = t.price[j:lim]
        # Only trades that happened after the entry count: an event-time inversion can deliver
        # an earlier trade later in receive order.
        live = t.ts_event[j:lim] >= pos.entry_ns
        long = pos.direction > 0
        through = self.config.limit_fill == "through"
        if long:
            hit_t = live & (prices > pos.target_px if through else prices >= pos.target_px)
            hit_s = live & (prices <= pos.stop_px)
        else:
            hit_t = live & (prices < pos.target_px if through else prices <= pos.target_px)
            hit_s = live & (prices >= pos.stop_px)
        kt = int(np.argmax(hit_t)) if hit_t.any() else len(prices)
        ks = int(np.argmax(hit_s)) if hit_s.any() else len(prices)
        k = min(kt, ks)
        self.excursion(pos, prices[: k + 1][live[: k + 1]])
        flags = list(pos.flags)
        if k < len(prices):
            at, known = int(t.ts_event[j + k]), int(view.known[j + k])
            if kt < ks:
                return j + k + 1, self.record(pos, at, known, pos.target_px, "target", flags)
            # The stop-market order meets the book its trigger left: the events of the same
            # match, or for a trade released late, the book when its second opened.
            trigger = int(prices[k])
            px = self.price(
                view.book.at(max(at, known - delay - SECOND)), -pos.direction, pos.contracts, flags
            )
            if px is None:
                flags.append("no_book")
                px = trigger
            px = min(px, trigger) if long else max(px, trigger)  # no better than the trigger
            return j + k + 1, self.record(pos, at, known, px, "stop", flags)
        if view.end <= due:
            return n, None
        px = self.price(view.book.at(due), -pos.direction, pos.contracts, flags)
        if px is None:
            flags.append("no_book")
            px = pos.last_px
        return lim, self.record(pos, due, slot_end(due) + delay, px, pos.timed_reason, flags)

    def excursion(self, pos: Position, prices: np.ndarray) -> None:
        if len(prices):
            hi, lo = int(prices.max()), int(prices.min())
            pos.last_px = int(prices[-1])
            if pos.direction > 0:
                pos.best_px, pos.worst_px = max(pos.best_px, hi), min(pos.worst_px, lo)
            else:
                pos.best_px, pos.worst_px = min(pos.best_px, lo), max(pos.worst_px, hi)

    def abandon(self, pos: Position, quote: Quote | None, reason: str) -> dict:
        """Close an open position at the latest book held (end of data or a roll)."""
        flags = [*pos.flags, "abandoned"]
        px = self.price(quote, -pos.direction, pos.contracts, flags)
        if px is None:
            flags.append("no_book")
            px = pos.last_px
        at = max(pos.entry_known_ns, quote.ts_event if quote is not None else 0)
        return self.record(pos, at, at, px, reason, flags)

    def record(
        self,
        pos: Position,
        exit_ns: int,
        exit_known_ns: int,
        exit_px: int,
        reason: str,
        flags: list[str],
    ) -> dict:
        p, tick = self.product, self.product.tick_size
        d, q = pos.direction, pos.contracts
        ticks = (exit_px - pos.entry_px) * d / tick
        commission = 2 * q * self.config.commission_per_contract
        stop_ticks = abs(pos.entry_px - pos.stop_px) / tick
        spread = slip = None
        if pos.decision_bid != UNDEF_PRICE:
            # What the entry cost against the mid-price the engine held when it decided: half
            # the spread, the market's move during the delays, and any depth penalty.
            spread = (pos.decision_ask - pos.decision_bid) / tick
            slip = (pos.entry_px - (pos.decision_ask + pos.decision_bid) / 2) * d / tick
        return {
            "contract": pos.contract,
            "direction": d,
            "contracts": q,
            "signal_end_ns": str(pos.signal_end),
            "decision_ns": str(pos.decision_ns),
            "entry_ns": str(pos.entry_ns),
            "exit_ns": str(exit_ns),
            "exit_known_ns": str(exit_known_ns),
            "entry_px": pos.entry_px / 1e9,
            "exit_px": exit_px / 1e9,
            "target_px": pos.target_px / 1e9,
            "stop_px": pos.stop_px / 1e9,
            "exit_reason": reason,
            "pnl_ticks": ticks,
            "pnl_usd": ticks * p.tick_value * q - commission,
            "commission_usd": commission,
            "r_multiple": ticks / stop_ticks if stop_ticks else None,
            "mfe_ticks": (pos.best_px - pos.entry_px) * d / tick,
            "mae_ticks": (pos.worst_px - pos.entry_px) * d / tick,
            "hold_s": (exit_ns - pos.entry_ns) / NS,
            "entry_delay_ms": (pos.entry_ns - pos.signal_end) / MS,
            "decision_spread_ticks": spread,
            "entry_slip_ticks": slip,
            "flags": sorted(set(flags)),
            "features": pos.features,
        }


def config_dict(config: ExecutionConfig) -> dict:
    return asdict(config)
