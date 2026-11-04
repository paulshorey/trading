"""Warm-up derived from indicator parameters
(docs/project/feature-pipeline.md#warm-up-is-derived-never-typed).

Counts are in an indicator's own updates (for per-phase window indicators, one update per
period of their phase). A fixed-window value is exact once its window is full. A recursive
average never fully forgets where it started; it counts as settled once its starting value's
weight falls below `TOLERANCE`: `seed + ln(TOLERANCE) / ln(1 - alpha)` updates. Composites add
along their chain, so a stage's warm-up is the largest chain among its outputs.
"""

import math

TOLERANCE = 1e-3


def recursive(alpha: float, seed: int, tolerance: float = TOLERANCE) -> int:
    """Updates until the starting value's weight in a recursive average is below `tolerance`."""
    return seed + math.ceil(math.log(tolerance) / math.log(1.0 - alpha))


def ema(n: int, tolerance: float = TOLERANCE) -> int:
    """EMA(n): seeded by its first value, alpha = 2 / (n + 1)."""
    return recursive(2.0 / (n + 1.0), 1, tolerance)


def wilder(n: int, extra: int = 0, tolerance: float = TOLERANCE) -> int:
    """Wilder(n), as in RSI and ATR: `n` values build the starting mean, then alpha = 1 / n.
    `extra` counts inputs consumed before the first value (RSI needs a previous close)."""
    return recursive(1.0 / n, n + extra, tolerance)


def window(n: int) -> int:
    """A fixed window of `n` values: exact once full."""
    return n


def sessions(updates: int, seconds_per_update: int, session_seconds: int) -> int:
    """Whole sessions that cover `updates` updates of `seconds_per_update` scheduled-open
    seconds each, for sessions of `session_seconds` open seconds."""
    if updates <= 0:
        return 0
    return math.ceil(updates * seconds_per_update / session_seconds)
