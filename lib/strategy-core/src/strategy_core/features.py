"""Normalized features for entry timing (1m@1s) and direction bias (1h@1m).

Rule: features, strategy signals, and model inputs never use raw price units.
Express every value relative to price (bps), to volatility (ATR multiples), as a
bounded or dimensionless ratio, or as elapsed time. `Unit` has no price, tick,
dollar, or raw-volume member, and tests require every feature to be unchanged when
all prices (or all sizes) are multiplied by a constant. Raw prices exist only in data
handling and execution: order prices, fills, and P&L.
"""

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from . import kernels
from .bars import BaseBars, Rollup
from .market import MINUTE, NS, SECOND, SessionCalendar
from .windows import BIAS, COMPLETE, FAST, Candles, RollingWindow, WindowSpec


class Unit(StrEnum):
    BPS = "bps"  # change or distance relative to the current price
    ATR = "atr"  # price distance divided by the same window's ATR
    RATIO = "ratio"  # dimensionless, such as close location 0..1 or delta -1..1
    INDEX = "index_0_100"  # bounded oscillator such as RSI
    LOG_RATIO = "log_ratio"  # log of a quantity relative to its own trailing average
    SECONDS = "seconds"  # elapsed time
    FLAG = "flag"  # 0 or 1


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    unit: Unit
    description: str

    def __post_init__(self):
        if not isinstance(self.unit, Unit):
            raise TypeError(f"{self.name}: features must declare a normalized Unit")


WINDOW_FEATURES = (
    ("rsi", Unit.INDEX, "Wilder RSI of same-phase candle closes"),
    ("atr_bps", Unit.BPS, "Wilder ATR of same-phase candles, relative to the close"),
    ("ret_atr", Unit.ATR, "Close change since the same phase one period earlier, in ATRs"),
    ("close_loc", Unit.RATIO, "Close location in the candle range: 0 at the low, 1 at the high"),
    ("vwap_atr", Unit.ATR, "Close minus the candle VWAP, in ATRs"),
    ("delta_ratio", Unit.RATIO, "(buyer - seller aggressor volume) / sided volume, -1..1"),
    ("rel_volume", Unit.LOG_RATIO, "log(volume / same-phase EMA of earlier periods' volume)"),
    ("complete", Unit.FLAG, "1 when the candle has 60 covered slots and at least one trade"),
)


@dataclass(frozen=True)
class FeatureConfig:
    rsi_period: int = 14
    atr_period: int = 14
    volume_period: int = 20

    def __post_init__(self):
        for name in ("rsi_period", "atr_period", "volume_period"):
            value = getattr(self, name)
            if type(value) is not int or not 2 <= value <= 500:
                raise ValueError(f"{name} must be an integer between 2 and 500")


@dataclass(frozen=True)
class FeatureFrame:
    """Per-second rows. `features` are normalized model inputs; `context` holds the price-unit
    values execution needs (latest close and fast ATR) and must not feed signals or models."""

    end: np.ndarray
    features: dict[str, np.ndarray]
    context: dict[str, np.ndarray]

    def __len__(self) -> int:
        return len(self.end)

    def row(self, i: int) -> dict[str, float | None]:
        return {k: (None if np.isnan(v[i]) else float(v[i])) for k, v in self.features.items()}

    @classmethod
    def concat(cls, frames: list["FeatureFrame"]) -> "FeatureFrame":
        if not frames:
            raise ValueError("No frames")

        def join(attr):
            return {
                k: np.concatenate([getattr(f, attr)[k] for f in frames])
                for k in getattr(frames[0], attr)
            }

        return cls(np.concatenate([f.end for f in frames]), join("features"), join("context"))


class WindowFeatures:
    """Rolling candles of one window spec and their per-phase indicators."""

    def __init__(self, spec: WindowSpec, calendar: SessionCalendar, config: FeatureConfig):
        self.spec, self.config = spec, config
        self.window = RollingWindow(spec, calendar)
        p = spec.slots
        self.rsi = kernels.PhaseState(p, prev="nan", gain="zero", loss="zero", count="count")
        self.atr = kernels.PhaseState(p, prev="nan", atr="zero", count="count")
        self.chg = kernels.PhaseState(p, prev="nan")
        self.vol = kernels.PhaseState(p, ema="zero", count="count")

    def specs(self) -> list[FeatureSpec]:
        return [FeatureSpec(f"{self.spec.name}.{n}", u, d) for n, u, d in WINDOW_FEATURES]

    def update(self, bars: BaseBars) -> tuple[Candles, dict[str, np.ndarray], np.ndarray]:
        c = self.window.update(bars)
        m, cfg = len(c), self.config
        valid = c.status == COMPLETE
        rsi, atr, chg, vol_base = (np.empty(m) for _ in range(4))
        s = self.rsi
        kernels.wilder_rsi(
            c.close, valid, c.phase, cfg.rsi_period, s.prev, s.gain, s.loss, s.count, rsi
        )
        s = self.atr
        kernels.wilder_atr(
            c.high, c.low, c.close, valid, c.phase, cfg.atr_period, s.prev, s.atr, s.count, atr
        )
        kernels.phase_change(c.close, valid, c.phase, self.chg.prev, chg)
        s = self.vol
        kernels.ema_prior(c.volume, valid, c.phase, cfg.volume_period, s.ema, s.count, vol_base)
        with np.errstate(divide="ignore", invalid="ignore"):
            atr_ok = np.where(atr > 0, atr, np.nan)
            span = c.high - c.low
            sided = c.buy + c.sell
            values = {
                "rsi": rsi,
                "atr_bps": atr / c.close * 1e4,
                "ret_atr": chg / atr_ok,
                "close_loc": np.where(span > 0, (c.close - c.low) / span, 0.5),
                "vwap_atr": (c.close - c.vwap) / atr_ok,
                "delta_ratio": np.where(sided > 0, (c.buy - c.sell) / sided, np.nan),
                "rel_volume": np.log(c.volume / np.where(vol_base > 0, vol_base, np.nan)),
                "complete": valid.astype(float),
            }
        for name, v in values.items():
            if name != "complete":
                v[~valid] = np.nan
        return c, {f"{self.spec.name}.{k}": v for k, v in values.items()}, atr


class FeaturePipeline:
    """Feature rows at every scheduled-open second: 1m@1s features of the candle ending now and
    1h@1m bias features of the latest completed minute, with that minute's age."""

    def __init__(self, calendar: SessionCalendar, config: FeatureConfig | None = None):
        self.config = config or FeatureConfig()
        self.fast = WindowFeatures(FAST, calendar, self.config)
        self.bias = WindowFeatures(BIAS, calendar, self.config)
        self.minutes = Rollup(SECOND, MINUTE)
        self.last_bias: dict[str, np.ndarray] | None = None  # one-row arrays
        self.last_bias_end = np.empty(0, np.int64)

    def specs(self) -> list[FeatureSpec]:
        age = FeatureSpec("1h@1m.age_s", Unit.SECONDS, "Seconds since the bias candle completed")
        return [*self.fast.specs(), *self.bias.specs(), age]

    def update(self, seconds: BaseBars) -> FeatureFrame:
        fast_candles, features, fast_atr = self.fast.update(seconds)
        minutes = self.minutes.update(seconds)
        _, bias, _ = self.bias.update(minutes)
        minute_end = np.r_[self.last_bias_end, minutes.end]
        if self.last_bias is not None:
            bias = {k: np.r_[self.last_bias[k], v] for k, v in bias.items()}
        n = len(seconds)
        # As-of join: the latest minute completed at or before each second. The minute ending
        # at T completes with the second ending at T, so its age is then zero.
        i = np.searchsorted(minute_end, seconds.end, side="right") - 1
        known = i >= 0
        safe = np.maximum(i, 0)
        for name, values in bias.items():
            features[name] = (
                np.where(known, values[safe], np.nan) if len(values) else np.full(n, np.nan)
            )
        features["1h@1m.age_s"] = (
            np.where(known, (seconds.end - minute_end[safe]) / NS, np.nan)
            if len(minute_end)
            else np.full(n, np.nan)
        )
        if len(minute_end):
            self.last_bias = {k: v[-1:] for k, v in bias.items()}
            self.last_bias_end = minute_end[-1:]
        return FeatureFrame(seconds.end, features, {"close": fast_candles.close, "atr": fast_atr})
