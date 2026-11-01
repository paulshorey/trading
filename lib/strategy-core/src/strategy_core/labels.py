"""Training rows for ML: one would-be trade per candidate decision.

Each row holds the exact normalized features seen at the decision and the outcome of
the trade the strategy would have placed, simulated independently of the portfolio
with the engine's execution rules (same fills, bracket, costs). Outcomes look into
the future, so rows are built only from complete historical sessions. Rows overlap in
time; keep `decision_ns` and `exit_ns` for purged, chronological splits.
"""

from collections.abc import Iterable, Iterator

import numpy as np

from .execution import ExecView, Position, Simulator
from .features import FeatureFrame

UNFILLED, CENSORED = "unfilled", "censored"
DELAY_BINS_MS = 60_000  # one-millisecond bins up to a minute; slower fills share the last bin


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
        atr = float(frame.context["atr"][i])
        if not np.isfinite(atr):
            continue
        pos = sim.order(int(signals[i]), contract, int(frame.end[i]), atr, frame.row(i))
        k = sim.fill(view, 0, pos)
        if k < 0 or k >= view.n:  # cancelled at the forced-exit time, or no trade in time
            yield marker(pos, UNFILLED)
            continue
        j, trade = k + 1, None
        while trade is None and j < view.n:
            j, trade = sim.advance(view, j, pos)
        yield trade if trade is not None else marker(pos, CENSORED)


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
    they are produced, and the delay median comes from a fixed millisecond histogram."""

    def __init__(self):
        self.rows = self.wins = self.r_count = 0
        self.usd = self.r_sum = 0.0
        self.not_closed = {UNFILLED: 0, CENSORED: 0}
        self.delays = np.zeros(DELAY_BINS_MS + 1, np.int64)
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
            self.delays[min(max(int(row["entry_delay_ms"]), 0), DELAY_BINS_MS)] += 1
            self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def result(self) -> dict:
        out = {"rows": self.rows, **self.not_closed}
        if not self.rows:
            return out
        median_ms = int(np.searchsorted(np.cumsum(self.delays), (self.rows + 1) // 2))
        return {
            **out,
            "win_rate": self.wins / self.rows,
            "avg_usd": self.usd / self.rows,
            "avg_r": self.r_sum / self.r_count if self.r_count else None,
            "entry_delay_ms_p50": float(median_ms),  # to the millisecond
            "exit_reasons": dict(sorted(self.reasons.items())),
        }


def summarize_candidates(rows: Iterable[dict]) -> dict:
    summary = CandidateSummary()
    summary.add(rows)
    return summary.result()
