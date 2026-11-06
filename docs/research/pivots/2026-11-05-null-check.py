"""Seeded Monte Carlo check of the random-walk nulls in 2026-11-05-early-confirmation-update.md.

Run from the repository root:

    uv run --no-sync python docs/research/pivots/2026-11-05-null-check.py

Distances are in units of the candidate's frozen threshold theta, and time is scaled so a
driftless walk has variance 1 per unit time. kappa = 2 * mu * theta / sigma**2.

1. First passage, no horizon: P(reach +u before -d) for drift kappa / 2, against
   (1 - exp(kappa d)) / (exp(-kappa u) - exp(kappa d)), which is d / (u + d) at kappa = 0.
2. Overshoot: the mean running maximum at the first drawdown of 1 theta, against
   (e^kappa - 1) / kappa, which is 1 at kappa = 0 (Lehoczky, 1977).
3. Discrete horizon: three-outcome probabilities for k steps of standard deviation s, showing
   that equal s * sqrt(k) does not give equal probabilities on a discrete path.

A fine step (DT) approximates continuous monitoring; it overshoots barriers slightly, so the
simulated values differ from the formulas by small amounts of either sign. Exits 1 if any
check misses its tolerance.
"""

import math
import sys

import numpy as np

DT = 2e-4
PATHS = 20_000
SEED = 7
TOL_PASSAGE = 0.015
TOL_OVERSHOOT = 0.04


def passage_formula(u: float, d: float, kappa: float) -> float:
    if abs(kappa) < 1e-12:
        return d / (u + d)
    return (1 - math.exp(kappa * d)) / (math.exp(-kappa * u) - math.exp(kappa * d))


def passage_simulated(u: float, d: float, kappa: float, rng: np.random.Generator) -> float:
    x = np.zeros(PATHS)
    alive = np.ones(PATHS, bool)
    up = np.zeros(PATHS, bool)
    while alive.any():
        x[alive] += kappa / 2 * DT + math.sqrt(DT) * rng.standard_normal(alive.sum())
        hit_up = alive & (x >= u)
        hit_down = alive & (x <= -d)
        up |= hit_up
        alive &= ~(hit_up | hit_down)
    return float(up.mean())


def overshoot_formula(kappa: float) -> float:
    return 1.0 if abs(kappa) < 1e-12 else (math.exp(kappa) - 1) / kappa


def overshoot_simulated(kappa: float, rng: np.random.Generator) -> float:
    x = np.zeros(PATHS)
    peak = np.zeros(PATHS)
    alive = np.ones(PATHS, bool)
    while alive.any():
        x[alive] += kappa / 2 * DT + math.sqrt(DT) * rng.standard_normal(alive.sum())
        peak = np.maximum(peak, x)
        alive &= (peak - x) < 1.0
    return float(peak.mean())


def discrete_outcomes(u: float, d: float, s: float, k: int, paths: int, rng: np.random.Generator):
    x = np.zeros(paths)
    state = np.zeros(paths, np.int8)  # 0 open, 1 reversal, 2 invalidation
    for _ in range(k):
        open_ = state == 0
        x[open_] += s * rng.standard_normal(open_.sum())
        state[open_ & (x >= u)] = 1
        state[open_ & (x <= -d) & (state == 0)] = 2
    return tuple(float((state == c).mean()) for c in (1, 2, 0))


def main() -> int:
    rng = np.random.default_rng(SEED)
    failures = 0
    print(f"seed {SEED}, {PATHS} paths, step {DT}")
    for x, r, c, kappa in [
        (0.25, 1, 0.25, 0.0),
        (0.5, 1, 0.25, 0.0),
        (0.5, 1, 0.25, 1.0),
        (0.25, 1, 0.25, -2.0),
    ]:
        u, d = r - x, x + c
        want = passage_formula(u, d, kappa)
        got = passage_simulated(u, d, kappa, rng)
        ok = abs(got - want) <= TOL_PASSAGE
        failures += not ok
        print(
            f"passage x={x} R={r} C={c} kappa={kappa:+}: "
            f"formula {want:.4f} simulated {got:.4f} {'ok' if ok else 'FAIL'}"
        )
    for kappa in (0.0, 1.0, -1.0):
        want = overshoot_formula(kappa)
        got = overshoot_simulated(kappa, rng)
        ok = abs(got - want) <= TOL_OVERSHOOT
        failures += not ok
        print(
            f"overshoot kappa={kappa:+}: "
            f"formula {want:.4f} simulated {got:.4f} {'ok' if ok else 'FAIL'}"
        )
    u, d = 0.75, 0.5  # x = 0.25, R = 1, C = 0.25
    coarse = discrete_outcomes(u, d, 1.0, 1, 200_000, rng)
    fine = discrete_outcomes(u, d, 0.1, 100, 200_000, rng)
    print(
        f"discrete k=1 s=1 (reversal, invalidation, timeout): {tuple(round(p, 3) for p in coarse)}"
    )
    print(f"discrete k=100 s=0.1: {tuple(round(p, 3) for p in fine)}")
    ok = abs(coarse[2] - fine[2]) > 0.2
    failures += not ok
    print(f"equal s*sqrt(k), different timeout probability: {'ok' if ok else 'FAIL'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
