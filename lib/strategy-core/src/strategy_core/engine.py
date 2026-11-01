"""One event-time engine for backtests and live sessions.

The engine consumes `MarketChunk`s: a session's trades at once in a backtest, or one
second's trades as they arrive in a live or rehearsal session. Both paths run the same
code and must produce identical features, decisions, and fills; tests and the
`research verify` command check this. A run is one portfolio: one position at a time.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .bars import AggregationReport, aggregate, assignment_times
from .execution import ExecutionConfig, ExecView, Position, Simulator
from .features import FeatureConfig, FeatureFrame, FeaturePipeline
from .market import SECOND, Product, SessionCalendar, Trades
from .strategies import Strategy


@dataclass(frozen=True)
class MarketChunk:
    """One contract's trades assigned to the scheduled slots ending in `(start, end]`, in
    receive order. A session chunk also carries trades assigned to the closure before it;
    aggregation reports those as outside the schedule and execution ignores them."""

    contract: str
    start: int
    end: int
    trades: Trades
    coverage: np.ndarray  # (n, 2) int64 [start, end) intervals with data
    session: str = ""
    tradable: bool = True  # False for warmup chunks


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
        self.sim = Simulator(product, self.config, strategy.bracket, calendar)
        self.contract = ""
        self.pipeline = FeaturePipeline(self.calendar, self.feature_config)
        self.pending: Position | None = None
        self.position: Position | None = None
        self.now = 0  # latest time the engine knows the position state for
        self.cooldown_until = 0
        self.ts_floor = 0
        self.last: tuple | None = None  # (view, index): latest trade after the open entry
        self.trades: list[dict] = []
        self.cancelled = 0
        self.signals = 0
        self.reports: dict[str, AggregationReport] = {}
        self.contracts: list[str] = []

    def process(self, chunk: MarketChunk) -> ChunkResult:
        if chunk.contract != self.contract:
            self.switch_contract(chunk.contract)
        c = self.config
        ends = self.calendar.slot_ends(chunk.start, chunk.end, SECOND)
        agg = aggregate(
            chunk.trades,
            ends,
            SECOND,
            chunk.coverage,
            feed_latency=c.feed_latency,
            close_delay=c.close_delay,
        )
        self.reports.setdefault(chunk.session, AggregationReport()).add(agg.report)
        frame = self.pipeline.update(agg.bars)
        signals = np.zeros(len(frame), np.int8)
        if chunk.tradable and len(frame):
            signals = self.strategy.signals(frame.features).astype(np.int8)
            close = self.calendar.close_after(frame.end)
            signals[(close - frame.end) <= c.flat_before_close] = 0
            signals[~np.isfinite(frame.context["atr"])] = 0
        self.signals += int(np.count_nonzero(signals))
        view = ExecView.from_aggregation(
            chunk.trades, agg.order, agg.slot_end, c.close_delay, self.ts_floor
        )
        if view.n:
            self.ts_floor = int(view.ts_max[-1])
        closed = self.execute(view, frame, signals)
        self.remember_last_trade(view)
        return ChunkResult(frame, signals, view, closed)

    def remember_last_trade(self, view: ExecView) -> None:
        """While a position is open, keep the latest trade at or after its entry across chunks,
        so an end-of-data or roll close never prices against an earlier trade (receive order
        can deliver late, earlier-timestamped trades in a later chunk)."""
        if self.position is None or not view.n:
            return
        after = np.flatnonzero(view.t.ts_event >= self.position.entry_ns)
        if len(after):
            self.last = (view, int(after[-1]))

    def execute(self, view: ExecView, frame: FeatureFrame, signals: np.ndarray) -> list[dict]:
        closed: list[dict] = []
        candidates = np.flatnonzero(signals)
        decisions = frame.end[candidates] + self.config.close_delay
        j = 0
        while True:
            if self.pending is not None:
                k = self.sim.fill(view, j, self.pending)
                if k == view.n:
                    break
                if k < 0:  # cancelled at the forced-exit time
                    self.cancelled += 1
                    self.now = self.pending.force_exit_ns
                    self.pending = None
                    continue
                self.position, self.pending, j = self.pending, None, k + 1
                continue
            if self.position is not None:
                j, trade = self.sim.advance(view, j, self.position)
                if trade is None:
                    break
                closed.append(trade)
                self.position = None
                self.now = int(trade["exit_known_ns"])
                self.cooldown_until = self.now + self.config.cooldown
                continue
            # Flat: the next signal decided strictly after the latest known state.
            ci = int(np.searchsorted(decisions, max(self.now, self.cooldown_until), "right"))
            if ci >= len(candidates):
                break
            i = int(candidates[ci])
            self.pending = self.sim.order(
                int(signals[i]),
                self.contract,
                int(frame.end[i]),
                float(frame.context["atr"][i]),
                frame.row(i),
            )
            self.now = self.pending.decision_ns
        self.trades.extend(closed)
        return closed

    def switch_contract(self, contract: str) -> None:
        """Contracts roll at a session open; features restart on the new contract's history."""
        if self.position is not None or self.pending is not None:
            self.abandon("contract_roll")
        self.contract = contract
        self.contracts.append(contract)
        self.pipeline = FeaturePipeline(self.calendar, self.feature_config)
        self.ts_floor = 0

    def abandon(self, reason: str) -> None:
        """Close an open position at the book of the latest trade after its entry (end of data
        or roll)."""
        if self.pending is not None:
            self.cancelled += 1
            self.pending = None
        if self.position is not None and self.last is not None:
            view, k = self.last
            trade = self.sim.close(view, k, self.position, reason, None)
            trade["flags"] = sorted({*trade["flags"], "abandoned"})
            self.trades.append(trade)
            self.position = None

    def finish(self) -> dict:
        self.abandon("end_of_data")
        return {
            "summary": summarize(self.trades, self.signals, self.cancelled),
            "trades": self.trades,
            "equity": equity_curve(self.trades),
            "quality": {k: asdict(v) for k, v in self.reports.items()},
            "contracts": self.contracts,
        }


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
    delays = [t["entry_delay_ms"] for t in trades]
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
        "profit_factor": float(wins / losses) if losses > 0 else None,
        "max_drawdown_usd": drawdown,
        "avg_hold_s": float(np.mean([t["hold_s"] for t in trades])) if trades else None,
        # Signal end to entry fill. TBBO shows the book only at trades, so long delays mean the
        # fill price is the book at the next trade, not at order arrival (see engine.md).
        "entry_delay_ms_p50": float(np.percentile(delays, 50)) if trades else None,
        "entry_delay_ms_p90": float(np.percentile(delays, 90)) if trades else None,
        "exit_reasons": reasons,
    }


def split_by_second(
    chunk: MarketChunk, calendar: SessionCalendar, config: ExecutionConfig
) -> list[MarketChunk]:
    """Cut a session chunk into the one-second chunks a live session would process. The slot
    ending at T closes at T + close_delay and releases the trades assigned to it; a trade
    received early for a later slot waits for that slot."""
    ends = calendar.slot_ends(chunk.start, chunk.end, SECOND)
    if not len(ends):
        return []
    assign = assignment_times(chunk.trades, config.feed_latency, config.close_delay)
    slot = np.minimum(np.searchsorted(ends, assign, side="right"), len(ends) - 1)
    order = np.argsort(slot, kind="stable")
    cuts = np.searchsorted(slot[order], np.arange(len(ends)), side="right")
    out, start, lo = [], chunk.start, 0
    for end, hi in zip(ends.tolist(), cuts.tolist(), strict=True):
        out.append(
            MarketChunk(
                chunk.contract,
                start,
                end,
                chunk.trades.take(order[lo:hi]),
                chunk.coverage,
                chunk.session,
                chunk.tradable,
            )
        )
        start, lo = end, hi
    return out
