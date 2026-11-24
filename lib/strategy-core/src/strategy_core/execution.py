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
  trade left (the last record of the trigger's own event time), never better than the
  triggering trade's price. Only trades that happened after the entry fill can trigger an exit.
- A trade record carries the book as it was before the trade; the book changes only when a
  later record says so. Most trades are followed by that record at the same event time, so a
  lookup at the trade's time already reads it. Where none follows, the book did not visibly
  change (the trade met hidden or spread-implied liquidity), and the earlier book stands.
- Time and session exits are market orders sent at the deadline. A closing decision
  (`close`) is the same order sent when the decision is made; until it arrives the stop and
  the target can still fill.
- An entry is a market order (`fill`) or a resting limit (`rest`): at the best bid or ask of
  the book it meets, or at a given price, cancelled when it expires. A limit at the touch
  joins the back of the displayed size, which only trades at its price reduce
  (`passive_fill="queue"`); MBP-1 shows no queue, so `"through"` is the strict bound.
- With `Bracket.breakeven_atr`, the stop moves to the entry price once a trade has printed
  that far in favour: the engine learns of the trade when its second closes and the amended
  order arrives `order_latency` later; the stop is at the entry price from then on.
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
    F_BAD_TS_RECV,
    F_MAYBE_BAD_BOOK,
    NS,
    SECOND,
    UNDEF_PRICE,
    UNDEF_SIZE,
    BookEvents,
    Product,
    SessionCalendar,
    Trades,
)
from .strategies import Bracket, Entry

MS = 1_000_000


@dataclass(frozen=True)
class ExecutionConfig:
    contracts: int = 1
    commission_per_contract: float = 2.5  # USD per contract per side; set for your broker
    feed_latency_ms: float = 5.0  # Databento receipt to this process
    close_delay_ms: float = 100.0  # wait after each second for late trades, then decide
    order_latency_ms: float = 50.0  # decision to exchange arrival
    limit_fill: str = "through"
    passive_fill: str = "queue"  # a limit entry at the touch: "queue" or "through"
    depth_penalty_ticks: int = 1
    adverse_ticks: int = 0  # extra ticks every marketable order pays: a stress test, not a model
    cooldown_s: float = 10.0
    flat_before_close_s: int = 300
    # Risk as a share of the account (roadmap decision 36). With an account size, a position is
    # sized so that its stop risks `risk_pct` of it (whole contracts, rounded down; a signal
    # whose one contract risks more is not traded), and no position is opened in a session
    # once `daily_loss_pct` of it has been lost there. Without one, every trade is `contracts`.
    account_usd: float | None = None
    risk_pct: float = 0.5
    daily_loss_pct: float = 2.0
    # The same limit in units of risk, for runs without an account size: no position is opened
    # in a session once its closed trades have lost this many R after commission (None: none).
    daily_loss_r: float | None = None

    def __post_init__(self):
        if type(self.contracts) is not int or not 1 <= self.contracts <= 100:
            raise ValueError("contracts must be an integer from 1 to 100")
        if self.limit_fill not in ("through", "touch"):
            raise ValueError('limit_fill must be "through" or "touch"')
        if self.passive_fill not in ("queue", "through"):
            raise ValueError('passive_fill must be "queue" or "through"')
        if self.account_usd is not None and not 0 < self.account_usd <= 1e12:
            raise ValueError("account_usd must be positive, or None")
        if self.daily_loss_r is not None and not 0 < self.daily_loss_r <= 1000:
            raise ValueError("daily_loss_r must be positive, or None")
        for name in ("risk_pct", "daily_loss_pct"):
            if not 0 < getattr(self, name) <= 100:
                raise ValueError(f"{name} must be in (0, 100]")
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
        for name in ("depth_penalty_ticks", "adverse_ticks"):
            if type(getattr(self, name)) is not int or getattr(self, name) < 0:
                raise ValueError(f"{name} must be a nonnegative integer")
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


FILLED, WAIT, CANCELLED, EXPIRED = "filled", "wait", "cancelled", "expired"
UNKNOWN = "unknown"  # data coverage ended while a limit order rested: a fill would be unseen


def bracket_atr(context: dict, bracket: Bracket) -> np.ndarray:
    """The ATR in price units that sizes `bracket`, from a feature frame's context."""
    key = f"atr:{bracket.atr}"
    if key not in context and bracket.atr == "1m@1s":
        key = "atr"
    return context[key]


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
    unreliable: bool = False  # Databento flagged the record: the book may be wrong

    @property
    def two_sided(self) -> bool:
        return UNDEF_PRICE not in (self.bid, self.ask) and self.bid <= self.ask

    @property
    def usable(self) -> bool:
        """Whether an order can be priced at it: both sides, not crossed, and not flagged."""
        return self.two_sided and not self.unreliable


def merged(coverage: np.ndarray) -> np.ndarray:
    """Covered `[start, end)` intervals sorted, with touching or overlapping ones joined."""
    out: list[list[int]] = []
    for start, end in sorted(map(tuple, np.asarray(coverage, np.int64).reshape(-1, 2).tolist())):
        if out and start <= out[-1][1]:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return np.array(out, np.int64).reshape(-1, 2)


class BookView:
    """One chunk of a contract's book events in the order the engine processes them (by slot,
    then receive order), with the book carried in from earlier chunks (`before`).

    Every record is the whole top of book after its event, so it already includes every record
    received before it. Two rules follow, and both matter only when records are out of order
    (an event-time inversion, or a late record released before one received earlier):

    - The book after a prefix of records is the one received last (`state`), not the one
      processed last. `recv_floor` is the latest receive time of earlier chunks. A record
      whose receive time Databento flags as inaccurate (the book restated at the start of a
      file) is ordered by its position instead, and its receive time is never compared.
    - A record takes effect no earlier than the records before it: lookups by time use the
      running maximum of event times (`ts_max`), never a record's own earlier stamp.

    A book is an observation only while the data is covered: with `coverage` (the chunk's
    covered intervals), a lookup returns None at an uncovered time, and after a gap until an
    event that happened after it."""

    def __init__(
        self,
        book: BookEvents,
        slot_end: np.ndarray,
        before: Quote | None = None,
        ts_floor: int = 0,
        recv_floor: int = 0,
        coverage: np.ndarray | None = None,
    ):
        self.b, self.slot_end, self.before = book, slot_end, before
        self.n = len(book)
        self.recv_max = recv_floor
        self.cover = None if coverage is None else merged(coverage)
        if self.n:
            self.ts_max = np.maximum.accumulate(np.maximum(book.ts_event, ts_floor))
            loose = (book.flags & F_BAD_TS_RECV) > 0
            recv = np.maximum.accumulate(np.maximum(np.where(loose, 0, book.ts_recv), recv_floor))
            newest = loose | (book.ts_recv >= np.r_[recv_floor, recv[:-1]])
            self.state = np.maximum.accumulate(np.where(newest, np.arange(self.n), -1))
            self.recv_max = int(recv[-1])
        else:
            self.ts_max = self.state = np.empty(0, np.int64)

    @classmethod
    def empty(cls, before: Quote | None = None, coverage: np.ndarray | None = None) -> "BookView":
        return cls(BookEvents.empty(), np.empty(0, np.int64), before, coverage=coverage)

    def held(self, quote: Quote | None, time: int) -> Quote | None:
        """`quote` if the data is covered at `time` and the quote is from an event inside the
        same covered stretch; else None. A book carried across missing data is not an
        observation."""
        if quote is None or self.cover is None:
            return quote
        i = int(np.searchsorted(self.cover[:, 0], time, side="right")) - 1
        if i < 0 or time >= self.cover[i, 1] or quote.ts_event < self.cover[i, 0]:
            return None
        return quote

    def quote(self, k: int) -> Quote | None:
        """The book after the first `k + 1` records: the one received last among them."""
        s = int(self.state[k]) if k >= 0 else -1
        if s < 0:
            return self.before
        b = self.b
        return Quote(
            int(b.bid[s]),
            int(b.ask[s]),
            int(b.bid_size[s]),
            int(b.ask_size[s]),
            int(self.ts_max[k]),
            bool(b.flags[s] & F_MAYBE_BAD_BOOK),
        )

    def at(self, time: int) -> Quote | None:
        """The book the exchange showed at `time`: the state after the last event that happened
        at or before it, among events released by the close of the slot containing `time`.
        Call it from the chunk that contains that slot (earlier chunks are in `before`)."""
        by_time = int(np.searchsorted(self.ts_max, time, side="right"))
        by_slot = int(np.searchsorted(self.slot_end, slot_end(time), side="right"))
        return self.held(self.quote(min(by_time, by_slot) - 1), time)

    def late(self, time: int, end: int) -> Quote | None:
        """The book after an event at `time` that was released late, in the slot ending at
        `end`: the last record released in that slot that happened at or before `time` (the
        records that arrived with it), or None. Earlier slots are not read: a session running
        second by second no longer holds them."""
        lo = int(np.searchsorted(self.slot_end, end, side="left"))
        hi = int(np.searchsorted(self.slot_end, end, side="right"))
        hit = np.flatnonzero(self.b.ts_event[lo:hi] <= time)
        return self.held(self.quote(lo + int(hit[-1])), time) if len(hit) else None

    def known(self, end: int) -> Quote | None:
        """The latest book the engine holds when the slot ending at `end` closes."""
        k = int(np.searchsorted(self.slot_end, end, side="right")) - 1
        return self.held(self.quote(k), end - 1)

    def known_many(self, ends: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """`known` for many slot ends at once: the bid and ask the engine holds when each slot
        closes, and whether that book is usable (two-sided, not flagged, and an observation
        of covered data)."""
        n = len(ends)
        k = np.searchsorted(self.slot_end, ends, side="right") - 1
        s = np.where(k >= 0, self.state[np.maximum(k, 0)], -1) if self.n else np.full(n, -1)
        bid, ask = np.full(n, UNDEF_PRICE, np.int64), np.full(n, UNDEF_PRICE, np.int64)
        flagged, at = np.zeros(n, bool), np.zeros(n, np.int64)
        has = s >= 0
        if has.any():
            bid[has], ask[has] = self.b.bid[s[has]], self.b.ask[s[has]]
            flagged[has] = (self.b.flags[s[has]] & F_MAYBE_BAD_BOOK) > 0
            at[has] = self.ts_max[k[has]]
        if self.before is not None and not has.all():
            q = self.before
            bid[~has], ask[~has], flagged[~has], at[~has] = q.bid, q.ask, q.unreliable, q.ts_event
        ok = (bid != UNDEF_PRICE) & (ask != UNDEF_PRICE) & (bid <= ask) & ~flagged
        if self.before is None:
            ok &= has
        if self.cover is not None:
            time = ends - 1
            i = np.searchsorted(self.cover[:, 0], time, side="right") - 1
            j = np.maximum(i, 0)
            inside = (i >= 0) & (time < self.cover[j, 1]) & (at >= self.cover[j, 0])
            ok &= inside if len(self.cover) else False
        return bid, ask, ok

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
    # a limit entry: its price (0: the touch of the book it meets), when it is cancelled, and,
    # once it has reached the exchange at the touch, the size that must still trade at its
    # price before it is filled: what was displayed ahead of it, and its own (0: not tracked)
    limit_px: int = 0
    expire_ns: int = 0
    resting: bool = False
    queue: int = 0
    covered_to: int = 0  # a resting order has been watched, with data coverage, up to here
    fill_record: int = -1  # in the view that filled a resting order: the trade that did
    stop_at_entry_ns: int = 0  # from when the stop is at the entry price (0: it has not moved)


class Simulator:
    def __init__(
        self,
        product: Product,
        config: ExecutionConfig,
        bracket: Bracket,
        calendar: SessionCalendar,
        entry: Entry | None = None,
    ):
        self.product, self.config, self.bracket, self.calendar = product, config, bracket, calendar
        self.entry = entry or Entry()

    def stop_ticks(self, atr: float | np.ndarray) -> float | np.ndarray:
        """The entry-to-stop distance of an order with this ATR, in ticks (at least one)."""
        return np.maximum(np.round(self.bracket.stop_atr * atr * 1e9 / self.product.tick_size), 1)

    def size(self, atr: np.ndarray) -> np.ndarray:
        """Contracts of an order with each ATR: the configured number, or with an account size
        as many whole contracts as keep the stop's risk within `risk_pct` of it (0: none)."""
        c = self.config
        if c.account_usd is None:
            return np.full(len(atr), c.contracts, np.int64)
        risk = self.stop_ticks(atr) * self.product.tick_value  # dollars a contract
        with np.errstate(invalid="ignore"):
            n = np.floor(c.account_usd * c.risk_pct / 100 / risk)
        return np.where(np.isfinite(n), np.minimum(n, 100), 0).astype(np.int64)

    def order(
        self,
        direction: int,
        contract: str,
        signal_end: int,
        atr: float,
        features: dict,
        view: ExecView,
        contracts: int | None = None,
    ) -> Position:
        c = self.config
        decision = signal_end + c.close_delay
        close = int(self.calendar.close_after(np.array([signal_end]))[0])
        pos = Position(
            direction,
            c.contracts if contracts is None else contracts,
            contract,
            signal_end,
            decision,
            decision + c.order_latency,
            close - c.flat_before_close,
            atr,
            features,
        )
        seen = view.book.known(signal_end)
        if seen is not None and seen.usable:
            pos.decision_bid, pos.decision_ask = seen.bid, seen.ask
        if self.entry.kind == "passive":
            pos.expire_ns = pos.arrival_ns + round(self.entry.wait_s * NS)
        return pos

    def enter(self, view: ExecView, pos: Position) -> tuple[str, int, int]:
        """Work a pending entry as its order kind says. Returns the status, when the engine
        learns the outcome, and the index of the first trade after a fill (for `advance`)."""
        if pos.expire_ns:
            return self.rest(view, pos)
        status, known = self.fill(view, pos)
        return status, known, 0

    def close(self, pos: Position, decision_ns: int) -> None:
        """A closing decision made at `decision_ns`: a market order that reaches the exchange
        `order_latency` later, unless the position's timed exit is due sooner."""
        due = decision_ns + self.config.order_latency
        if due < pos.exit_arrival_ns:
            pos.exit_arrival_ns, pos.timed_reason = due, "decision"

    def price(self, quote: Quote | None, side: int, contracts: int, flags: list[str]) -> int | None:
        """Price a marketable order of `side` (+1 buy, -1 sell) against `quote`, or None when
        the book shows no usable price: one side absent, crossed, or flagged as possibly wrong
        (it stays unusable until a record without the flag arrives)."""
        if quote is None or not quote.usable:
            return None
        price = quote.ask if side > 0 else quote.bid
        shown = quote.ask_size if side > 0 else quote.bid_size
        if shown >= UNDEF_SIZE:  # an undefined displayed size shows nothing: pay the penalty
            shown = 0
        if contracts > shown:
            flags.append("beyond_displayed_size")
            price += side * self.config.depth_penalty_ticks * self.product.tick_size
        return price + side * self.config.adverse_ticks * self.product.tick_size

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
        self.opened(pos, px, at, known)
        return FILLED, known

    def opened(self, pos: Position, px: int, at: int, known: int) -> None:
        """Record an entry fill at `px` and fix the bracket and the timed exit from it."""
        tick = self.product.tick_size
        pos.entry_px, pos.entry_ns, pos.entry_known_ns = px, at, known
        target = max(round(self.bracket.target_atr * pos.atr * 1e9 / tick), 1) * tick
        stop = max(round(self.bracket.stop_atr * pos.atr * 1e9 / tick), 1) * tick
        pos.target_px = pos.entry_px + pos.direction * target
        pos.stop_px = pos.entry_px - pos.direction * stop
        hold = self.bracket.max_hold_s
        timer = pos.force_exit_ns + 1 if hold is None else pos.entry_known_ns + hold * NS
        deadline = min(timer, pos.force_exit_ns)
        pos.timed_reason = "time" if timer <= pos.force_exit_ns else "session_close"
        pos.exit_arrival_ns = deadline + self.config.order_latency
        pos.best_px = pos.worst_px = pos.last_px = pos.entry_px

    def rest(self, view: ExecView, pos: Position) -> tuple[str, int, int]:
        """Work a pending limit entry: at `pos.limit_px`, or at the touch of the book it meets
        (the best bid for a buy, the best ask for a sell) when that is 0, until `pos.expire_ns`
        or the forced-exit time. It can be called chunk by chunk: what the order needs from
        earlier chunks is kept on the position. Returns the status, when the engine learns the
        outcome, and the index of the first trade after a fill (for `advance`).

        - `CANCELLED`: the order arrives at or after the forced-exit time, or meets no usable
          book (whether it would have rested correctly is then unknown).
        - `EXPIRED`: it arrived after its expiry, or nothing filled it before then.
        - `FILLED`: a given price that the book is already at or through fills on arrival as a
          marketable order, never worse than its price. Otherwise a later trade through its
          price fills it at its price, at that trade's event time (`limit_fill="touch"`: also a
          trade at it). An order at the touch with `passive_fill="queue"` also fills when the
          size displayed ahead of it on arrival, and its own, has traded at its price.
        - `UNKNOWN`: data coverage broke while it rested, before any fill that was seen.
        - `WAIT`: the view ends before the outcome is known."""
        at, d, delay = pos.arrival_ns, pos.direction, self.config.close_delay
        expire = min(pos.expire_ns, pos.force_exit_ns)
        j = int(np.searchsorted(view.ts_max, at, side="left"))
        if not pos.resting:  # the order reaches the exchange in this view, or later
            if view.end <= at:
                return WAIT, 0, 0
            if at >= pos.force_exit_ns:
                return CANCELLED, pos.force_exit_ns, 0
            if at >= expire:
                return EXPIRED, slot_end(at) + delay, 0
            quote = view.book.at(at)
            if quote is None or not quote.usable:
                return CANCELLED, slot_end(at) + delay, 0
            if not pos.limit_px:  # join the touch, behind what is displayed there
                pos.limit_px = quote.bid if d > 0 else quote.ask
                shown = quote.bid_size if d > 0 else quote.ask_size
                if self.config.passive_fill == "queue" and shown < UNDEF_SIZE:
                    pos.queue = int(shown) + pos.contracts
            elif (quote.ask <= pos.limit_px) if d > 0 else (quote.bid >= pos.limit_px):
                flags: list[str] = []
                px = self.price(quote, d, pos.contracts, flags)
                # Only what the book shows within the limit fills on arrival. An order larger
                # than the displayed size, or one a stress tick pushes past its price, is not
                # given a full fill at a price the book did not show: it rests instead.
                if (px <= pos.limit_px) if d > 0 else (px >= pos.limit_px):
                    pos.flags.extend(flags)
                    self.opened(pos, px, at, slot_end(at) + delay)
                    return FILLED, pos.entry_known_ns, j
            pos.resting, pos.covered_to = True, at
        limit = pos.limit_px
        lim = j + int(np.searchsorted(view.known[j:], slot_end(expire) + delay, side="right"))
        prices, when = view.t.price[j:lim], view.t.ts_event[j:lim]
        live = (when >= at) & (when < expire)
        if self.config.limit_fill == "through":
            hit = live & (prices < limit if d > 0 else prices > limit)
        else:
            hit = live & (prices <= limit if d > 0 else prices >= limit)
        traded = 0
        if pos.queue:
            # Trades at its price work through the size ahead, then its own, when their
            # aggressor took the side the order rests on: a seller for a resting buy. A print
            # of unknown side, or by a buyer, is no evidence that the bids were consumed.
            at_price = live & (prices == limit) & (view.t.side[j:lim] == -d)
            done = np.cumsum(np.where(at_price, view.t.size[j:lim], 0))
            hit |= at_price & (done >= pos.queue)
            traded = int(done[-1]) if len(done) else 0
        k = j + int(np.argmax(hit)) if hit.any() else -1
        # The order must have been watched without a break from its arrival to its fill or
        # expiry: a trade during missing data could have filled it unseen.
        until = min(int(view.t.ts_event[k]) if k >= 0 else expire, view.end)
        gap = self.uncovered(view, pos.covered_to, until)
        if gap is not None:
            return UNKNOWN, slot_end(gap) + delay, 0
        pos.covered_to = max(pos.covered_to, until)
        if k >= 0:
            self.opened(pos, limit, int(view.t.ts_event[k]), int(view.known[k]))
            pos.fill_record = k
            return FILLED, pos.entry_known_ns, j
        pos.queue -= traded  # still above zero: the order was not filled
        if view.end <= expire:
            return WAIT, 0, 0
        return EXPIRED, slot_end(expire) + delay, 0

    @staticmethod
    def uncovered(view: ExecView, start: int, end: int) -> int | None:
        """Where data coverage first breaks in `[start, end)`, or None when it does not."""
        cover = view.book.cover
        if cover is None or end <= start:
            return None
        i = int(np.searchsorted(cover[:, 0], start, side="right")) - 1
        if i < 0 or start >= cover[i, 1]:
            return start
        return int(cover[i, 1]) if cover[i, 1] < end else None

    def advance(self, view: ExecView, j: int, pos: Position) -> tuple[int, dict | None]:
        """Scan trades from j for the position's exit. Returns (next index, closed trade or None
        when more data is needed)."""
        n, t, delay = view.n, view.t, self.config.close_delay
        due = pos.exit_arrival_ns
        # No trade before the entry can trigger an exit; skip them without reading them.
        j = max(j, int(np.searchsorted(view.ts_max, pos.entry_ns, side="left")))
        # Trades released by the close of the timed exit's slot. Each counts by its own event
        # time, after the entry and before the timed exit arrives, in whatever order they came:
        # an event-time inversion can deliver an earlier trade later in receive order.
        lim = j + int(np.searchsorted(view.known[j:], slot_end(due) + delay, side="right"))
        prices, when = t.price[j:lim], t.ts_event[j:lim]
        live = (when >= pos.entry_ns) & (when < due)
        if j <= pos.fill_record < lim:  # the trade that filled the entry cannot also exit it
            live[pos.fill_record - j] = False
        long = pos.direction > 0
        through = self.config.limit_fill == "through"
        stop = self.stop_levels(view, j, lim, pos, live)
        if long:
            hit_t = live & (prices > pos.target_px if through else prices >= pos.target_px)
            hit_s = live & (prices <= stop)
        else:
            hit_t = live & (prices < pos.target_px if through else prices <= pos.target_px)
            hit_s = live & (prices >= stop)
        kt = int(np.argmax(hit_t)) if hit_t.any() else len(prices)
        ks = int(np.argmax(hit_s)) if hit_s.any() else len(prices)
        k = min(kt, ks)
        self.excursion(pos, prices[: k + 1][live[: k + 1]])
        flags = list(pos.flags)
        if k < len(prices):
            at, known = int(t.ts_event[j + k]), int(view.known[j + k])
            if pos.stop_at_entry_ns and at >= pos.stop_at_entry_ns:
                flags.append("stop_at_entry")
            if kt < ks:
                return j + k + 1, self.record(pos, at, known, pos.target_px, "target", flags)
            # The stop-market order meets the book its trigger left: the last record of the
            # trigger's event time. A trigger released after its own second had closed reads
            # the records released with it.
            trigger, released = int(prices[k]), known - delay
            book = view.book
            left = book.at(at) if released == slot_end(at) else book.late(at, released)
            px = self.price(left, -pos.direction, pos.contracts, flags)
            if px is None:
                flags.append("no_book")
                px = trigger
            px = min(px, trigger) if long else max(px, trigger)  # no better than the trigger
            return j + k + 1, self.record(pos, at, known, px, "stop", flags)
        if view.end <= due:
            return n, None
        if pos.stop_at_entry_ns and due >= pos.stop_at_entry_ns:
            flags.append("stop_at_entry")
        px = self.price(view.book.at(due), -pos.direction, pos.contracts, flags)
        if px is None:
            flags.append("no_book")
            px = pos.last_px
        return lim, self.record(pos, due, slot_end(due) + delay, px, pos.timed_reason, flags)

    def stop_levels(
        self, view: ExecView, j: int, lim: int, pos: Position, live: np.ndarray
    ) -> np.ndarray | int:
        """The stop each trade of `view.t[j:lim]` is judged against: the position's stop, or
        the entry price from the time a break-even amendment took effect. The first live trade
        that far in favour sets that time, when the engine has learned of it and its amended
        order has arrived; the position remembers it across chunks."""
        k = self.bracket.breakeven_atr
        if k is None:
            return pos.stop_px
        prices, when = view.t.price[j:lim], view.t.ts_event[j:lim]
        if not pos.stop_at_entry_ns:
            tick = self.product.tick_size
            move = max(round(k * pos.atr * 1e9 / tick), 1) * tick
            far = live & ((prices - pos.entry_px) * pos.direction >= move)
            if far.any():
                first = j + int(np.argmax(far))
                pos.stop_at_entry_ns = int(view.known[first]) + self.config.order_latency
        if not pos.stop_at_entry_ns:
            return pos.stop_px
        return np.where(when >= pos.stop_at_entry_ns, pos.entry_px, pos.stop_px)

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
