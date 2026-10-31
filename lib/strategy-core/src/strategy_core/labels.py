"""Training rows for ML: one would-be trade per candidate decision.

Each row holds the exact normalized features seen at the decision and the outcome of
the trade the strategy would have placed, simulated independently of the portfolio
with the engine's execution rules (same fills, bracket, costs). Outcomes look into
the future, so rows are built only from complete historical sessions. Rows overlap in
time; keep `decision_ns` and `exit_ns` for purged, chronological splits.
"""

import numpy as np

from .execution import ExecView, Simulator
from .features import FeatureFrame


def candidate_outcomes(
    sim: Simulator,
    contract: str,
    frame: FeatureFrame,
    signals: np.ndarray,
    view: ExecView,
    max_rows: int | None = None,
) -> list[dict]:
    """`frame`, `signals`, and `view` come from one whole-session `Engine.process` call."""
    rows: list[dict] = []
    for i in np.flatnonzero(signals)[:max_rows]:
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
            rows.append(trade)
    return rows


def summarize_candidates(rows: list[dict]) -> dict:
    if not rows:
        return {"rows": 0}
    pnl = np.array([r["pnl_usd"] for r in rows])
    r = np.array([x["r_multiple"] for x in rows if x["r_multiple"] is not None])
    return {
        "rows": len(rows),
        "win_rate": float(np.mean(pnl > 0)),
        "avg_usd": float(pnl.mean()),
        "avg_r": float(r.mean()) if len(r) else None,
        "entry_delay_ms_p50": float(np.median([x["entry_delay_ms"] for x in rows])),
        "exit_reasons": {
            k: int(v)
            for k, v in zip(
                *np.unique([x["exit_reason"] for x in rows], return_counts=True), strict=True
            )
        },
    }
