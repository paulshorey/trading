"""The decision model's training target (docs/project/yardstick-spec.md): the move ahead, in R.

At a decision the reference price is the mid-price of the book the engine holds, and one R is
a distance fixed then (a multiple of a timeframe's ATR: the distance to the stop and to the
target). Trades are read in order from the decision until the session's forced exit:

- `+1` if price reaches one R above the reference first, `-1` if it reaches one R below first;
- otherwise the move of the mid-price at the forced exit, in R, which lies between them.

Costs are not in the target, so it is symmetric: what a short would see is its negative. It is
exactly what a trade held to its stop, its target, or the close earns before costs. A target
looks into the future: it is computed for training and evaluation only and is never an input.

A decision whose follow-up loses data coverage, or that ends without a usable book, has no
target (`UNKNOWN`): it is left out and counted, never filled in.
"""

import numpy as np
from numba import njit

from .execution import ExecView, merged

KNOWN, UNKNOWN_BOOK, UNKNOWN_COVERAGE = 0, 1, 2  # why a row has a target, or has none
REASONS = {UNKNOWN_BOOK: "no_usable_book_at_the_end", UNKNOWN_COVERAGE: "data_coverage_ends"}


@njit(cache=True)
def _first_passage(price, start, stop, upper, lower):
    """For each row, the first trade in `price[start:stop]` at or beyond a barrier: +1 with its
    index for the upper one, -1 for the lower one, else 0 and -1."""
    n = len(start)
    side, at = np.zeros(n, np.int8), np.full(n, -1, np.int64)
    for i in range(n):
        for k in range(start[i], stop[i]):
            if price[k] >= upper[i]:
                side[i], at[i] = 1, k
                break
            if price[k] <= lower[i]:
                side[i], at[i] = -1, k
                break
    return side, at


def mid(view: ExecView, time: int) -> float:
    """The mid-price of the book the exchange showed at `time` (fixed-point), or NaN when it
    showed no usable book."""
    quote = view.book.at(time)
    return (quote.bid + quote.ask) / 2 if quote is not None and quote.usable else np.nan


def move_ahead(
    view: ExecView,
    coverage: np.ndarray,
    decision: np.ndarray,
    until: np.ndarray,
    reference: np.ndarray,
    distance: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The target of each decision: made at `decision` (UTC ns) with the reference price
    `reference` and one R of `distance` (both fixed-point, as trade prices), followed until
    `until` (its session's forced exit). Returns the target, when it was settled, and why it is
    known or not (`KNOWN`, `UNKNOWN_BOOK`, `UNKNOWN_COVERAGE`); an unknown target is NaN.

    `view` holds the session's trades and book in the order the engine processes them. A trade
    counts by its own event time, from the decision on and before `until`; a price exactly on
    a barrier reaches it."""
    n = len(decision)
    start = np.searchsorted(view.ts_max, decision, side="left")
    stop = np.searchsorted(view.ts_max, until, side="left")
    side, at = _first_passage(view.t.price, start, stop, reference + distance, reference - distance)
    settled = np.where(side != 0, view.t.ts_event[np.maximum(at, 0)], until) if n else until
    target = side.astype(np.float64)
    state = np.full(n, KNOWN, np.int8)
    for i in np.flatnonzero(side == 0):  # neither barrier: the mid-price at the forced exit
        last = mid(view, int(until[i]) - 1)
        if np.isnan(last):
            target[i], state[i] = np.nan, UNKNOWN_BOOK
        else:
            target[i] = float(np.clip((last - reference[i]) / distance[i], -1.0, 1.0))
    cover = merged(coverage)
    k = np.searchsorted(cover[:, 0], decision, side="right") - 1
    ends = cover[np.maximum(k, 0), 1] if len(cover) else np.zeros(n, np.int64)
    lost = (k < 0) | (settled > ends) if len(cover) else np.ones(n, bool)
    target[lost], state[lost] = np.nan, UNKNOWN_COVERAGE
    return target, settled, state


def moves(
    view: ExecView,
    coverage: np.ndarray,
    decision: np.ndarray,
    until: np.ndarray,
    reference: np.ndarray,
    unit: np.ndarray,
    horizons_s: tuple[int, ...],
) -> np.ndarray:
    """The move of the mid-price over each horizon after each decision, in `unit` (a price
    distance, fixed-point): one column per horizon. NaN when the horizon passes `until`, the
    data coverage ends before it, or the book then is not usable. A diagnostic target."""
    cover = merged(coverage)
    k = np.searchsorted(cover[:, 0], decision, side="right") - 1
    ends = cover[np.maximum(k, 0), 1] if len(cover) else np.zeros(len(decision), np.int64)
    out = np.full((len(decision), len(horizons_s)), np.nan)
    for j, seconds in enumerate(horizons_s):
        then = decision + seconds * 1_000_000_000
        for i in np.flatnonzero((then < until) & (k >= 0) & (then < ends)):
            out[i, j] = (mid(view, int(then[i])) - reference[i]) / unit[i]
    return out
