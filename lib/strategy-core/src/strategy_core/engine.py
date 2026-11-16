"""One event-time engine for backtests and live sessions.

The engine consumes `MarketChunk`s: a session's trades and book events at once in a
backtest, or one second's as they arrive in a live or rehearsal session. Both paths run the same
code and must produce identical features, decisions, and fills; tests and the
`research verify` command check this. A run is one portfolio: one position at a time.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .bars import AggregationReport, aggregate, assignment_ns
from .execution import (
    CANCELLED,
    WAIT,
    BookView,
    ExecutionConfig,
    ExecView,
    Position,
    Quote,
    Simulator,
)
from .features import FeatureConfig, FeatureFrame
from .market import SECOND, BookEvents, Product, SessionCalendar, Trades
from .strategies import Strategy


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
        self.sim = Simulator(product, self.config, strategy.bracket, calendar)
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
        self.signals = 0
        self.reports: dict[str, AggregationReport] = {}
        self.contracts: list[str] = []

    def process(self, chunk: MarketChunk) -> ChunkResult:
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
        frame = self.pipeline.update(chunk)
        signals = np.zeros(len(frame), np.int8)
        if chunk.tradable and len(frame):
            signals = self.strategy.signals(frame.features).astype(np.int8)
            close = self.calendar.close_after(frame.end)
            signals[(close - frame.end) <= c.flat_before_close] = 0
            signals[~np.isfinite(frame.context["atr"])] = 0
        self.signals += int(np.count_nonzero(signals))
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
        closed = self.execute(view, frame, signals)
        if view.book.n:
            book = view.book
            self.book_floor, self.book_recv = int(book.ts_max[-1]), book.recv_max
            self.quote = book.last
        return ChunkResult(frame, signals, view, closed)

    def book_view(self, chunk: MarketChunk, ends: np.ndarray) -> BookView:
        """The chunk's book events by slot, then receive order, as a live session releases
        them. A chunk without a book (a warm-up session) leaves no book to carry forward."""
        book = chunk.book
        if book is None:
            if chunk.tradable and (self.signals or self.pending or self.position):
                raise ValueError(f"Tradable chunk {chunk.session!r} has no book events to fill at")
            self.quote = None
            return BookView.empty()
        if not len(book) or not len(ends):
            return BookView.empty(self.quote)
        c = self.config
        assign = assignment_ns(book.ts_event, book.ts_recv, c.feed_latency, c.close_delay)
        slot = np.minimum(np.searchsorted(ends, assign, side="right"), len(ends) - 1)
        order = np.argsort(slot, kind="stable")
        return BookView(
            book.take(order), ends[slot[order]], self.quote, self.book_floor, self.book_recv
        )

    def execute(self, view: ExecView, frame: FeatureFrame, signals: np.ndarray) -> list[dict]:
        closed: list[dict] = []
        candidates = np.flatnonzero(signals)
        decisions = frame.end[candidates] + self.config.close_delay
        j = 0
        while True:
            if self.pending is not None:
                status, known = self.sim.fill(view, self.pending)
                if status == WAIT:
                    break
                if status == CANCELLED:  # at the forced-exit time, or no book to fill at
                    self.cancelled += 1
                    self.now = max(self.now, known)
                    self.pending = None
                    continue
                self.position, self.pending = self.pending, None
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
                view,
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
