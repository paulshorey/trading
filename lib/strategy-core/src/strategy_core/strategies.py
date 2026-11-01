"""Strategies turn normalized feature rows into entry signals.

`signals` must be row-wise: each output may depend only on that row's features,
which already summarize history causally. Do not shift, roll, or normalize across
rows. The engine verifies this by comparing whole-session and second-by-second runs.
"""

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class Bracket:
    """Exit plan fixed at entry, sized by the 1m@1s ATR at the signal."""

    target_atr: float = 1.5
    stop_atr: float = 1.0
    max_hold_s: int = 180

    def __post_init__(self):
        if not (0 < self.target_atr <= 50 and 0 < self.stop_atr <= 50):
            raise ValueError("Bracket ATR multiples must be in (0, 50]")
        if type(self.max_hold_s) is not int or not 1 <= self.max_hold_s <= 6 * 3600:
            raise ValueError("max_hold_s must be an integer from 1 to 21600")


class Strategy(Protocol):
    name: str
    bracket: Bracket

    def required(self) -> tuple[str, ...]: ...

    def signals(self, features: Mapping[str, np.ndarray]) -> np.ndarray:
        """Per row: +1 enter long, -1 enter short, 0 nothing (int8)."""
        ...

    def params(self) -> dict: ...


@dataclass(frozen=True)
class BiasPullback:
    """Infrastructure baseline, not a claim of edge.

    Bias (1h@1m) disqualifies a direction: longs need the last hour up by at least
    `bias_ret_atr` hourly ATRs with RSI above `bias_rsi`; shorts mirror it. Timing (1m@1s)
    enters in an allowed direction after a pullback (fast RSI at or beyond `trigger_rsi`)
    while aggressive volume leans the bias way (delta ratio beyond `trigger_delta`).
    `use_bias=False` drops the filter, as an experiment control."""

    bias_ret_atr: float = 0.5
    bias_rsi: float = 50.0
    trigger_rsi: float = 35.0
    trigger_delta: float = 0.1
    max_bias_age_s: float = 60.0
    use_bias: bool = True
    allow_short: bool = True
    bracket: Bracket = field(default_factory=Bracket)
    name: str = "bias_pullback"

    def __post_init__(self):
        if not 0 <= self.trigger_rsi <= 50 or not 0 <= self.bias_rsi <= 100:
            raise ValueError("trigger_rsi must be in [0, 50] and bias_rsi in [0, 100]")
        if not -1 <= self.trigger_delta <= 1:
            raise ValueError("trigger_delta must be in [-1, 1]")

    def required(self) -> tuple[str, ...]:
        fast = ("1m@1s.rsi", "1m@1s.delta_ratio", "1m@1s.atr_bps")
        return (*fast, "1h@1m.ret_atr", "1h@1m.rsi", "1h@1m.age_s") if self.use_bias else fast

    def signals(self, f: Mapping[str, np.ndarray]) -> np.ndarray:
        fast_rsi, delta = f["1m@1s.rsi"], f["1m@1s.delta_ratio"]
        n = len(fast_rsi)
        if self.use_bias:
            fresh = f["1h@1m.age_s"] <= self.max_bias_age_s
            ret, rsi = f["1h@1m.ret_atr"], f["1h@1m.rsi"]
            long_ok = fresh & (ret >= self.bias_ret_atr) & (rsi > self.bias_rsi)
            short_ok = fresh & (ret <= -self.bias_ret_atr) & (rsi < 100 - self.bias_rsi)
        else:
            long_ok = short_ok = np.ones(n, bool)
        long = long_ok & (fast_rsi <= self.trigger_rsi) & (delta >= self.trigger_delta)
        short = short_ok & (fast_rsi >= 100 - self.trigger_rsi) & (delta <= -self.trigger_delta)
        if not self.allow_short:
            short = np.zeros(n, bool)
        return np.where(long, 1, np.where(short, -1, 0)).astype(np.int8)

    def params(self) -> dict:
        return asdict(self)


STRATEGIES = {"bias_pullback": BiasPullback}


def make_strategy(name: str, params: dict | None = None) -> Strategy:
    if name not in STRATEGIES:
        raise ValueError(f"Unknown strategy {name!r}; known: {sorted(STRATEGIES)}")
    params = dict(params or {})
    if isinstance(params.get("bracket"), dict):
        params["bracket"] = Bracket(**params["bracket"])
    params.pop("name", None)
    return STRATEGIES[name](**params)
