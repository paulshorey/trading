"""Training rows for ML: one would-be trade per candidate decision.

Each row holds the exact normalized features seen at the decision and the outcome of
the trade the strategy would have placed, simulated independently of the portfolio
with the engine's execution rules (same fills, bracket, costs). Outcomes look into
the future, so rows are built only from complete historical sessions. Rows overlap in
time; keep `decision_ns` and `exit_ns` for purged, chronological splits.
"""

from collections.abc import Iterable, Iterator

import numpy as np

from .execution import CANCELLED, WAIT, ExecView, Position, Simulator, bracket_atr
from .execution import EXPIRED as ORDER_EXPIRED
from .features import FeatureFrame

UNFILLED, CENSORED = "unfilled", "censored"
# What became of one attempted entry (`attempt`). Only the first is a trade result; only the
# first two give the value of attempting the entry (the result, or zero); the rest are unknown.
CLOSED = "closed"  # a trade closed at prices the book showed
LATE = "late"  # the order arrived at or after the forced exit: known, and no trade
ENTRY_NO_BOOK = "entry_no_book"  # the order met no usable book: whether it traded is unknown
EXIT_NO_BOOK = "exit_no_book"  # the exit was priced without a book, at a fallback price
PENDING = "pending"  # the data ended before the order arrived
STATES = (CLOSED, LATE, ENTRY_NO_BOOK, EXIT_NO_BOOK, PENDING, CENSORED)
EXPIRED = "expired"  # a resting limit entry was never filled: known, and no trade


def attempt(sim: Simulator, view: ExecView, pos: Position) -> tuple[str, dict | None, int]:
    """Send one would-be entry and follow it to its exit, independently of any portfolio.
    Returns its state, the trade when there is one (also for `exit_no_book`, whose prices are
    not executable), and when the engine would learn the outcome (0 while unknown)."""
    status, known = sim.fill(view, pos)
    if status == WAIT:
        return PENDING, None, 0
    if status == CANCELLED:
        return (LATE if pos.arrival_ns >= pos.force_exit_ns else ENTRY_NO_BOOK), None, known
    _, trade = sim.advance(view, 0, pos)
    if trade is None:
        return CENSORED, None, 0
    state = EXIT_NO_BOOK if "no_book" in trade["flags"] else CLOSED
    return state, trade, int(trade["exit_known_ns"])


def attempt_limit(
    sim: Simulator, view: ExecView, pos: Position, limit_px: int, expire_ns: int
) -> tuple[str, dict | None, int]:
    """`attempt` with the entry as a limit order resting at `limit_px` (0: the touch of the
    book it meets) until `expire_ns` (`Simulator.rest`). An order that is never filled is
    `EXPIRED`: known, and no trade."""
    pos.limit_px, pos.expire_ns = limit_px, expire_ns
    status, known, j = sim.rest(view, pos)
    if status == WAIT:
        return PENDING, None, 0
    if status == ORDER_EXPIRED:
        return EXPIRED, None, known
    if status == CANCELLED:
        return (LATE if pos.arrival_ns >= pos.force_exit_ns else ENTRY_NO_BOOK), None, known
    _, trade = sim.advance(view, j, pos)
    if trade is None:
        return CENSORED, None, 0
    state = EXIT_NO_BOOK if "no_book" in trade["flags"] else CLOSED
    return state, trade, int(trade["exit_known_ns"])


def iter_candidate_outcomes(
    sim: Simulator,
    contract: str,
    frame: FeatureFrame,
    signals: np.ndarray,
    view: ExecView,
) -> Iterator[dict]:
    """Yield one row per signal: the closed would-be trade, or a marker row whose
    `exit_reason` is "unfilled" (the entry never filled) or "censored" (the position was
    still open when the session's data ended). Marker rows keep datasets from silently
    dropping signals. `frame`, `signals`, and `view` come from one whole-session
    `Engine.process` call."""
    for i in np.flatnonzero(signals):
        atr = float(bracket_atr(frame.context, sim.bracket)[i])
        if not np.isfinite(atr):
            continue
        pos = sim.order(int(signals[i]), contract, int(frame.end[i]), atr, frame.row(i), view)
        state, trade, _ = attempt(sim, view, pos)
        if trade is not None:
            yield trade
        else:  # cancelled, or the session's data ends before the order arrives or the exit
            yield marker(pos, CENSORED if state == CENSORED else UNFILLED)


def marker(pos: Position, reason: str) -> dict:
    return {
        "contract": pos.contract,
        "direction": pos.direction,
        "signal_end_ns": str(pos.signal_end),
        "decision_ns": str(pos.decision_ns),
        "entry_ns": str(pos.entry_ns) if pos.entry_ns else None,
        "exit_reason": reason,
        "features": pos.features,
    }


def candidate_outcomes(*args, **kwargs) -> list[dict]:
    return list(iter_candidate_outcomes(*args, **kwargs))


class CandidateSummary:
    """Running statistics of would-be trades in bounded memory: long runs fold rows in as
    they are produced."""

    def __init__(self):
        self.rows = self.wins = self.r_count = self.slip_count = 0
        self.usd = self.r_sum = self.slip_sum = 0.0
        self.not_closed = {UNFILLED: 0, CENSORED: 0}
        self.reasons: dict[str, int] = {}

    def add(self, rows: Iterable[dict]) -> None:
        for row in rows:
            reason = row["exit_reason"]
            if reason in self.not_closed:
                self.not_closed[reason] += 1
                continue
            self.rows += 1
            self.wins += row["pnl_usd"] > 0
            self.usd += row["pnl_usd"]
            if row["r_multiple"] is not None:
                self.r_sum += row["r_multiple"]
                self.r_count += 1
            if row["entry_slip_ticks"] is not None:
                self.slip_sum += row["entry_slip_ticks"]
                self.slip_count += 1
            self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def result(self) -> dict:
        out = {"rows": self.rows, **self.not_closed}
        if not self.rows:
            return out
        return {
            **out,
            "win_rate": self.wins / self.rows,
            "avg_usd": self.usd / self.rows,
            "avg_r": self.r_sum / self.r_count if self.r_count else None,
            "entry_slip_ticks_avg": self.slip_sum / self.slip_count if self.slip_count else None,
            "exit_reasons": dict(sorted(self.reasons.items())),
        }


def summarize_candidates(rows: Iterable[dict]) -> dict:
    summary = CandidateSummary()
    summary.add(rows)
    return summary.result()
