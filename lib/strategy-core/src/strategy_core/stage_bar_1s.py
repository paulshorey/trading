"""Stage `bar_1s` (tier 0): each scheduled-open second's own exact statistics.

One row per scheduled-open second, keyed by its index counter `slot_ordinal`: OHLC, volumes by
aggressor side, the running-delta extremes, session CVD, and the TBBO metrics of `metrics.py`.
Every field merges exactly into minutes and windows. Values are NULL where undefined, never
zero: a missing second has unknown volume, a second without trades has no price, and a
statistic without a valid observation has no value.
"""

from typing import Any

import numpy as np

from .bars import MISSING, OBSERVED, BaseBars, aggregate
from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .engine import MarketChunk
from .market import SECOND, SessionCalendar
from .metrics import FIELDS, second_metrics
from .stages import Stage

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
    "depth_at",
    "eff_spread_sum",
    "bid_depth_sum",
    "ask_depth_sum",
    "order_bid_size_sum",
    "order_ask_size_sum",
    "drawdown",
    "drawup",
}
RENAME = {
    "first_at": "first_at_ns",
    "last_at": "last_at_ns",
    "quote_at": "quote_at_ns",
    "depth_at": "depth_at_ns",
}
FIELD_OF_COLUMN = {RENAME.get(f.name, f.name): f for f in FIELDS}
PRICE = "Databento fixed-point price (1e-9)"


def _metric_columns() -> list[Column]:
    out = []
    for f in FIELDS:
        sql = DOUBLE if f.dtype is np.float64 else BIGINT if f.name in WIDE else INTEGER
        when = f"; NULL when {f.valid} is 0" if f.valid else ""
        out.append(Column(RENAME.get(f.name, f.name), sql, f.description + when))
    return out


COLUMNS: tuple[Column, ...] = (
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
        if m == 0:  # a chunk inside a closure has no rows
            return out
        cuts = np.flatnonzero(np.r_[True, iv[1:] != iv[:-1]])
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


class BarStage(Stage):
    NAME = "bar_1s"
    TIER = 0
    RESOLUTION = "1s"
    INPUTS = ("market",)
    MODULES = ("stages", "columns", "stage_bar_1s", "bars", "market", "metrics", "state")
    COLUMNS = COLUMNS
    STATE = ("session",)

    def __init__(self, context):
        super().__init__(context)
        self.session = SessionState(context.calendar)

    def settings(self) -> dict[str, Any]:
        c = self.context
        return {"feed_latency_ns": c.feed_latency, "close_delay_ns": c.close_delay}

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        c = self.context
        ends = c.calendar.slot_ends(chunk.start, chunk.end, SECOND)
        agg = aggregate(
            chunk.trades,
            ends,
            SECOND,
            chunk.coverage,
            feed_latency=c.feed_latency,
            close_delay=c.close_delay,
        )
        bars = agg.bars
        metrics = second_metrics(chunk.trades, agg)
        session = self.session.update(bars)
        ordinal = c.calendar.slot_ordinals(bars.end, SECOND)
        products.update(
            report=agg.report, bars=bars, metrics=metrics, session=session, ordinal=ordinal
        )
        return self.table(bars, metrics, session, ordinal)

    @staticmethod
    def table(bars, metrics, session, ordinal) -> Table:
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
        for c in COLUMNS[3:]:
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
