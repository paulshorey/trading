"""Stored one-second rows for one contract, computed by the code live sessions run.

`SecondRowBuilder` turns `MarketChunk`s (a session at once, or one second at a time) into two
row sets, one row per scheduled-open second, each keyed by its index counter `slot_ordinal`:

- **base** (`market.bar_1s`): the second's own exact statistics: OHLC, volumes by aggressor
  side, the running-delta extremes, session CVD, and the TBBO metrics of `metrics.py`.
  Every field merges exactly into minutes and windows.
- **candle** (`market.candle_1m_1s`): the rolling `1m@1s` candle of rows `o - 59 ... o` and its
  normalized features: the engine's (`features.WINDOW_FEATURES`) and `indicators.FEATURES`.

Values are NULL where undefined, never zero: a missing second has unknown volume, a second
without trades has no price, and a statistic without a valid observation has no value.
The builder's state can be exported after any chunk (`state.export_state`) and restored, and
results never depend on how the data was chunked.
"""

from dataclasses import dataclass

import numpy as np

from .bars import MISSING, OBSERVED, AggregationReport, BaseBars, aggregate
from .engine import MarketChunk
from .features import WINDOW_FEATURES, FeatureConfig, WindowFeatures
from .indicators import FEATURES, CandleIndicators
from .market import PX, SECOND, SessionCalendar
from .metrics import FIELDS, second_metrics
from .state import export_state, import_state
from .window_metrics import MetricWindow
from .windows import FAST, WARMUP

ROWS_VERSION = 1  # bump with any change to stored values; the builder hash also covers the code
BIGINT, INTEGER, SMALLINT, DOUBLE = "bigint", "integer", "smallint", "double precision"


@dataclass(frozen=True)
class Column:
    name: str
    sql: str
    description: str
    unit: str = ""  # normalized unit of a feature column (features.Unit value)


WIDE = {
    "size_sq",
    "first_at",
    "last_at",
    "path_abs",
    "spread_sum",
    "spread_max",
    "mid2_open",
    "mid2_high",
    "mid2_low",
    "last_bid",
    "last_ask",
    "quote_at",
    "eff_spread_sum",
    "bid_depth_sum",
    "ask_depth_sum",
}
RENAME = {"first_at": "first_at_ns", "last_at": "last_at_ns", "quote_at": "quote_at_ns"}
FIELD_OF_COLUMN = {RENAME.get(f.name, f.name): f for f in FIELDS}
PRICE = "Databento fixed-point price (1e-9)"


def _metric_columns() -> list[Column]:
    out = []
    for f in FIELDS:
        sql = DOUBLE if f.dtype is np.float64 else BIGINT if f.name in WIDE else INTEGER
        when = f"; NULL when {f.valid} is 0" if f.valid else ""
        out.append(Column(RENAME.get(f.name, f.name), sql, f.description + when))
    return out


BASE_COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter: +1 per scheduled-open second"),
    Column("end_ns", BIGINT, "Slot end, UTC ns; the slot is [end - 1 s, end)"),
    Column("status", SMALLINT, "0 missing (no data coverage), 1 no trades, 2 trades observed"),
    Column("open", BIGINT, f"First trade price, {PRICE}; NULL without trades"),
    Column("high", BIGINT, f"Highest trade price, {PRICE}"),
    Column("low", BIGINT, f"Lowest trade price, {PRICE}"),
    Column("close", BIGINT, f"Last trade price, {PRICE}"),
    Column("high_at_ns", BIGINT, "Assignment time of the first trade at the high"),
    Column("low_at_ns", BIGINT, "Assignment time of the first trade at the low"),
    Column("pv", DOUBLE, "Sum of quoted price x size, the VWAP numerator"),
    Column("volume", INTEGER, "Contracts traded; NULL when missing"),
    Column("buy_volume", INTEGER, "Buyer-aggressor volume"),
    Column("sell_volume", INTEGER, "Seller-aggressor volume (unknown side = rest)"),
    Column("trades", INTEGER, "Trade records"),
    Column("delta_high", INTEGER, "Highest running buy - sell volume from the slot start (>= 0)"),
    Column("delta_low", INTEGER, "Lowest running buy - sell volume from the slot start (<= 0)"),
    Column(
        "session_cvd",
        BIGINT,
        "Buy - sell volume from the session open through this second; NULL after missing data",
    ),
    *_metric_columns(),
)
OBSERVED_ONLY = {"open", "high", "low", "close", "high_at_ns", "low_at_ns", "pv"} | {
    "max_size",
    "first_at_ns",
    "last_at_ns",
}

ENGINE_FEATURES = tuple((name, unit.value, desc) for name, unit, desc in WINDOW_FEATURES)
CANDLE_COLUMNS: tuple[Column, ...] = (
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
FEATURE_COLUMNS = tuple(c.name for c in CANDLE_COLUMNS if c.unit)


@dataclass(frozen=True)
class Table:
    """Column arrays for one table and, for nullable columns, a mask that is True for NULL."""

    values: dict[str, np.ndarray]
    nulls: dict[str, np.ndarray]

    def __len__(self) -> int:
        return len(self.values["end_ns"])


@dataclass(frozen=True)
class SecondRows:
    base: Table
    candle: Table
    report: AggregationReport

    def __len__(self) -> int:
        return len(self.base)


class SessionState:
    """Accumulators from each calendar session's open (the scheduled-open interval holding the
    slot): buy - sell and sided volume, and the first, highest, and lowest trade price.
    Missing data makes the rest of the session incomplete."""

    STATE = ("interval", "cvd", "sided", "incomplete", "open_px", "high_px", "low_px", "has_px")

    def __init__(self, calendar: SessionCalendar):
        self.calendar = calendar
        self.interval, self.cvd, self.sided, self.incomplete = -1, 0, 0, 0
        self.open_px, self.high_px, self.low_px, self.has_px = 0, 0, 0, 0

    def update(self, bars: BaseBars) -> dict[str, np.ndarray]:
        m = len(bars)
        cal = self.calendar
        iv = np.searchsorted(cal.opens, bars.end - bars.step, side="right") - 1
        out = {
            "cvd": np.zeros(m, np.int64),
            "sided": np.zeros(m, np.int64),
            "complete": np.zeros(m, bool),
            "open_px": np.zeros(m, np.int64),
            "high_px": np.zeros(m, np.int64),
            "low_px": np.zeros(m, np.int64),
            "has_px": np.zeros(m, np.int8),
            "interval_open": cal.opens[np.maximum(iv, 0)],
        }
        cuts = np.flatnonzero(np.r_[True, iv[1:] != iv[:-1]]) if m else np.zeros(0, np.int64)
        big = np.iinfo(np.int64).max
        for a, b in zip(cuts, np.r_[cuts[1:], m], strict=True):
            if iv[a] != self.interval:
                self.interval, self.cvd, self.sided, self.incomplete = int(iv[a]), 0, 0, 0
                self.open_px, self.high_px, self.low_px, self.has_px = 0, 0, 0, 0
            g = slice(a, b)
            obs = bars.status[g] == OBSERVED
            out["cvd"][g] = self.cvd + np.cumsum(bars.buy[g] - bars.sell[g])
            out["sided"][g] = self.sided + np.cumsum(bars.buy[g] + bars.sell[g])
            missing = np.cumsum(bars.status[g] == MISSING) > 0
            out["complete"][g] = ~(missing | bool(self.incomplete))
            hi = np.maximum.accumulate(np.where(obs, bars.high[g], -big))
            lo = np.minimum.accumulate(np.where(obs, bars.low[g], big))
            seen = np.cumsum(obs) > 0
            if self.has_px:
                hi, lo = np.maximum(hi, self.high_px), np.minimum(lo, self.low_px)
                first = self.open_px
            else:
                first = int(bars.open[g][np.argmax(obs)]) if obs.any() else 0
            has = seen | bool(self.has_px)
            out["high_px"][g] = np.where(has, hi, 0)
            out["low_px"][g] = np.where(has, lo, 0)
            out["open_px"][g] = np.where(has, first, 0)
            out["has_px"][g] = has
            self.cvd, self.sided = int(out["cvd"][b - 1]), int(out["sided"][b - 1])
            self.incomplete = int(not out["complete"][b - 1])
            if has[-1]:
                self.open_px, self.has_px = int(first), 1
                self.high_px, self.low_px = int(hi[-1]), int(lo[-1])
        return out


class SecondRowBuilder:
    STATE = ("fast", "window", "session", "indicators")

    def __init__(
        self,
        calendar: SessionCalendar,
        *,
        feed_latency: int,
        close_delay: int,
        config: FeatureConfig | None = None,
    ):
        self.calendar = calendar
        self.feed_latency, self.close_delay = feed_latency, close_delay
        self.config = config or FeatureConfig()
        self.fast = WindowFeatures(FAST, calendar, self.config)
        self.window = MetricWindow(FAST.slots)
        self.session = SessionState(calendar)
        self.indicators = CandleIndicators(FAST.slots, self.config.rsi_period)

    def export(self) -> dict[str, np.ndarray]:
        return export_state(self)

    def restore(self, state: dict[str, np.ndarray]) -> None:
        import_state(self, state)

    def process(self, chunk: MarketChunk) -> SecondRows:
        ends = self.calendar.slot_ends(chunk.start, chunk.end, SECOND)
        agg = aggregate(
            chunk.trades,
            ends,
            SECOND,
            chunk.coverage,
            feed_latency=self.feed_latency,
            close_delay=self.close_delay,
        )
        bars = agg.bars
        metrics = second_metrics(chunk.trades, agg)
        session = self.session.update(bars)
        candles, engine, atr = self.fast.update(bars)
        win = self.window.update(bars, metrics)
        features = self.indicators.update(candles, win, atr, session)
        ordinal = candles.ordinal
        return SecondRows(
            self._base(bars, metrics, session, ordinal),
            self._candle(candles, engine, features, win),
            agg.report,
        )

    @staticmethod
    def _base(bars, metrics, session, ordinal) -> Table:
        missing = bars.status == MISSING
        observed = bars.status == OBSERVED
        v = {
            "slot_ordinal": ordinal,
            "end_ns": bars.end,
            "status": bars.status.astype(np.int16),
            "open": bars.open,
            "high": bars.high,
            "low": bars.low,
            "close": bars.close,
            "high_at_ns": bars.high_at,
            "low_at_ns": bars.low_at,
            "pv": bars.pv,
            "volume": bars.volume,
            "buy_volume": bars.buy,
            "sell_volume": bars.sell,
            "trades": bars.trades,
            "delta_high": bars.delta_high,
            "delta_low": bars.delta_low,
            "session_cvd": session["cvd"],
        }
        v |= {RENAME.get(k, k): a for k, a in metrics.items()}
        nulls = {"session_cvd": missing | ~session["complete"]}
        for c in BASE_COLUMNS[3:]:
            if c.name in nulls:
                continue
            if c.name in OBSERVED_ONLY:
                nulls[c.name] = ~observed
                continue
            field = FIELD_OF_COLUMN.get(c.name)
            if field is not None and field.valid:
                count = metrics.get(field.valid, getattr(bars, field.valid, None))
                nulls[c.name] = missing | (count == 0)
            else:
                nulls[c.name] = missing
        return Table(v, nulls)

    @staticmethod
    def _candle(c, engine, features, win) -> Table:
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
