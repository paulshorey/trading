"""Timeframes: a rolling window of 60 rows of one step, recomputed at every step.

A timeframe `W@S` (`1h@1m`, `10m@10s`) has step rows of `S` scheduled-open seconds, merged
exactly from the one-second rows: step row `k` holds seconds `S k - (S - 1) ... S k`. Its window
is the last 60 step rows, and its indicators run per phase `k % 60` on same-phase windows 60
rows apart. `S` divides a minute, so step rows nest in minutes and never straddle a session
boundary (calendar boundaries are whole minutes).

The stages of a timeframe are built from it (`stage_step_*.py`): one class per kind of stage,
one instance per timeframe. The one-second timeframe `1m@1s` is the base case: its rows come
from the trades, and its stages (`stage_bar_1s`, `stage_candle_1m_1s`, `stage_vol_1s`,
`stage_pivot_1s`) share the same calculation modules.

Stages pass their in-memory products to later stages of the same timeframe through
`Timeframe.frame`: `bars` (the step rows), `metrics`, `ordinal`, `observed_seconds`, and, from
the candle stage, `candles` and `window`.
"""

from dataclasses import dataclass
from typing import Any

from .market import MINUTE, SECOND
from .windows import WindowSpec

SLOTS = 60  # step rows per window, and same-phase windows per period


@dataclass(frozen=True)
class Timeframe:
    name: str  # "1h@1m"
    seconds: int  # scheduled-open seconds per step row
    rows: str  # its step rows in stage and table names: bar_<rows>, vol_<rows>, pivot_<rows>
    window: str  # its window in stage and table names: candle_<window>, stats_<window>
    stream: str  # the prefix of its swing scales: <stream>_atr_1

    def __post_init__(self):
        if self.seconds < 2 or (MINUTE // SECOND) % self.seconds:
            raise ValueError("A merged timeframe's step is 2 to 60 seconds and divides a minute")

    @property
    def step(self) -> int:
        """One step row, in nanoseconds."""
        return self.seconds * SECOND

    @property
    def window_seconds(self) -> int:
        """Scheduled-open seconds per window, and per same-phase indicator period."""
        return self.seconds * SLOTS

    @property
    def per_minute(self) -> int:
        """Step rows per minute."""
        return (MINUTE // SECOND) // self.seconds

    @property
    def spec(self) -> WindowSpec:
        return WindowSpec(self.name, self.step, SLOTS)

    def frame(self, products: dict[str, Any]) -> dict[str, Any]:
        """This timeframe's in-memory products for the chunk being processed."""
        return products.setdefault("frames", {}).setdefault(self.name, {})


SLOW = Timeframe("1h@1m", 60, "1m", "1h_1m", "slow")
MIDDLE = Timeframe("10m@10s", 10, "10s", "10m_10s", "mid")
# Which timeframes are registered and stored is `pipeline.MERGED`: this module is part of every
# step stage's builder identity, so the list is kept out of it.
