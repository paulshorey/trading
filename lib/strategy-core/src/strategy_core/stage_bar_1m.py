"""Stage `bar_1m` (tier 0): each scheduled-open minute's own exact statistics, merged from its 60
second rows (`bar_1s`).

One row per scheduled-open minute, keyed by its index counter `slot_ordinal` = m, which holds
the seconds with ordinals 60m - 59 ... 60m: calendar boundaries are whole minutes, so a minute's
ordinal is its last second's ordinal / 60 (asserted for every minute). OHLCV, VWAP numerator,
and the running-delta extremes come from `bars.combine`, floats added oldest first; the metric
fields of `metrics.FIELDS` merge by `combine_metrics`, which applies `MetricWindow`'s rules
within each minute. A minute therefore equals the rolling `1m@1s` window that ends with it.

A minute with any missing second is missing: its row stores only its keys and status, and it
contributes nothing to later windows (its in-memory values are zero, as a stored NULL reads).

Beyond the second fields, a minute stores what its OHLC cannot rebuild: `observed_seconds`
(seconds with trades, for the hourly `active_ratio`), `session_cvd` at its last second, and the
one-second returns behind realized volatility: `ret2_sum`, the sum of squared log returns
between consecutive observed second closes inside the minute, their count `ret_count`, and
`first_close`, the first observed second's close (`close` is the last one), so a window can add
the return that bridges two minutes.

Live sessions feed one second at a time, so an unfinished minute's seconds wait in the
checkpoint state (`pending*`) until its last second arrives.
"""

from typing import Any

import numpy as np
from numba import njit

from .bars import MISSING, OBSERVED, BaseBars, combine, segment_sum
from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .engine import MarketChunk
from .market import MINUTE, SECOND
from .metrics import DRAWDOWN, DRAWUP, FIELDS, FIRST, MAX, MIN, ORDER, SUM
from .stage_bar_1s import FIELD_OF_COLUMN, OBSERVED_ONLY, RENAME, _metric_columns
from .stages import Stage

BIG = np.iinfo(np.int64).max
SECONDS = MINUTE // SECOND
PRICE = "Databento fixed-point price (1e-9)"


@njit(cache=True)
def group_path(obs, high, low, own_down, own_up, own_order, starts, stops, down, up, order):
    """Per group of consecutive rows, `MetricWindow._path`'s rules over its observed rows: the
    largest drop and rise (each row's own, or an earlier row's high to a later row's low) and
    which extreme came first (1 low, -1 high; the row's own order when both are in one row)."""
    for k in range(starts.shape[0]):
        seen = False
        top = bottom = 0
        hi_i = lo_i = -1
        d = u = 0
        for j in range(starts[k], stops[k]):
            if not obs[j]:
                continue
            if seen:
                if top - low[j] > d:
                    d = top - low[j]
                if high[j] - bottom > u:
                    u = high[j] - bottom
            if own_down[j] > d:
                d = own_down[j]
            if own_up[j] > u:
                u = own_up[j]
            if not seen or high[j] > top:  # strictly higher: the first row at the high
                top, hi_i = high[j], j
            if not seen or low[j] < bottom:
                bottom, lo_i = low[j], j
            seen = True
        down[k], up[k] = d, u
        if not seen:
            order[k] = 0
        elif lo_i < hi_i:
            order[k] = 1
        elif hi_i < lo_i:
            order[k] = -1
        else:
            order[k] = own_order[hi_i]


def previous_observed(
    status: np.ndarray, starts: np.ndarray, count: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """For each row: whether it is observed with an earlier observed row in its own group, and
    that earlier row's index (0 where there is none)."""
    n = len(status)
    obs = status == OBSERVED
    last = np.maximum.accumulate(np.where(obs, np.arange(n), -1))
    prev = np.r_[-1, last[:-1]] if n else last
    has = obs & (prev >= np.repeat(starts, count))
    return has, np.maximum(prev, 0)


def combine_metrics(
    bars: BaseBars, metrics: dict[str, np.ndarray], starts: np.ndarray
) -> dict[str, np.ndarray]:
    """Metric fields (`metrics.FIELDS`) of disjoint groups of consecutive rows, each starting at
    a row of `starts`, by the rules `MetricWindow` applies to a rolling window: sums (floats
    added oldest first), extremes and first or last values of the rows where they are valid,
    the price-path and side bridges between a group's observed rows (not the bridge into its
    first one), and the drawdown, drawup, and extreme order along its path. A group therefore
    equals a rolling window over the same rows, field by field."""
    n = len(bars)
    if not len(starts):
        return {f.name: np.zeros(0, f.dtype) for f in FIELDS}
    stops = np.r_[starts[1:], n]
    count = stops - starts
    index = np.arange(n)
    has, prev = previous_observed(bars.status, starts, count)
    gap = bars.open - bars.close[prev]
    last_side, first_side = metrics["last_side"][prev], metrics["first_side"]
    pair = has & (last_side != 0) & (first_side != 0)
    bridges = {
        "path_abs": np.where(has, np.abs(gap), 0),
        "upticks": (has & (gap > 0)).astype(np.int64),
        "downticks": (has & (gap < 0)).astype(np.int64),
        "side_pairs": pair.astype(np.int64),
        "side_switches": (pair & (last_side != first_side)).astype(np.int64),
    }
    path = {kind: np.zeros(len(starts), np.int64) for kind in (DRAWDOWN, DRAWUP, ORDER)}
    group_path(
        bars.status == OBSERVED, bars.high, bars.low, metrics["drawdown"], metrics["drawup"],
        metrics["extreme_order"], starts, stops, path[DRAWDOWN], path[DRAWUP], path[ORDER],
    )  # fmt: skip
    counts = {"trades": bars.trades} | metrics  # what `Field.valid` names
    out: dict[str, np.ndarray] = {}
    for f in FIELDS:
        v = metrics[f.name]
        if f.kind in path:
            out[f.name] = path[f.kind]
        elif f.kind == SUM:
            if v.dtype.kind == "f":
                total = segment_sum(v, starts, count)  # oldest first, as windows add
            else:
                total = np.add.reduceat(v, starts)
            if f.name in bridges:
                total = total + np.add.reduceat(bridges[f.name], starts)
            out[f.name] = total
        elif f.kind in (MAX, MIN):
            valid = counts[f.valid] > 0
            fill = -BIG if f.kind == MAX else BIG
            reduce = np.maximum if f.kind == MAX else np.minimum
            res = reduce.reduceat(np.where(valid, v, fill), starts)
            out[f.name] = np.where(res == fill, 0, res)
        else:
            valid = counts[f.valid] > 0
            if f.kind == FIRST:
                i = np.minimum.reduceat(np.where(valid, index, BIG), starts)
                ok = i < BIG
            else:
                i = np.maximum.reduceat(np.where(valid, index, -1), starts)
                ok = i >= 0
            out[f.name] = np.where(ok, v[np.clip(i, 0, n - 1)], 0).astype(f.dtype)
    return out


def empty_table(columns: tuple[Column, ...], nullable) -> Table:
    """A table without rows, for chunks that finish none, with the NULL masks of `nullable`."""
    dtypes = {DOUBLE: np.float64, SMALLINT: np.int16}
    values = {c.name: np.zeros(0, dtypes.get(c.sql, np.int64)) for c in columns}
    return Table(values, {name: np.zeros(0, bool) for name in nullable})


COLUMNS: tuple[Column, ...] = (
    Column(
        "slot_ordinal",
        BIGINT,
        "Index counter: +1 per scheduled-open minute; minute m holds seconds 60m - 59 ... 60m",
    ),
    Column("end_ns", BIGINT, "Minute end, UTC ns; the minute is [end - 60 s, end)"),
    Column("status", SMALLINT, "0 missing (a second without data coverage), 1 no trades, 2 trades"),
    Column("open", BIGINT, f"First trade price, {PRICE}; NULL without trades"),
    Column("high", BIGINT, f"Highest trade price, {PRICE}"),
    Column("low", BIGINT, f"Lowest trade price, {PRICE}"),
    Column("close", BIGINT, f"Last trade price, {PRICE}"),
    Column("high_at_ns", BIGINT, "Assignment time of the first trade at the high"),
    Column("low_at_ns", BIGINT, "Assignment time of the first trade at the low"),
    Column("pv", DOUBLE, "Sum of quoted price x size, the VWAP numerator (seconds added in order)"),
    Column("volume", INTEGER, "Contracts traded; NULL when missing"),
    Column("buy_volume", INTEGER, "Buyer-aggressor volume"),
    Column("sell_volume", INTEGER, "Seller-aggressor volume (unknown side = rest)"),
    Column("trades", INTEGER, "Trade records"),
    Column("delta_high", INTEGER, "Highest running buy - sell volume from the minute start (>= 0)"),
    Column("delta_low", INTEGER, "Lowest running buy - sell volume from the minute start (<= 0)"),
    Column(
        "session_cvd",
        BIGINT,
        "Buy - sell volume from the session open through the minute's last second; NULL after "
        "missing data",
    ),
    Column("observed_seconds", SMALLINT, "Seconds with trades"),
    Column(
        "first_close",
        BIGINT,
        f"Close of the first second with trades, {PRICE}; with the previous minute's close it "
        "bridges one-second returns across minutes",
    ),
    Column(
        "ret2_sum",
        DOUBLE,
        "Sum of squared log returns between consecutive observed second closes in the minute",
    ),
    Column("ret_count", SMALLINT, "Returns in ret2_sum (consecutive observed seconds)"),
    *_metric_columns(),
)
OBSERVED_COLUMNS = OBSERVED_ONLY | {"first_close"}
ALWAYS = frozenset({"slot_ordinal", "end_ns", "status"})  # never NULL
NULLABLE = tuple(c.name for c in COLUMNS if c.name not in ALWAYS)


class MinuteBarStage(Stage):
    NAME = "bar_1m"
    TIER = 0
    RESOLUTION = "1m"
    INPUTS = ("bar_1s",)
    MODULES = (
        "stages",
        "columns",
        "stage_bar_1m",
        "stage_bar_1s",
        "bars",
        "market",
        "metrics",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("pending", "pending_metrics", "pending_seconds")

    def __init__(self, context):
        super().__init__(context)
        self.pending = BaseBars.empty(SECOND)  # seconds of the unfinished minute
        self.pending_metrics = {f.name: np.zeros(0, f.dtype) for f in FIELDS}
        self.pending_seconds = {
            "ordinal": np.zeros(0, np.int64),
            "cvd": np.zeros(0, np.int64),
            "cvd_ok": np.zeros(0, bool),
        }

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        new, session = products["bars"], products["session"]
        bars = BaseBars.concat(SECOND, [self.pending, new])
        metrics = {k: np.r_[self.pending_metrics[k], v] for k, v in products["metrics"].items()}
        seconds = {
            "ordinal": np.r_[self.pending_seconds["ordinal"], products["ordinal"]],
            "cvd": np.r_[self.pending_seconds["cvd"], session["cvd"]],
            "cvd_ok": np.r_[self.pending_seconds["cvd_ok"], session["complete"]],
        }
        group_end = -(-bars.end // MINUTE) * MINUTE
        last = np.flatnonzero(bars.end == group_end)  # a minute is finished by its last second
        cut = int(last[-1]) + 1 if len(last) else 0
        if not cut:  # most one-second chunks finish no minute
            self.pending, self.pending_metrics, self.pending_seconds = bars, metrics, seconds
            empty = self.minutes(bars.take(slice(0, 0)), {}, {}, group_end[:0])
            products.update(
                minutes=empty["bars"],
                minute_metrics=empty["metrics"],
                minute_ordinal=empty["ordinal"],
                observed_seconds=empty["observed_seconds"],
            )
            return empty_table(COLUMNS, NULLABLE)
        self.pending = bars.take(slice(cut, None))
        self.pending_metrics = {k: v[cut:].copy() for k, v in metrics.items()}
        self.pending_seconds = {k: v[cut:].copy() for k, v in seconds.items()}
        done = bars.take(slice(0, cut))
        rows = self.minutes(
            done,
            {k: v[:cut] for k, v in metrics.items()},
            {k: v[:cut] for k, v in seconds.items()},
            group_end[:cut],
        )
        products.update(
            minutes=rows["bars"],
            minute_metrics=rows["metrics"],
            minute_ordinal=rows["ordinal"],
            observed_seconds=rows["observed_seconds"],
        )
        return self.table(rows)

    def minutes(
        self,
        b: BaseBars,
        metrics: dict[str, np.ndarray],
        seconds: dict[str, np.ndarray],
        keys: np.ndarray,
    ) -> dict[str, Any]:
        """Finished minutes from their seconds (`keys`: each second's minute end)."""
        if not len(b):
            empty = np.zeros(0, np.int64)
            return {
                "bars": BaseBars.empty(MINUTE),
                "metrics": combine_metrics(b, metrics, empty),
                "ordinal": empty,
                "observed_seconds": empty,
                "first_close": empty,
                "ret2_sum": np.zeros(0),
                "ret_count": empty,
                "cvd": empty,
                "cvd_ok": np.zeros(0, bool),
            }
        minutes = combine(b, keys, MINUTE)  # missing unless all 60 seconds are covered
        starts = np.flatnonzero(np.r_[True, keys[1:] != keys[:-1]])
        count = np.r_[starts[1:], len(b)] - starts
        ordinal = self.context.calendar.slot_ordinals(minutes.end, MINUTE)
        if not np.array_equal(-(-seconds["ordinal"] // SECONDS), np.repeat(ordinal, count)):
            raise AssertionError("Minute ordinals must equal second ordinals / 60")
        values = combine_metrics(b, metrics, starts)
        obs = b.status == OBSERVED
        has, prev = previous_observed(b.status, starts, count)
        ok = has & (b.close > 0) & (b.close[prev] > 0)  # log returns need positive prices
        ret = np.zeros(len(b))
        ret[ok] = np.log(b.close[ok] / b.close[prev[ok]])
        first = np.minimum.reduceat(np.where(obs, np.arange(len(b)), BIG), starts)
        rows = {
            "bars": minutes,
            "metrics": values,
            "ordinal": ordinal,
            "observed_seconds": np.add.reduceat(obs.astype(np.int64), starts),
            "first_close": np.where(first < BIG, b.close[np.minimum(first, len(b) - 1)], 0),
            "ret2_sum": segment_sum(ret * ret, starts, count),
            "ret_count": np.add.reduceat(ok.astype(np.int64), starts),
            "cvd": seconds["cvd"][starts + count - 1],  # at each minute's last second
            "cvd_ok": seconds["cvd_ok"][starts + count - 1],
        }
        missing = minutes.status == MISSING
        if missing.any():  # unknown: nothing of a missing minute reaches a window
            for name in BaseBars.ARRAYS[2:]:
                getattr(minutes, name)[missing] = 0
            for v in values.values():
                v[missing] = 0
            for name in ("observed_seconds", "first_close", "ret2_sum", "ret_count", "cvd"):
                rows[name][missing] = 0
        return rows

    @staticmethod
    def table(rows: dict[str, Any]) -> Table:
        bars, metrics = rows["bars"], rows["metrics"]
        missing = bars.status == MISSING
        observed = bars.status == OBSERVED
        v = {
            "slot_ordinal": rows["ordinal"],
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
            "session_cvd": rows["cvd"],
            "observed_seconds": rows["observed_seconds"],
            "first_close": rows["first_close"],
            "ret2_sum": rows["ret2_sum"],
            "ret_count": rows["ret_count"],
        }
        v |= {RENAME.get(k, k): a for k, a in metrics.items()}
        nulls = {}
        for name in NULLABLE:
            if name == "session_cvd":
                nulls[name] = missing | ~rows["cvd_ok"]
            elif name in OBSERVED_COLUMNS:
                nulls[name] = ~observed
            elif (field := FIELD_OF_COLUMN.get(name)) is not None and field.valid:
                count = metrics.get(field.valid, getattr(bars, field.valid, None))
                nulls[name] = missing | (count == 0)
            else:
                nulls[name] = missing
        return Table(v, nulls)

    def warmup(self) -> int:
        return 0
