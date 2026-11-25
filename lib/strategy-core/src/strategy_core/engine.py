"""One event-time engine for backtests and live sessions.

The engine consumes `MarketChunk`s: a session's trades and book events at once in a
backtest, or one second's as they arrive in a live or rehearsal session. Both paths run the same
code and must produce identical features, decisions, and fills; tests and the
`research verify` command check this. A run is one portfolio: one position at a time.

A strategy decides at every second (strategies.py). While flat, its signal opens a position;
while one is open, its closing decision exits at the market and cancels the bracket orders.
The position therefore moves one step per decision: long, flat, or short.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .bars import AggregationReport, aggregate, assignment_ns
from .execution import (
    CANCELLED,
    EXPIRED,
    UNKNOWN,
    WAIT,
    BookView,
    ExecutionConfig,
    ExecView,
    Position,
    Quote,
    Simulator,
    bracket_atr,
)
from .features import FeatureConfig, FeatureFrame
from .market import NS, SECOND, BookEvents, Product, SessionCalendar, Trades
from .strategies import Entry, Strategy


@dataclass(frozen=True)
class MarketChunk:
    """One contract's trades assigned to the scheduled slots ending in `(start, end]`, in
    receive order. A session chunk also carries trades assigned to the closure before it;
    aggregation reports those as outside the schedule and execution ignores them.

    `book` holds every MBP-1 record assigned to the same slots (the closure's records set the
    opening book). Stages read `trades`; simulated fills read `book`, so a tradable chunk
    needs it and a warm-up chunk does not."""

    contract: str
    start: int
    end: int
    trades: Trades
    coverage: np.ndarray  # (n, 2) int64 [start, end) intervals with data
    session: str = ""
    tradable: bool = True  # False for warmup chunks
    book: BookEvents | None = None


@dataclass
class ChunkResult:
    frame: FeatureFrame
    signals: np.ndarray
    view: ExecView
    trades: list[dict] = field(default_factory=list)


class Engine:
    def __init__(
        self,
        product: Product,
        calendar: SessionCalendar,
        strategy: Strategy,
        execution: ExecutionConfig | None = None,
        features: FeatureConfig | None = None,
    ):
        self.product, self.calendar, self.strategy = product, calendar, strategy
        self.config = execution or ExecutionConfig()
        self.feature_config = features or FeatureConfig()
        self.entry = getattr(strategy, "entry", None) or Entry()
        self.sim = Simulator(product, self.config, strategy.bracket, calendar, self.entry)
        self.contract = ""
        self.pipeline = self.features()
        self.pending: Position | None = None
        self.position: Position | None = None
        self.now = 0  # latest time the engine knows the position state for
        self.cooldown_until = 0
        self.ts_floor = 0
        self.book_floor = self.book_recv = 0  # latest event and receive time of earlier chunks
        self.quote: Quote | None = None  # the book they left
        self.trades: list[dict] = []
        self.cancelled = 0
        self.expired = 0  # limit entries that nothing filled
        self.unwatched = 0  # limit entries that rested through missing data: outcome unknown
        self.unsized = 0  # signals whose one contract risks more than the account allows
        self.signals = 0
        self.session_pnl: dict[int, float] = {}  # by session close: its closed trades, in USD
        self.limited: list[int] = []  # sessions stopped by the daily loss limit
        self.blocked_until = 0  # no position is opened before this time
        self.reports: dict[str, AggregationReport] = {}
        self.contracts: list[str] = []

    def process(self, chunk: MarketChunk, frame: FeatureFrame | None = None) -> ChunkResult:
        """Process one chunk. `frame` is the chunk's feature rows when another engine already
        computed them for the same chunks and feature settings (several policies compared on
        the same data); otherwise this engine's own pipeline computes them."""
        if chunk.contract != self.contract:
            self.switch_contract(chunk.contract)
        c = self.config
        ends = self.calendar.slot_ends(chunk.start, chunk.end, SECOND)
        agg = aggregate(  # for execution; the stages assign trades to seconds by the same rules
            chunk.trades,
            ends,
            SECOND,
            chunk.coverage,
            feed_latency=c.feed_latency,
            close_delay=c.close_delay,
        )
        self.reports.setdefault(chunk.session, AggregationReport()).add(agg.report)
        if frame is None:
            frame = self.pipeline.update(chunk)
        n = len(frame)
        view = ExecView.from_aggregation(
            chunk.trades,
            agg.order,
            agg.slot_end,
            c.close_delay,
            self.book_view(chunk, ends),
            chunk.end,
            self.ts_floor,
        )
        if view.n:
            self.ts_floor = int(view.ts_max[-1])
        signals, contracts = np.zeros(n, np.int8), np.zeros(n, np.int64)
        closes = np.zeros(n, bool), np.zeros(n, bool)
        if chunk.tradable and n:
            atr = bracket_atr(frame.context, self.strategy.bracket)
            seen = frame.features | self.costs(view, frame.end, atr)
            signals = self.strategy.signals(seen).astype(np.int8)
            close = self.calendar.close_after(frame.end)
            signals[(close - frame.end) <= c.flat_before_close + self.entry.cutoff_s * NS] = 0
            signals[~np.isfinite(atr)] = 0
            contracts = self.sim.size(atr)
            self.unsized += int(np.count_nonzero(signals[contracts == 0]))
            signals[contracts == 0] = 0
            if hasattr(self.strategy, "closes"):
                closes = self.strategy.closes(seen)
        self.signals += int(np.count_nonzero(signals))
        if chunk.book is None and chunk.tradable and signals.any():
            raise ValueError(f"Tradable chunk {chunk.session!r} has no book events to fill at")
        closed = self.execute(view, frame, signals, contracts, closes)
        if view.book.n:
            book = view.book
            self.book_floor, self.book_recv = int(book.ts_max[-1]), book.recv_max
            self.quote = book.last
        return ChunkResult(frame, signals, view, closed)

    def costs(self, view: ExecView, ends: np.ndarray, atr: np.ndarray) -> dict[str, np.ndarray]:
        """What a trade decided at each row would cost, in R (its stop distance), for the
        strategy's decision and never as a model input: `exec.spread_r`, the spread of the
        book the engine holds at the decision (NaN without a usable book), and
        `exec.commission_r`, both commissions."""
        tick = self.product.tick_size
        with np.errstate(invalid="ignore"):
            stop = self.sim.stop_ticks(atr)
            bid, ask, ok = view.book.known_many(ends)
            spread = np.where(ok, (ask - bid) / tick, np.nan) / stop
            commission = 2 * self.config.commission_per_contract / (stop * self.product.tick_value)
        return {"exec.spread_r": spread, "exec.commission_r": commission}

    def book_view(self, chunk: MarketChunk, ends: np.ndarray) -> BookView:
        """The chunk's book events by slot, then receive order, as a live session releases
        them. A chunk without a book (a warm-up session) leaves no book to carry forward."""
        if chunk.book is None:
            if chunk.tradable and (self.signals or self.pending or self.position):
                raise ValueError(f"Tradable chunk {chunk.session!r} has no book events to fill at")
            self.quote = None
            return BookView.empty()
        return book_view(chunk, ends, self.config, self.quote, self.book_floor, self.book_recv)

    def execute(
        self,
        view: ExecView,
        frame: FeatureFrame,
        signals: np.ndarray,
        contracts: np.ndarray,
        closes: tuple[np.ndarray, np.ndarray],
    ) -> list[dict]:
        closed: list[dict] = []
        candidates = np.flatnonzero(signals)
        decided = frame.end + self.config.close_delay  # when each row's decision is made
        decisions = decided[candidates]
        j = 0
        while True:
            if self.pending is not None:
                status, known, after = self.sim.enter(view, self.pending)
                if status == WAIT:
                    break
                if status in (CANCELLED, EXPIRED, UNKNOWN):
                    # at the forced-exit time, no book to fill at, a limit nothing filled, or
                    # one that rested through missing data
                    self.cancelled += status == CANCELLED
                    self.expired += status == EXPIRED
                    self.unwatched += status == UNKNOWN
                    if status == UNKNOWN:
                        # It may have filled unseen. The portfolio is not known to be flat
                        # until the session's forced exit, so nothing more is opened before.
                        close = self.pending.force_exit_ns + self.config.flat_before_close
                        self.blocked_until = max(self.blocked_until, close)
                    self.now = max(self.now, known)
                    self.pending = None
                    continue
                self.position, self.pending = self.pending, None
                j = max(j, after)
                continue
            if self.position is not None:
                pos = self.position
                # The first closing decision made once the engine knows of the position: a
                # market order, unless the bracket fills before it arrives.
                wanted = closes[0] if pos.direction > 0 else closes[1]
                first = np.flatnonzero(wanted & (decided >= pos.entry_known_ns))
                if len(first):
                    self.sim.close(pos, int(decided[first[0]]))
                j, trade = self.sim.advance(view, j, pos)
                if trade is None:
                    break
                closed.append(trade)
                self.position = None
                self.now = int(trade["exit_known_ns"])
                self.cooldown_until = self.now + self.config.cooldown
                self.settle(trade, pos)
                continue
            # Flat: the next signal decided strictly after the latest known state.
            after = max(self.now, self.cooldown_until, self.blocked_until)
            ci = int(np.searchsorted(decisions, after, "right"))
            if ci >= len(candidates):
                break
            i = int(candidates[ci])
            self.pending = self.sim.order(
                int(signals[i]),
                self.contract,
                int(frame.end[i]),
                float(bracket_atr(frame.context, self.strategy.bracket)[i]),
                frame.row(i),
                view,
                int(contracts[i]),
            )
            self.now = self.pending.decision_ns
        if self.position is not None:
            self.position.fill_record = -1  # an index into this chunk's trades only
        self.trades.extend(closed)
        return closed

    def settle(self, trade: dict, pos: Position) -> None:
        """Add a closed trade to its session's result, and stop opening positions for the rest
        of the session once the daily loss limit is reached: a share of the account, or without
        an account size a number of R after commission."""
        c = self.config
        if c.account_usd is None and c.daily_loss_r is None:
            return
        close = pos.force_exit_ns + c.flat_before_close  # the session's close names it
        if c.account_usd is not None:
            result, limit = trade["pnl_usd"], c.account_usd * c.daily_loss_pct / 100
        else:
            risk = abs(pos.entry_px - pos.stop_px) / self.product.tick_size
            result = trade["pnl_usd"] / (risk * self.product.tick_value * pos.contracts)
            limit = c.daily_loss_r
        total = self.session_pnl.get(close, 0.0) + result
        self.session_pnl[close] = total
        if -total >= limit and close not in self.limited:
            self.limited.append(close)
            self.blocked_until = max(self.blocked_until, close)

    def switch_contract(self, contract: str) -> None:
        """Contracts roll at a session open; features restart on the new contract's history."""
        if self.position is not None or self.pending is not None:
            self.abandon("contract_roll")
        self.contract = contract
        self.contracts.append(contract)
        self.pipeline = self.features()
        self.ts_floor = self.book_floor = self.book_recv = 0
        self.quote = None

    def features(self):
        """A new contract's feature rows, from the stage graph that also computes stored rows."""
        from .pipeline import StageFeatures  # its stages import MarketChunk from this module

        c = self.config
        return StageFeatures(
            self.calendar,
            feed_latency=c.feed_latency,
            close_delay=c.close_delay,
            config=self.feature_config,
        )

    def abandon(self, reason: str) -> None:
        """Close an open position at the latest book held (end of data or roll)."""
        if self.pending is not None:
            self.cancelled += 1
            self.pending = None
        if self.position is not None:
            self.trades.append(self.sim.abandon(self.position, self.quote, reason))
            self.position = None

    def finish(self) -> dict:
        self.abandon("end_of_data")
        summary = summarize(self.trades, self.signals, self.cancelled)
        summary |= {
            "expired_orders": self.expired,
            "orders_with_unknown_outcome": self.unwatched,
            "unsized_signals": self.unsized,
            "sessions_at_daily_limit": len(self.limited),
        }
        if self.config.account_usd is not None:
            summary["net_pct"] = 100 * summary["net_usd"] / self.config.account_usd
        return {
            "summary": summary,
            "trades": self.trades,
            "equity": equity_curve(self.trades),
            "quality": {k: asdict(v) for k, v in self.reports.items()},
            "contracts": self.contracts,
        }


def book_view(
    chunk: MarketChunk,
    ends: np.ndarray,
    config: ExecutionConfig,
    quote: Quote | None = None,
    book_floor: int = 0,
    book_recv: int = 0,
) -> BookView:
    """A chunk's book events by slot, then receive order, after the book (`quote`) and the
    latest event and receive times of earlier chunks."""
    book = chunk.book
    if not len(book) or not len(ends):
        return BookView.empty(quote, chunk.coverage)
    assign = assignment_ns(book.ts_event, book.ts_recv, config.feed_latency, config.close_delay)
    slot = np.minimum(np.searchsorted(ends, assign, side="right"), len(ends) - 1)
    order = np.argsort(slot, kind="stable")
    return BookView(
        book.take(order), ends[slot[order]], quote, book_floor, book_recv, chunk.coverage
    )


def session_view(
    chunk: MarketChunk, calendar: SessionCalendar, config: ExecutionConfig
) -> ExecView:
    """A whole session's trades and book for matching orders, read on its own, as
    `Engine.process` builds them for its first chunk: nothing is carried in from an earlier
    session, and the records of the closure before the open set the opening book. For
    simulating would-be trades of stored decision rows without running the stages."""
    ends = calendar.slot_ends(chunk.start, chunk.end, SECOND)
    agg = aggregate(
        chunk.trades,
        ends,
        SECOND,
        chunk.coverage,
        feed_latency=config.feed_latency,
        close_delay=config.close_delay,
    )
    return ExecView.from_aggregation(
        chunk.trades,
        agg.order,
        agg.slot_end,
        config.close_delay,
        book_view(chunk, ends, config),
        chunk.end,
    )


def equity_curve(trades: list[dict]) -> list[dict]:
    total, out = 0.0, []
    for t in trades:
        total += t["pnl_usd"]
        out.append({"exit_ns": t["exit_ns"], "value": total})
    return out


def summarize(trades: list[dict], signals: int, cancelled: int) -> dict:
    pnl = np.array([t["pnl_usd"] for t in trades])
    ticks = np.array([t["pnl_ticks"] for t in trades])
    r = np.array([t["r_multiple"] for t in trades if t["r_multiple"] is not None])
    slips = [t["entry_slip_ticks"] for t in trades if t["entry_slip_ticks"] is not None]
    wins, losses = pnl[pnl > 0].sum(), -pnl[pnl < 0].sum()
    curve = np.cumsum(pnl)
    drawdown = float(np.max(np.maximum.accumulate(np.r_[0, curve]) - np.r_[0, curve]))
    reasons: dict[str, int] = {}
    for t in trades:
        reasons[t["exit_reason"]] = reasons.get(t["exit_reason"], 0) + 1
    return {
        "trades": len(trades),
        "signal_rows": signals,
        "cancelled_orders": cancelled,
        "long": sum(t["direction"] > 0 for t in trades),
        "short": sum(t["direction"] < 0 for t in trades),
        "win_rate": float(np.mean(pnl > 0)) if len(pnl) else None,
        "net_usd": float(pnl.sum()),
        "commission_usd": float(sum(t["commission_usd"] for t in trades)),
        "avg_ticks": float(ticks.mean()) if len(ticks) else None,
        "avg_r": float(r.mean()) if len(r) else None,
        "net_r": float(r.sum()),
        "profit_factor": float(wins / losses) if losses > 0 else None,
        "max_drawdown_usd": drawdown,
        "avg_hold_s": float(np.mean([t["hold_s"] for t in trades])) if trades else None,
        # Entry price against the mid-price held at the decision, in ticks: half the spread
        # plus the market's move while the order travelled (see engine.md).
        "entry_slip_ticks_avg": float(np.mean(slips)) if slips else None,
        "entry_slip_ticks_p90": float(np.percentile(slips, 90)) if slips else None,
        "exit_reasons": reasons,
    }


def split_by_second(
    chunk: MarketChunk, calendar: SessionCalendar, config: ExecutionConfig
) -> list[MarketChunk]:
    """Cut a session chunk into the one-second chunks a live session would process. The slot
    ending at T closes at T + close_delay and releases the trades and book events assigned to
    it; a record received early for a later slot waits for that slot."""
    ends = calendar.slot_ends(chunk.start, chunk.end, SECOND)
    if not len(ends):
        return []

    def by_slot(records: Trades | BookEvents) -> tuple[np.ndarray, list[int]]:
        assign = assignment_ns(
            records.ts_event, records.ts_recv, config.feed_latency, config.close_delay
        )
        slot = np.minimum(np.searchsorted(ends, assign, side="right"), len(ends) - 1)
        order = np.argsort(slot, kind="stable")
        return order, np.searchsorted(slot[order], np.arange(len(ends)), side="right").tolist()

    order, cuts = by_slot(chunk.trades)
    book = chunk.book
    book_order, book_cuts = by_slot(book) if book is not None else (None, cuts)
    out, start, lo, book_lo = [], chunk.start, 0, 0
    for end, hi, book_hi in zip(ends.tolist(), cuts, book_cuts, strict=True):
        out.append(
            MarketChunk(
                chunk.contract,
                start,
                end,
                chunk.trades.take(order[lo:hi]),
                chunk.coverage,
                chunk.session,
                chunk.tradable,
                book.take(book_order[book_lo:book_hi]) if book is not None else None,
            )
        )
        start, lo, book_lo = end, hi, book_hi
    return out
