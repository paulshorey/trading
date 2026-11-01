"""Simulated execution against TBBO trades, shared by backtests, paper sessions, and ML labels.

Timing model (see docs/project/engine.md):

- The second ending at `T` is computed at `T + close_delay`; that is the decision time.
- An order sent then reaches the exchange `order_latency` later.
- A marketable order fills at the first trade received whose event time is at or after
  its arrival, at that trade's pre-trade ask (buy) or bid (sell): the book it would have
  met. Size beyond the displayed size pays `depth_penalty_ticks`.
- The target is a resting limit: it fills only when a trade prints beyond it
  (`limit_fill="through"`) or at it (`"touch"`). The stop is a resting stop-market:
  a trade at or beyond it triggers it, and it fills at the next trade's book, never
  better than the triggering trade's price.
- Time and session exits are market orders sent at the deadline.
- Reactions (cooldown, the hold timer) start when the engine learns of a fill: when
  the fill trade's slot closes, never the earlier exchange time.

Trades are scanned slot by slot, in receive order within a slot, which is how a live
session releases them, so "first trade at or after" is identical whether trades
arrive as a session or second by second.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .market import NS, UNDEF_PRICE, Product, SessionCalendar, Trades
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


class ExecView:
    """One chunk of a contract's trades for matching orders, in the order the engine processes
    them (by slot, then receive order). `known` is when the engine learns of each trade: when
    its slot closes."""

    def __init__(self, trades: Trades, known: np.ndarray, ts_floor: int = 0):
        self.t = trades
        self.n = len(trades)
        self.ts_max = (
            np.maximum.accumulate(np.maximum(trades.ts_event, ts_floor))
            if self.n
            else np.empty(0, np.int64)
        )
        self.known = known

    @classmethod
    def from_aggregation(
        cls,
        trades: Trades,
        order: np.ndarray,
        slot_end: np.ndarray,
        close_delay: int,
        ts_floor: int = 0,
    ) -> "ExecView":
        return cls(trades.take(order), slot_end + close_delay, ts_floor)

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
    entry_ns: int = 0
    entry_known_ns: int = 0
    entry_px: int = 0
    target_px: int = 0
    stop_px: int = 0
    exit_arrival_ns: int = 0
    timed_reason: str = ""
    best_px: int = 0
    worst_px: int = 0
    stop_triggered: bool = False
    stop_trigger_px: int = 0
    flags: list[str] = field(default_factory=list)


class Simulator:
    def __init__(
        self, product: Product, config: ExecutionConfig, bracket: Bracket, calendar: SessionCalendar
    ):
        self.product, self.config, self.bracket, self.calendar = product, config, bracket, calendar

    def order(
        self, direction: int, contract: str, signal_end: int, atr: float, features: dict
    ) -> Position:
        c = self.config
        decision = signal_end + c.close_delay
        close = int(self.calendar.close_after(np.array([signal_end]))[0])
        return Position(
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

    def book(self, view: ExecView, k: int, side: int, contracts: int, flags: list[str]) -> int:
        """Price a marketable order of `side` (+1 buy, -1 sell) at trade k's pre-trade book."""
        t = view.t
        bid, ask = int(t.bid[k]), int(t.ask[k])
        if UNDEF_PRICE in (bid, ask) or bid > ask:
            flags.append("no_book")
            price = int(t.price[k])
        else:
            price = ask if side > 0 else bid
        if contracts > (t.ask_size[k] if side > 0 else t.bid_size[k]):
            flags.append("beyond_displayed_size")
            price += side * self.config.depth_penalty_ticks * self.product.tick_size
        return price

    def fill(self, view: ExecView, j: int, pos: Position) -> int:
        """Fill a pending entry. Returns the fill trade's index, n if more data is needed, or -1
        when the order is cancelled because the market reached the forced-exit time first."""
        k = view.first_at_or_after(j, pos.arrival_ns)
        if k >= view.n:
            return view.n
        t, tick = view.t, self.product.tick_size
        if t.ts_event[k] >= pos.force_exit_ns:
            return -1
        pos.entry_px = self.book(view, k, pos.direction, pos.contracts, pos.flags)
        pos.entry_ns = int(t.ts_event[k])
        pos.entry_known_ns = int(view.known[k])
        target = max(round(self.bracket.target_atr * pos.atr * 1e9 / tick), 1) * tick
        stop = max(round(self.bracket.stop_atr * pos.atr * 1e9 / tick), 1) * tick
        pos.target_px = pos.entry_px + pos.direction * target
        pos.stop_px = pos.entry_px - pos.direction * stop
        timer = pos.entry_known_ns + self.bracket.max_hold_s * NS
        deadline = min(timer, pos.force_exit_ns)
        pos.timed_reason = "time" if timer <= pos.force_exit_ns else "session_close"
        pos.exit_arrival_ns = deadline + self.config.order_latency
        pos.best_px = pos.worst_px = pos.entry_px
        return k

    def advance(self, view: ExecView, j: int, pos: Position) -> tuple[int, dict | None]:
        """Scan trades from j for the position's exit. Returns (next index, closed trade or None
        when more data is needed)."""
        n, t = view.n, view.t
        if j >= n:
            return n, None
        if pos.stop_triggered:
            return j + 1, self.close(view, j, pos, "stop", None)
        lim = view.first_at_or_after(j, pos.exit_arrival_ns)
        prices = t.price[j:lim]
        long = pos.direction > 0
        through = self.config.limit_fill == "through"
        if long:
            hit_t = prices > pos.target_px if through else prices >= pos.target_px
            hit_s = prices <= pos.stop_px
        else:
            hit_t = prices < pos.target_px if through else prices <= pos.target_px
            hit_s = prices >= pos.stop_px
        kt = int(np.argmax(hit_t)) if hit_t.any() else len(prices)
        ks = int(np.argmax(hit_s)) if hit_s.any() else len(prices)
        k = min(kt, ks)
        self.excursion(pos, prices[: k + 1])
        if k < len(prices):
            if kt < ks:
                return j + kt + 1, self.close(view, j + kt, pos, "target", pos.target_px)
            pos.stop_triggered = True
            pos.stop_trigger_px = int(prices[ks])
            if j + ks + 1 < n:
                return j + ks + 2, self.close(view, j + ks + 1, pos, "stop", None)
            return n, None
        if lim < n:
            return lim + 1, self.close(view, lim, pos, pos.timed_reason, None)
        return n, None

    def excursion(self, pos: Position, prices: np.ndarray) -> None:
        if len(prices):
            hi, lo = int(prices.max()), int(prices.min())
            if pos.direction > 0:
                pos.best_px, pos.worst_px = max(pos.best_px, hi), min(pos.worst_px, lo)
            else:
                pos.best_px, pos.worst_px = min(pos.best_px, lo), max(pos.worst_px, hi)

    def close(
        self,
        view: ExecView,
        k: int,
        pos: Position,
        reason: str,
        limit_px: int | None,
    ) -> dict:
        t = view.t
        flags = list(pos.flags)
        px = (
            limit_px
            if limit_px is not None
            else self.book(view, k, -pos.direction, pos.contracts, flags)
        )
        if reason == "stop":  # the market order follows the trigger: no better than its price
            cap = pos.stop_trigger_px
            px = min(px, cap) if pos.direction > 0 else max(px, cap)
        self.excursion(pos, t.price[k : k + 1])
        return self.record(pos, int(t.ts_event[k]), int(view.known[k]), px, reason, flags)

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
            "flags": sorted(set(flags)),
            "features": pos.features,
        }


def config_dict(config: ExecutionConfig) -> dict:
    return asdict(config)
