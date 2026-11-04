"""Stage `candle_1m_1s` (tier 1): the rolling `1m@1s` window of rows `o - 59 ... o` and its
normalized features: the engine's (`features.WINDOW_FEATURES`) and `indicators.FEATURES`.

Indicators run per phase (`o % 60`) on same-phase windows 60 rows apart
(docs/sliding-windows/design.md#4-indicators-per-phase).
"""

from typing import Any

import numpy as np

from . import warmup
from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .engine import MarketChunk
from .features import WINDOW_FEATURES, WindowFeatures
from .indicators import FEATURES, CandleIndicators
from .market import NS, PX
from .stages import Stage
from .window_metrics import MetricWindow
from .windows import FAST, WARMUP

PRICE = "Databento fixed-point price (1e-9)"
ENGINE_FEATURES = tuple((name, unit.value, desc) for name, unit, desc in WINDOW_FEATURES)
COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter of the newest second in the window"),
    Column("end_ns", BIGINT, "Window end, UTC ns"),
    Column("start_ns", BIGINT, "Start of the oldest second; end - start > 60 s spans a closure"),
    Column("status", SMALLINT, "0 complete, 1 empty (no trades), 2 gap (missing data), 3 warmup"),
    Column("open", BIGINT, f"First trade price in the window, {PRICE}; NULL without trades"),
    Column("high", BIGINT, f"Highest trade price in the window, {PRICE}"),
    Column("low", BIGINT, f"Lowest trade price in the window, {PRICE}"),
    Column("close", BIGINT, f"Last trade price in the window, {PRICE}"),
    Column("high_at_ns", BIGINT, "Assignment time of the first trade at the high"),
    Column("low_at_ns", BIGINT, "Assignment time of the first trade at the low"),
    Column("vwap", DOUBLE, "Volume-weighted average trade price (quoted units)"),
    Column("volume", INTEGER, "Contracts traded in the window's covered seconds"),
    Column("buy_volume", INTEGER, "Buyer-aggressor volume"),
    Column("sell_volume", INTEGER, "Seller-aggressor volume"),
    Column("trades", INTEGER, "Trade records"),
    Column("observed", SMALLINT, "Seconds with trades in the window"),
    Column("delta_high", INTEGER, "Highest running buy - sell volume from the window start"),
    Column("delta_low", INTEGER, "Lowest running buy - sell volume from the window start"),
    *(Column(n, DOUBLE, d, u) for n, u, d in ENGINE_FEATURES),
    *(Column(n, DOUBLE, d, u) for n, u, d in FEATURES),
)
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)


class CandleStage(Stage):
    NAME = "candle_1m_1s"
    TIER = 1
    RESOLUTION = "1s"
    INPUTS = ("bar_1s",)
    MODULES = (
        "stages",
        "columns",
        "stage_candle_1m_1s",
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
    STATE = ("fast", "window", "indicators")

    def __init__(self, context):
        super().__init__(context)
        cfg = context.features
        self.fast = WindowFeatures(FAST, context.calendar, cfg)
        self.window = MetricWindow(FAST.slots)
        self.indicators = CandleIndicators(FAST.slots, cfg.rsi_period)

    def settings(self) -> dict[str, Any]:
        cfg = self.context.features
        return {
            "window": FAST.name,
            "rsi_period": cfg.rsi_period,
            "atr_period": cfg.atr_period,
            "volume_period": cfg.volume_period,
        }

    def warmup(self) -> int:
        cfg = self.context.features
        atr = warmup.wilder(cfg.atr_period)
        periods = max(
            warmup.wilder(cfg.rsi_period, extra=1),  # RSI
            atr + 1,  # ATR change, `ret_atr`
            warmup.ema(cfg.volume_period) + 1,  # volume baseline of earlier periods
            self.indicators.warmup(atr),
        )
        return periods * FAST.period // NS  # one same-phase period: 60 open seconds

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        bars, metrics = products["bars"], products["metrics"]
        candles, engine, atr = self.fast.update(bars)
        win = self.window.update(bars, metrics)
        features = self.indicators.update(candles, win, atr, products["session"])
        products.update(candles=candles, window=win)
        return self.table(candles, engine, features, win)

    @staticmethod
    def table(c, engine, features, win) -> Table:
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
            "observed": win["observed"].astype(np.int64),
            "delta_high": win["delta_high"].astype(np.int64),
            "delta_low": win["delta_low"].astype(np.int64),
        }
        v |= {k.split(".", 1)[1]: a for k, a in engine.items()}
        v |= features
        nulls = {k: ~has_price for k in ("open", "high", "low", "close", "high_at_ns")}
        nulls |= {"low_at_ns": ~has_price, "vwap": ~np.isfinite(c.vwap)}
        nulls["start_ns"] = c.status == WARMUP
        nulls |= {k: ~np.isfinite(v[k]) for k in FEATURE_COLUMNS}
        return Table(v, nulls)
