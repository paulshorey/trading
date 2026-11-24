"""Strategies turn normalized feature rows into decisions.

A decision is made at every second: buy, sell, or nothing. The position is long, flat, or
short and moves one step per decision (docs/project/roadmap.md, decision 35). A strategy says
it in two parts, each row-wise, because what a row decides depends on the position held:

- `signals`: the decision while flat. +1 opens a long, -1 opens a short, 0 does nothing.
- `closes`: the decision while a position is open. For each row, whether a long is closed
  (a sell) and whether a short is closed (a buy). A closing decision exits at the market and
  cancels the position's bracket orders. A strategy that never closes leaves every position
  to its bracket.

Each output may depend only on that row's features, which already summarize history
causally. Do not shift, roll, or normalize across rows. The engine verifies this by comparing
whole-session and second-by-second runs.
"""

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Protocol

import numpy as np

TIMEFRAMES = ("1m@1s", "10m@10s", "1h@1m")  # whose ATR can size a bracket
CLOSES = ("hold", "opposite")


@dataclass(frozen=True)
class Bracket:
    """Protective orders fixed at entry: a target and a stop, each a multiple of the ATR of one
    timeframe at the decision, and how long the position may be held. Every position is also
    closed before its session's close. A closing decision acts whatever the bracket says."""

    target_atr: float = 1.5
    stop_atr: float = 1.0
    max_hold_s: int | None = 180  # None: no time limit inside the session
    atr: str = "1m@1s"  # the timeframe whose ATR sizes it
    # Move the stop to the entry price once a trade has printed this many ATRs in favour and the
    # amended order has reached the exchange. None: the stop never moves.
    breakeven_atr: float | None = None

    def __post_init__(self):
        if not (0 < self.target_atr <= 50 and 0 < self.stop_atr <= 50):
            raise ValueError("Bracket ATR multiples must be in (0, 50]")
        hold = self.max_hold_s
        if hold is not None and (type(hold) is not int or not 1 <= hold <= 24 * 3600):
            raise ValueError("max_hold_s must be an integer from 1 to 86400, or None")
        if self.atr not in TIMEFRAMES:
            raise ValueError(f"Bracket atr must be one of {TIMEFRAMES}")
        k = self.breakeven_atr
        if k is not None and not 0 < k <= 50:
            raise ValueError("breakeven_atr must be in (0, 50], or None")


@dataclass(frozen=True)
class Entry:
    """How a position is opened. `market`: at the book the order meets. `passive`: a limit
    order at the best bid (buy) or ask (sell) of the book it meets, cancelled after `wait_s`
    if nothing filled it; the next decision then decides again."""

    kind: str = "market"
    wait_s: float = 5.0
    cutoff_s: int = 0  # no position is opened within this long before the session's forced exit

    def __post_init__(self):
        if self.kind not in ("market", "passive"):
            raise ValueError('Entry kind must be "market" or "passive"')
        if type(self.wait_s) not in (int, float) or not 0 < self.wait_s <= 3600:
            raise ValueError("wait_s must be in (0, 3600]")
        if type(self.cutoff_s) is not int or not 0 <= self.cutoff_s <= 24 * 3600:
            raise ValueError("cutoff_s must be an integer from 0 to 86400")


def trend_gate(
    features: Mapping[str, np.ndarray], trends: tuple[str, ...], rows: int
) -> tuple[np.ndarray, np.ndarray]:
    """Per row: whether a long and whether a short may be opened, given the named trend features
    (+1 up, -1 down, 0 or NaN mixed or unknown). A long needs no trend down and a short none up
    (roadmap decision 38); a mixed or unknown trend forbids nothing."""
    long_ok, short_ok = np.ones(rows, bool), np.ones(rows, bool)
    for name in trends:
        with np.errstate(invalid="ignore"):
            long_ok &= ~(features[name] < 0)
            short_ok &= ~(features[name] > 0)
    return long_ok, short_ok


class Strategy(Protocol):
    name: str
    bracket: Bracket
    entry: Entry

    def required(self) -> tuple[str, ...]: ...

    def signals(self, features: Mapping[str, np.ndarray]) -> np.ndarray:
        """Per row, the decision while flat: +1 open a long, -1 open a short, 0 nothing (int8)."""
        ...

    def closes(self, features: Mapping[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        """Per row, the decision while a position is open: (close a long, close a short)."""
        ...

    def params(self) -> dict: ...


@dataclass(frozen=True)
class BiasPullback:
    """Infrastructure baseline, not a claim of edge.

    Bias (1h@1m) disqualifies a direction: longs need the last hour up by at least
    `bias_ret_atr` hourly ATRs with RSI above `bias_rsi`; shorts mirror it. Timing (1m@1s)
    enters in an allowed direction after a pullback (fast RSI at or beyond `trigger_rsi`)
    while aggressive volume leans the bias way (delta ratio beyond `trigger_delta`).
    `use_bias=False` drops the filter, as an experiment control.

    `close="opposite"` closes a position on the signal that would open the other side;
    `"hold"` leaves it to its bracket. `gate` names trend features that forbid opening
    against them (`trend_gate`)."""

    bias_ret_atr: float = 0.5
    bias_rsi: float = 50.0
    trigger_rsi: float = 35.0
    trigger_delta: float = 0.1
    max_bias_age_s: float = 60.0
    use_bias: bool = True
    allow_short: bool = True
    close: str = "hold"
    gate: tuple[str, ...] = ()
    bracket: Bracket = field(default_factory=Bracket)
    entry: Entry = field(default_factory=Entry)
    name: str = "bias_pullback"

    def __post_init__(self):
        if not 0 <= self.trigger_rsi <= 50 or not 0 <= self.bias_rsi <= 100:
            raise ValueError("trigger_rsi must be in [0, 50] and bias_rsi in [0, 100]")
        if not -1 <= self.trigger_delta <= 1:
            raise ValueError("trigger_delta must be in [-1, 1]")
        if self.close not in CLOSES:
            raise ValueError(f"close must be one of {CLOSES}")

    def required(self) -> tuple[str, ...]:
        fast = ("1m@1s.rsi", "1m@1s.delta_ratio", "1m@1s.atr_bps", *self.gate)
        return (*fast, "1h@1m.ret_atr", "1h@1m.rsi", "1h@1m.age_s") if self.use_bias else fast

    def signals(self, f: Mapping[str, np.ndarray]) -> np.ndarray:
        raw = self.raw(f)
        long_ok, short_ok = trend_gate(f, self.gate, len(raw))
        return np.where((raw > 0) & long_ok, 1, np.where((raw < 0) & short_ok, -1, 0)).astype(
            np.int8
        )

    def closes(self, f: Mapping[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        raw = self.raw(f)  # the gate forbids opening, never closing
        if self.close == "hold":
            return np.zeros(len(raw), bool), np.zeros(len(raw), bool)
        return raw < 0, raw > 0

    def raw(self, f: Mapping[str, np.ndarray]) -> np.ndarray:
        """The pullback signal before the gate: +1 buy, -1 sell, 0 nothing."""
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
    if isinstance(params.get("entry"), dict):
        params["entry"] = Entry(**params["entry"])
    if isinstance(params.get("gate"), list):
        params["gate"] = tuple(params["gate"])
    params.pop("name", None)
    return STRATEGIES[name](**params)
