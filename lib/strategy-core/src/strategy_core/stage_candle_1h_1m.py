"""Stage `candle_1h_1m` (tier 1): the rolling `1h@1m` window of minute rows `m - 59 ... m` and
its normalized features, computed by the same code as `candle_1m_1s`: the engine's
(`features.WINDOW_FEATURES`) and `indicators.FEATURES`, per phase `m % 60`, so RSI(14) is a
14-hour RSI updated every minute (docs/sliding-windows/design.md#4-indicators-per-phase).

Minute rows (`stage_bar_1m`) carry their own first and last trade, sides, and price path, so
`MetricWindow(60)` bridges between minutes exactly as it does between seconds. `active_ratio` is
the share of the window's 3,600 seconds with trades. Left out, because at a minute's end they
repeat the second row at ordinal 60m: the session features and the latest observation with its
age (`DROPPED`).
"""

from typing import Any

import numpy as np

from . import warmup
from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .engine import MarketChunk
from .features import WINDOW_FEATURES, WindowFeatures
from .indicators import AS_OF_FEATURES, FEATURES, CandleIndicators
from .market import NS, PX
from .stage_bar_1m import empty_table
from .stages import Stage
from .window_metrics import MetricWindow
from .windows import BIAS, COMPLETE, WARMUP

PRICE = "Databento fixed-point price (1e-9)"
SESSION_FEATURES = (
    "session_elapsed_s",
    "session_ret_bps",
    "session_high_bps",
    "session_low_bps",
    "session_delta_ratio",
)
DROPPED = frozenset({*AS_OF_FEATURES, *SESSION_FEATURES})
WINDOW_SECONDS = BIAS.period // NS
ENGINE_FEATURES = tuple((name, unit.value, desc) for name, unit, desc in WINDOW_FEATURES)
COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter of the newest minute in the window"),
    Column("end_ns", BIGINT, "Window end, UTC ns"),
    Column("start_ns", BIGINT, "Start of the oldest minute; end - start > 60 min spans a closure"),
    Column("status", SMALLINT, "0 complete, 1 empty (no trades), 2 gap (missing data), 3 warmup"),
    Column("open", BIGINT, f"First trade price in the window, {PRICE}; NULL without trades"),
    Column("high", BIGINT, f"Highest trade price in the window, {PRICE}"),
    Column("low", BIGINT, f"Lowest trade price in the window, {PRICE}"),
    Column("close", BIGINT, f"Last trade price in the window, {PRICE}"),
    Column("high_at_ns", BIGINT, "Assignment time of the first trade at the high"),
    Column("low_at_ns", BIGINT, "Assignment time of the first trade at the low"),
    Column("vwap", DOUBLE, "Volume-weighted average trade price (quoted units)"),
    Column("volume", INTEGER, "Contracts traded in the window's minutes without missing data"),
    Column("buy_volume", INTEGER, "Buyer-aggressor volume"),
    Column("sell_volume", INTEGER, "Seller-aggressor volume"),
    Column("trades", INTEGER, "Trade records"),
    Column("observed", SMALLINT, "Seconds with trades in the window (of 3,600)"),
    Column("delta_high", INTEGER, "Highest running buy - sell volume from the window start"),
    Column("delta_low", INTEGER, "Lowest running buy - sell volume from the window start"),
    *(Column(n, DOUBLE, d, u) for n, u, d in ENGINE_FEATURES),
    *(Column(n, DOUBLE, d, u) for n, u, d in FEATURES if n not in DROPPED),
)
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
PRICED = ("open", "high", "low", "close", "high_at_ns", "low_at_ns")  # NULL without trades
NULLABLE = (*PRICED, "vwap", "start_ns", *FEATURE_COLUMNS)


class RollingSum:
    """Integer sums over each row's window of the last `slots` rows, carried between calls."""

    STATE = ("tail",)

    def __init__(self, slots: int):
        self.slots = slots
        self.tail = np.zeros(0, np.int64)

    def update(self, x: np.ndarray) -> np.ndarray:
        v = np.r_[self.tail, x.astype(np.int64)]
        c = np.r_[0, np.cumsum(v)]
        hi = np.arange(len(v) - len(x), len(v)) + 1
        out = c[hi] - c[np.maximum(hi - self.slots, 0)]
        self.tail = v[max(len(v) - (self.slots - 1), 0) :].copy()
        return out


def no_session(ends: np.ndarray) -> dict[str, np.ndarray]:
    """`CandleIndicators` inputs for the session features, which this stage does not store: an
    unknown session, so they are undefined."""
    m = len(ends)
    zero = np.zeros(m, np.int64)
    return {
        "complete": np.zeros(m, bool),
        "has_px": zero,
        "open_px": zero,
        "high_px": zero,
        "low_px": zero,
        "cvd": zero,
        "sided": zero,
        "interval_open": ends,
    }


class HourCandleStage(Stage):
    NAME = "candle_1h_1m"
    TIER = 1
    RESOLUTION = "1m"
    INPUTS = ("bar_1m",)
    MODULES = (
        "stages",
        "columns",
        "stage_candle_1h_1m",
        "stage_bar_1m",
        "bars",
        "market",
        "metrics",
        "windows",
        "window_metrics",
        "kernels",
        "indicators",
        "features",
        "warmup",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("bias", "window", "indicators", "observed")

    def __init__(self, context):
        super().__init__(context)
        cfg = context.features
        self.bias = WindowFeatures(BIAS, context.calendar, cfg)
        self.window = MetricWindow(BIAS.slots)
        self.indicators = CandleIndicators(BIAS.slots, cfg.rsi_period)
        self.observed = RollingSum(BIAS.slots)

    def settings(self) -> dict[str, Any]:
        cfg = self.context.features
        return {
            "window": BIAS.name,
            "rsi_period": cfg.rsi_period,
            "atr_period": cfg.atr_period,
            "volume_period": cfg.volume_period,
        }

    def warmup(self) -> int:
        """The same indicator chains as `candle_1m_1s`, in hourly periods: 60 open minutes."""
        cfg = self.context.features
        atr = warmup.wilder(cfg.atr_period)
        periods = max(
            warmup.wilder(cfg.rsi_period, extra=1),  # RSI
            atr + 1,  # ATR change, `ret_atr`
            warmup.ema(cfg.volume_period) + 1,  # volume baseline of earlier periods
            self.indicators.warmup(atr),
        )
        return periods * WINDOW_SECONDS

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        minutes, metrics = products["minutes"], products["minute_metrics"]
        if not len(minutes):  # most one-second chunks finish no minute; nothing changes
            return empty_table(COLUMNS, NULLABLE)
        candles, engine, atr = self.bias.update(minutes)
        win = self.window.update(minutes, metrics)
        observed = self.observed.update(products["observed_seconds"])
        features = self.indicators.update(candles, win, atr, no_session(minutes.end))
        complete = candles.status == COMPLETE
        features["active_ratio"] = np.where(complete, observed / WINDOW_SECONDS, np.nan)
        products.update(hour_candles=candles, hour_window=win)
        return self.table(candles, engine, features, win, observed)

    @staticmethod
    def table(c, engine, features, win, observed) -> Table:
        has_price = np.isfinite(c.close)

        def fixed(x):
            return np.where(has_price, np.rint(np.where(has_price, x, 0) * PX), 0).astype(np.int64)

        v = {
            "slot_ordinal": c.ordinal,
            "end_ns": c.end,
            "start_ns": c.start,
            "status": c.status.astype(np.int16),
            "open": fixed(c.open),
            "high": fixed(c.high),
            "low": fixed(c.low),
            "close": fixed(c.close),
            "high_at_ns": c.high_at,
            "low_at_ns": c.low_at,
            "vwap": c.vwap,
            "volume": c.volume.astype(np.int64),
            "buy_volume": c.buy.astype(np.int64),
            "sell_volume": c.sell.astype(np.int64),
            "trades": c.trades.astype(np.int64),
            "observed": observed,
            "delta_high": win["delta_high"].astype(np.int64),
            "delta_low": win["delta_low"].astype(np.int64),
        }
        v |= {k.split(".", 1)[1]: a for k, a in engine.items()}
        v |= {k: a for k, a in features.items() if k not in DROPPED}
        nulls = {k: ~has_price for k in PRICED}
        nulls |= {"vwap": ~np.isfinite(c.vwap), "start_ns": c.status == WARMUP}
        nulls |= {k: ~np.isfinite(v[k]) for k in FEATURE_COLUMNS}
        return Table(v, {k: nulls[k] for k in NULLABLE})
