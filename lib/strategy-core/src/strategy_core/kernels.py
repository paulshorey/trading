"""Per-phase indicator kernels, compiled with numba.

Each indicator keeps one state per phase. Step `i` advances only the state of
`phase[i]`, so phase `k` sees an ordinary series of candles one period apart and the
formulas stay standard. State arrays are updated in place, which lets a session be
processed in one call or one step per call with identical results.

Gap policy: an invalid candle (gap, empty, warmup) outputs NaN and leaves the
averages unchanged; the next valid candle of that phase only re-seeds the previous
close, so no change is ever measured across a missing candle.
"""

import numpy as np
from numba import njit


@njit(cache=True)
def wilder_rsi(close, valid, phase, period, prev, gain, loss, count, out):
    n = period
    for i in range(close.shape[0]):
        p = phase[i]
        if not valid[i]:
            prev[p] = np.nan
            out[i] = np.nan
            continue
        x = close[i]
        if np.isnan(prev[p]):
            prev[p] = x
            out[i] = np.nan
            continue
        d = x - prev[p]
        prev[p] = x
        g = d if d > 0.0 else 0.0
        lo = -d if d < 0.0 else 0.0
        c = count[p] + 1
        count[p] = c
        if c <= n:  # seed with the simple mean of the first n changes
            gain[p] += g / n
            loss[p] += lo / n
        else:
            gain[p] = (gain[p] * (n - 1) + g) / n
            loss[p] = (loss[p] * (n - 1) + lo) / n
        if c < n:
            out[i] = np.nan
        elif loss[p] == 0.0:
            out[i] = 100.0 if gain[p] > 0.0 else 50.0
        else:
            out[i] = 100.0 - 100.0 / (1.0 + gain[p] / loss[p])


@njit(cache=True)
def wilder_atr(high, low, close, valid, phase, period, prev, atr, count, out):
    """Average true range in price units. Callers normalize it before use as a feature."""
    n = period
    for i in range(close.shape[0]):
        p = phase[i]
        if not valid[i]:
            prev[p] = np.nan
            out[i] = np.nan
            continue
        tr = high[i] - low[i]
        if not np.isnan(prev[p]):
            tr = max(high[i], prev[p]) - min(low[i], prev[p])
        prev[p] = close[i]
        c = count[p] + 1
        count[p] = c
        if c <= n:
            atr[p] += tr / n
        else:
            atr[p] = (atr[p] * (n - 1) + tr) / n
        out[i] = atr[p] if c >= n else np.nan


@njit(cache=True)
def phase_change(x, valid, phase, prev, out):
    """Change since the same phase one period earlier (NaN across a missing candle)."""
    for i in range(x.shape[0]):
        p = phase[i]
        if not valid[i]:
            prev[p] = np.nan
            out[i] = np.nan
            continue
        out[i] = x[i] - prev[p]
        prev[p] = x[i]


@njit(cache=True)
def ema_prior(x, valid, phase, period, ema, count, out):
    """Same-phase EMA of earlier periods, read before the current value updates it."""
    alpha = 2.0 / (period + 1.0)
    for i in range(x.shape[0]):
        p = phase[i]
        if not valid[i]:
            out[i] = np.nan
            continue
        out[i] = ema[p] if count[p] >= period else np.nan
        if count[p] == 0:
            ema[p] = x[i]
        else:
            ema[p] += alpha * (x[i] - ema[p])
        count[p] += 1


class PhaseState:
    """Named per-phase state arrays for one indicator instance."""

    def __init__(self, phases: int, **arrays: str):
        for name, kind in arrays.items():
            if kind == "nan":
                value = np.full(phases, np.nan)
            elif kind == "count":
                value = np.zeros(phases, np.int64)
            else:
                value = np.zeros(phases)
            setattr(self, name, value)
