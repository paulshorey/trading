"""Stages `pivot_rsi_<rows>` and `pivot_cvd_<rows>` (tier 2): the swings and structure of a
derived series on each timeframe, measured in the series' own ATR
(docs/project/series-structure-spec.md; roadmap decision 41).

A series has one value per step row, at the row's close: the RSI of the timeframe (below), or
the contract's running buy - sell volume through the row (`bar_<rows>.cvd`). Nothing here reads
a single trade. A row without a value ends the segment.

**RSI is the mean over the 60 phases.** `candle_<window>.rsi` is 60 separate histories, one per
phase, and each can rest at its own level, so read row by row it steps up and down as the rows
rotate through the phases, whether or not price moves: a zigzag on it confirms swings that no
phase made. The series is therefore the mean of the stored RSI over rows `o - 59 ... o`, which
holds every phase's latest value exactly once: it moves only when a phase's RSI changes. The
values are summed as whole millionths of a point, so the mean is exact in any chunking. It has
no value until 60 rows in a row have one.

**Its own ATR.** As price's is computed, with the series in place of price: the true range of
the window of 60 rows ending at a row is the highest minus the lowest value in the window,
widened to the value one window earlier (the same phase), and the ATR is the Wilder average of
those ranges per phase.

**The threshold** of a running extreme is `max(K x ATR, FLOOR x unit)`, frozen when it is set,
from the ATR and unit as of the previous row (a row's own window already holds its value). The
unit is the smallest step worth a swing: one RSI point, or one typical trade (the volume over
the trade count of the latest window that had trades). Values "in ATRs" divide by the ATR
floored at half the threshold's floor, so they stay bounded when the ATR has decayed.

Each scale (`<stream>_rsi_mean_atr_<k>`, `<stream>_cvd_atr_<k>`) is a stage of its own writing
to its timeframe's table for the series under its `variant_id`, with its events in
`market.pivot_event`. The detector and the structure are those of the price scales
(`swings.Detector` in additive mode, `stage_step_pivot.with_structure`).
"""

from typing import Any, ClassVar

import numpy as np

from . import kernels, swings, warmup
from .bars import MISSING
from .columns import DOUBLE, Column, Table
from .engine import MarketChunk
from .features import Unit
from .stage_step_pivot import MULTIPLIERS, RECLAIM_ROWS, STRUCTURE, with_structure
from .stages import Stage
from .timeframes import FAST, MIDDLE, SLOTS, SLOW, Timeframe

RSI, CVD = "rsi", "cvd"
# The series' name in a variant's name. A variant's name never changes meaning: the RSI scales
# first stored (`<stream>_rsi_atr_<k>`) read the stored RSI row by row, so these have another.
LABEL = {RSI: "rsi_mean", CVD: "cvd"}
# The smallest swing, in units of the series (spec): RSI points, or typical trades. Values in
# ATRs divide by the ATR floored at half of it.
FLOOR = {RSI: 0.25, CVD: 3.0}
# RSI is read in whole millionths of a point: two values that are equal but for floating-point
# noise must be equal, or the noise decides whether an extreme is refreshed; and whole numbers
# add up exactly, in any order.
RSI_UNITS = 1e6
NEVER = -(2**62)  # no step row seen yet
DROPPED = frozenset({"leg_delta_ratio", "reversal_delta_ratio"})  # a leg's flow: price only
LEG_VOLUMES = ("leg_volume", "leg_buy_volume", "leg_sell_volume")
LEVELS = (
    ("ext", swings.O_EXT, "The open leg's running extreme"),
    ("high_level", swings.O_SIDE + swings.S_LEVEL, "The latest confirmed high"),
    ("low_level", swings.O_SIDE + swings.NS_ + swings.S_LEVEL, "The latest confirmed low"),
)


def columns(source: str) -> tuple[tuple[Column, int], ...]:
    """A series scale's stored columns with their `out` index: those of a price scale that
    apply to it. Its levels are in the series' units: an RSI level is a feature (an index), a
    CVD level is a count of contracts and context only. The threshold is context."""
    unit = Unit.INDEX.value if source == RSI else ""
    note = "RSI points, 0..100" if source == RSI else "contracts; never a model input"
    out: list[tuple[Column, int]] = [
        (Column(name, DOUBLE, f"{text}, in {note}", unit), index) for name, index, text in LEVELS
    ]
    for column, index in swings.dense_columns():
        if column.name in DROPPED or column.name == "ext_px":
            continue
        if column.name == "theta_bps":
            column = Column(
                "theta",
                DOUBLE,
                "Reversal that confirms the running extreme, frozen when it was set, in the "
                "series' units: max(k x its ATR, the smallest swing); never a model input",
            )
        out.append((column, index))
    return tuple(out)


SPECS = {source: columns(source) for source in (RSI, CVD)}


class SeriesPivotStage(Stage):
    TF: ClassVar[Timeframe]
    SOURCE: ClassVar[str]  # "rsi" or "cvd"
    TABLE: ClassVar[str]
    VARIANT: ClassVar[str]
    K: ClassVar[float]
    WINDOW: ClassVar[int]  # reclaim window in step rows
    EVENTS: ClassVar[str] = "pivot_event"
    EVENT_COLUMNS = swings.EVENT_COLUMNS
    TIER = 2
    MODULES = (
        "stages",
        "columns",
        "stage_step_series",
        "stage_step_pivot",
        "swings",
        "kernels",
        "timeframes",
        "bars",
        "market",
        "warmup",
        "state",
    )
    STATE = ("detector", "atr", "tail", "ring", "carry", "unit", "last_row")

    def __init__(self, context):
        super().__init__(context)
        self.detector = swings.Detector(swings.ADDITIVE, self.WINDOW, self.TF.seconds)
        self.atr = kernels.PhaseState(SLOTS, prev="nan", atr="zero", count="count")
        self.tail = np.full(SLOTS - 1, np.nan)  # the series' last 59 values
        self.ring = np.full(SLOTS - 1, np.nan)  # RSI: the last 59 rows' stored values, millionths
        self.carry = np.full(2, np.nan)  # the latest row's theta and normalizing ATR
        self.unit = np.full(1, np.nan)  # the latest known typical trade (CVD)
        self.last_row = NEVER  # its index counter
        self.warm = False  # of the last chunk with rows; not state
        self.empty = None  # the tables of a chunk without rows, made once; not state

    def settings(self) -> dict[str, Any]:
        return {
            "variant": self.VARIANT,
            "stream": self.TF.stream,
            "source": self.SOURCE,
            "series": (
                "mean of candle rsi over rows o-59..o (each phase once), in whole millionths"
                if self.SOURCE == RSI
                else "bar cvd at the row's close"
            ),
            "multiplier": self.K,
            "atr": "its own: Wilder average of the window's true range of the series, per phase",
            "atr_period": self.context.features.atr_period,
            "floor": FLOOR[self.SOURCE],
            "floor_unit": "RSI points" if self.SOURCE == RSI else "typical trades",
            "reclaim_window_rows": self.WINDOW,
        }

    def warmup(self) -> int:
        """Its ATR's periods after the series exists, in scheduled-open seconds: RSI needs its
        own periods first. The structure itself has no finite warm-up (`warm`)."""
        cfg = self.context.features
        periods = warmup.wilder(cfg.atr_period) + 1
        if self.SOURCE == RSI:  # ... and one window of rows for the mean over the phases
            periods += warmup.wilder(cfg.rsi_period, 1) + 1
        return periods * self.TF.window_seconds

    def series(self, base: Table, candle: Table) -> tuple[np.ndarray, np.ndarray]:
        """The series' value at each step row (NaN where it has none), and its unit there: the
        size of the smallest step worth a swing (NaN while unknown)."""
        missing = base.values["status"] == MISSING
        if self.SOURCE == RSI:
            raw = np.where(missing, np.nan, np.round(swings.as_float(candle, "rsi") * RSI_UNITS))
            full = np.r_[self.ring, raw]
            view = np.lib.stride_tricks.sliding_window_view(full, SLOTS)
            whole = np.isfinite(view).all(axis=1)
            with np.errstate(invalid="ignore"):
                x = np.where(whole, view.sum(axis=1) / (SLOTS * RSI_UNITS), np.nan)
            self.ring = full[-(SLOTS - 1) :].copy()
            return x, np.ones(len(x))
        x = np.where(missing, np.nan, swings.as_float(base, "cvd"))
        volume, trades = candle.values["volume"], candle.values["trades"]
        with np.errstate(divide="ignore", invalid="ignore"):
            now = np.where(trades > 0, volume / trades, np.nan)  # the window's typical trade
        last = np.maximum.accumulate(np.where(np.isfinite(now), np.arange(len(now)), -1))
        unit = np.where(last >= 0, now[np.maximum(last, 0)], self.unit[0])
        if len(unit):
            self.unit[0] = unit[-1]
        return x, unit

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        tf, spec = self.TF, SPECS[self.SOURCE]
        tables = products["tables"]
        base, candle = tables[f"bar_{tf.rows}"], tables[f"candle_{tf.window}"]
        events = products.setdefault("events", {})
        ordinal, end = base.values["slot_ordinal"], base.values["end_ns"]
        m = len(ordinal)
        none = np.zeros(0, np.int64)
        if not m:  # most one-second chunks finish no step row of a merged timeframe
            if self.empty is None:
                self.empty = (
                    swings.event_table(
                        np.zeros((0, swings.NEI), np.int64), np.zeros((0, swings.NEF)), none,
                        self.context.close_delay,
                    ),
                    with_structure(swings.dense_table(spec, none, none, np.zeros((0, swings.NO)))),
                )  # fmt: skip
            events[self.NAME], table = self.empty
            return table
        if not np.array_equal(candle.values["end_ns"], end):
            raise AssertionError(f"{self.NAME} rows must align with its step rows and candle")
        x, unit = self.series(base, candle)
        # The window of 60 rows ending at each row: its extremes, complete only without a gap
        full = np.r_[self.tail, x]
        view = np.lib.stride_tricks.sliding_window_view(full, SLOTS)
        valid = np.isfinite(view).all(axis=1)
        with np.errstate(invalid="ignore"):
            high = np.where(valid, np.nanmax(np.where(np.isfinite(view), view, -np.inf), axis=1), 0)
            low = np.where(valid, np.nanmin(np.where(np.isfinite(view), view, np.inf), axis=1), 0)
        self.tail = full[-(SLOTS - 1) :].copy()
        atr = np.empty(m)
        s = self.atr
        kernels.wilder_atr(
            high, low, np.where(valid, x, 0.0), valid, ordinal % SLOTS,
            self.context.features.atr_period, s.prev, s.atr, s.count, atr,
        )  # fmt: skip
        floor = FLOOR[self.SOURCE] * unit
        with np.errstate(invalid="ignore"):
            theta = np.where(np.isfinite(floor), np.maximum(self.K * atr, floor), self.K * atr)
            norm = np.where(np.isfinite(floor), np.maximum(atr, floor / 2), atr)
        # A row's threshold inputs are those of the row before it
        known = np.r_[self.last_row, ordinal]
        prev_theta, prev_norm = np.r_[self.carry[0], theta][:-1], np.r_[self.carry[1], norm][:-1]
        follows = known[:-1] == ordinal - 1
        self.carry = np.array([theta[-1], norm[-1]])
        self.last_row = int(ordinal[-1])
        has = np.isfinite(x)
        rows = {
            "missing": ~has,
            "theta": np.where(follows, prev_theta, np.nan),
            "atr": np.where(follows, prev_norm, np.nan),
            "group": ordinal,
            "pub": ordinal,
            "emit": np.ones(m, bool),
        }
        at = np.flatnonzero(has)
        zero = np.zeros(len(at), np.int64)
        obs = {
            "value": x[at],
            "row": at.astype(np.int64),
            "at": end[at],
            "size": zero,
            "side": zero,
        }
        out, ev_i, ev_f = self.detector.advance(obs, rows)
        self.warm = swings.is_warm(out)
        table = swings.event_table(ev_i, ev_f, end[ev_i[:, swings.E_ROW]], self.context.close_delay)
        for name in LEG_VOLUMES:  # no trade is read: a leg's volume is unknown, never zero
            table.nulls[name] = np.ones(len(table), bool)
        events[self.NAME] = table
        return with_structure(swings.dense_table(spec, ordinal, end, out))


def scale(tf: Timeframe, source: str, k: float) -> type[SeriesPivotStage]:
    """One scale of a timeframe's series: `<stream>_<label>_atr_<k>`, a stage of its own."""
    table = f"pivot_{source}_{tf.rows}"
    name = f"{tf.stream}_{LABEL[source]}_atr_{k:g}".replace(".", "p")
    spec = SPECS[source]
    attrs = {
        "TF": tf,
        "SOURCE": source,
        "TABLE": table,
        "NAME": f"{table}:{name}",
        "VARIANT": name,
        "K": k,
        "WINDOW": RECLAIM_ROWS[tf.rows],
        "RESOLUTION": tf.rows,
        "INPUTS": (f"bar_{tf.rows}", f"candle_{tf.window}"),
        "COLUMNS": (*swings.KEY_COLUMNS, *(c for c, _ in spec), STRUCTURE),
    }
    return type(f"SeriesPivot_{name}", (SeriesPivotStage,), attrs)


SOURCES = (RSI, CVD)
BY_TIMEFRAME = {
    tf.name: tuple(scale(tf, source, k) for source in SOURCES for k in MULTIPLIERS)
    for tf in (FAST, MIDDLE, SLOW)
}
