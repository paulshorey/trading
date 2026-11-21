"""Timeframes: a rolling window of 60 rows of one step, recomputed at every step.

A timeframe `W@S` (`1m@1s`, `10m@10s`, `1h@1m`) has step rows of `S` scheduled-open seconds:
step row `k` holds seconds `S k - (S - 1) ... S k`. Its window is the last 60 step rows, and its
indicators run per phase `k % 60` on same-phase windows 60 rows apart. `S` divides a minute, so
step rows nest in minutes and never straddle a session boundary (calendar boundaries are whole
minutes).

Every timeframe is built by the same classes (`stage_step_*.py`): one class per kind of stage
(window, statistics, volatility, swings), one instance per timeframe. Only the step rows differ
by nature: those of one second are made from the trades (`stage_bar_1s`), and every longer
step's are merged exactly from them (`stage_step_bar`).

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
        if self.seconds < 1 or (MINUTE // SECOND) % self.seconds:
            raise ValueError("A timeframe's step is 1 to 60 seconds and divides a minute")

    @property
    def merged(self) -> bool:
        """Its step rows are merged from one-second rows (they are the one-second rows if not)."""
        return self.seconds > 1

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


FAST = Timeframe("1m@1s", 1, "1s", "1m_1s", "fast")
SLOW = Timeframe("1h@1m", 60, "1m", "1h_1m", "slow")
MIDDLE = Timeframe("10m@10s", 10, "10s", "10m_10s", "mid")
# Which timeframes are registered and stored is `pipeline.MERGED`: this module is part of every
# step stage's builder identity, so the list is kept out of it.
