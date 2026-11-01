"""Training rows for ML: one would-be trade per candidate decision.

Each row holds the exact normalized features seen at the decision and the outcome of
the trade the strategy would have placed, simulated independently of the portfolio
with the engine's execution rules (same fills, bracket, costs). Outcomes look into
the future, so rows are built only from complete historical sessions. Rows overlap in
time; keep `decision_ns` and `exit_ns` for purged, chronological splits.
"""

from collections.abc import Iterable, Iterator

import numpy as np

from .execution import ExecView, Simulator
from .features import FeatureFrame


def iter_candidate_outcomes(
    sim: Simulator,
    contract: str,
    frame: FeatureFrame,
    signals: np.ndarray,
    view: ExecView,
) -> Iterator[dict]:
    """Yield one would-be trade per signal row. `frame`, `signals`, and `view` come from one
    whole-session `Engine.process` call."""
    for i in np.flatnonzero(signals):
        atr = float(frame.context["atr"][i])
        if not np.isfinite(atr):
            continue
        pos = sim.order(int(signals[i]), contract, int(frame.end[i]), atr, frame.row(i))
        k = sim.fill(view, 0, pos)
        if k < 0 or k >= view.n:
            continue  # cancelled at the forced-exit time, or no trade before data ended
        j, trade = k + 1, None
        while trade is None and j < view.n:
            j, trade = sim.advance(view, j, pos)
        if trade is not None:
            yield trade


def candidate_outcomes(*args, **kwargs) -> list[dict]:
    return list(iter_candidate_outcomes(*args, **kwargs))


class CandidateSummary:
    """Running statistics of would-be trades. Long runs fold rows in as they are produced
    instead of keeping every row and its features."""

    def __init__(self):
        self.rows = self.wins = self.r_count = 0
        self.usd = self.r_sum = 0.0
        self.delays: list[float] = []  # one float per row, for the median
        self.reasons: dict[str, int] = {}

    def add(self, rows: Iterable[dict]) -> None:
        for row in rows:
            self.rows += 1
            self.wins += row["pnl_usd"] > 0
            self.usd += row["pnl_usd"]
            if row["r_multiple"] is not None:
                self.r_sum += row["r_multiple"]
                self.r_count += 1
            self.delays.append(row["entry_delay_ms"])
            self.reasons[row["exit_reason"]] = self.reasons.get(row["exit_reason"], 0) + 1

    def result(self) -> dict:
        if not self.rows:
            return {"rows": 0}
        return {
            "rows": self.rows,
            "win_rate": self.wins / self.rows,
            "avg_usd": self.usd / self.rows,
            "avg_r": self.r_sum / self.r_count if self.r_count else None,
            "entry_delay_ms_p50": float(np.median(self.delays)),
            "exit_reasons": dict(sorted(self.reasons.items())),
        }


def summarize_candidates(rows: Iterable[dict]) -> dict:
    summary = CandidateSummary()
    summary.add(rows)
    return summary.result()
