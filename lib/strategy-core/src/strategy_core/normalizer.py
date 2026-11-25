"""The ATR that normalizes, floored at the spread (docs/project/roadmap.md, decision 23).

Values "in ATRs" divide a price distance by a window's ATR. When a market stops moving, that
ATR decays toward zero and such values grow without bound, although nothing moved. A market
cannot be traded more finely than its spread, so the normalizer is the larger of the ATR and
the last sampled book spread, both in basis points of price. Where the ATR is above the
spread, which is almost everywhere, nothing changes. The ATR itself (`atr_bps`, `atr_price`)
is never floored: it stays the measure of how much the market moves.

The spread is the one the swing threshold's floor uses: from the last trade with a usable
book, carried from row to row, and unknown from a missing row until the next usable book.
Without a known spread the normalizer is the ATR.
"""

import numpy as np

from .bars import MISSING
from .market import PX

FLOOR = 1.0  # spreads


def last_spread_bps(
    status: np.ndarray, valid: np.ndarray, bid: np.ndarray, ask: np.ndarray, carry: np.ndarray
) -> np.ndarray:
    """The last sampled book spread as of each row, in bps of its midpoint: from the latest row
    with a usable book (`valid`; `bid` and `ask` are fixed-point), in this call or carried
    (`carry`: has, bid, ask; updated in place), and unknown from a missing row until the next
    usable book."""
    m = len(status)
    if not m:
        return np.zeros(0)
    index = np.arange(m)
    gap = np.maximum.accumulate(np.where(status == MISSING, index, -1))
    i = np.maximum.accumulate(np.where(valid, index, -1))
    fresh = (i >= 0) & (i > gap)
    known = fresh | ((gap < 0) & bool(carry[0]))
    at = np.maximum(i, 0)
    # in quoted prices, as `candle_1m_1s.book_spread_bps` computes the same spread
    b = np.where(fresh, bid[at], carry[1]) / PX
    a = np.where(fresh, ask[at], carry[2]) / PX
    if fresh[-1]:
        carry[:] = (1, bid[i[-1]], ask[i[-1]])
    elif gap[-1] >= 0:
        carry[0] = 0
    with np.errstate(divide="ignore", invalid="ignore"):
        spread = (a - b) / ((a + b) / 2) * 1e4
    return np.where(known & np.isfinite(spread), spread, np.nan)


def floored(atr: np.ndarray, spread: np.ndarray) -> np.ndarray:
    """The normalizing ATR: `atr`, or `FLOOR` spreads where the spread is known and that is
    larger (both in the same unit). An undefined ATR stays undefined, and where the floor does
    not bind the ATR is returned bit for bit."""
    with np.errstate(invalid="ignore"):
        floor = FLOOR * spread
        return np.where(np.isfinite(atr) & np.isfinite(floor) & (floor > atr), floor, atr)
