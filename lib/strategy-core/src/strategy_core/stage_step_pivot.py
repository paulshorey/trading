"""Stages `pivot_<rows>` (tier 2): the swing scales of a merged timeframe (`timeframes.py`), one
row per scheduled-open step row and scale. `pivot_1m` holds the slow scales of `1h@1m`.

Each scale is its own stage (a variant: `slow_atr_0p5`, `slow_atr_1`, `slow_atr_2`) writing to
its timeframe's shared table under its `variant_id`, like the fast scales of `pivot_1s`.

Such a scale replays the same released trades as a fast one; only its threshold and its
publication differ. `theta = max(K x ATR, FLOOR x spread)` uses the timeframe's ATR(14)
(`candle_<window>.atr_bps`) and the last sampled book spread, both **as of the latest step row
completed before the trade's own row**, with that row's ATR in price units
(`vol_<rows>.atr_price`) as the frozen ATR. The spread is carried from the step rows
(`last_bid`, `last_ask`: the last trade in the row with a usable book), never across a missing
row, so the branch reads nothing from the second branch but `bar_1s`'s rows.

State is published once per step row, after its last second; a confirmation or breach inside a
row appears on that row and never earlier. Second rows read it through an as-of join
(`pipeline.StageFeatures`). A missing second ends the segment at once and keeps the scale idle
for the rest of its row; the next rows then wait for the ATR.
Ages count step rows x their seconds: scheduled-open seconds.
"""

from typing import Any, ClassVar

import numpy as np

from . import swings, warmup
from .bars import MISSING
from .columns import Table
from .engine import MarketChunk
from .market import PX
from .stages import Stage
from .timeframes import SLOW, Timeframe

SPEC = swings.dense_columns()
COLUMNS = (*swings.KEY_COLUMNS, *(c for c, _ in SPEC))
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
NEVER = -(2**62)  # no step row seen yet


def minute_spread(base: Table, carry: np.ndarray) -> np.ndarray:
    """The last sampled book spread as of each minute row, in bps of its midpoint: from the
    latest minute with a usable book, in this chunk or carried (`carry`: has, bid, ask; updated
    in place), and unknown from a missing minute until the next usable book."""
    status = base.values["status"]
    m = len(status)
    index = np.arange(m)
    valid = ~base.nulls["last_bid"] & ~base.nulls["last_ask"]
    gap = np.maximum.accumulate(np.where(status == MISSING, index, -1))
    i = np.maximum.accumulate(np.where(valid, index, -1))
    fresh = (i >= 0) & (i > gap)
    known = fresh | ((gap < 0) & bool(carry[0]))
    at = np.maximum(i, 0)
    bid = np.where(fresh, base.values["last_bid"][at], carry[1]).astype(np.float64)
    ask = np.where(fresh, base.values["last_ask"][at], carry[2]).astype(np.float64)
    if fresh[-1]:
        carry[:] = (1, base.values["last_bid"][i[-1]], base.values["last_ask"][i[-1]])
    elif gap[-1] >= 0:
        carry[0] = 0
    with np.errstate(divide="ignore", invalid="ignore"):
        spread = (ask - bid) / ((ask + bid) / 2) * 1e4
    return np.where(known & np.isfinite(spread), spread, np.nan)


class StepPivotStage(Stage):
    TF: ClassVar[Timeframe]  # set by `step_pivot`, with TABLE, RESOLUTION, and INPUTS
    TABLE: ClassVar[str]  # the table every scale of the timeframe writes to
    EVENTS: ClassVar[str] = "pivot_event"  # the table its events go to
    EVENT_COLUMNS = swings.EVENT_COLUMNS
    VARIANT: ClassVar[str]  # the scale's name in `market.variant`
    K: ClassVar[float]  # threshold, in ATRs
    FLOOR: ClassVar[float] = 2.0  # and at least this many spreads
    WINDOW: ClassVar[int] = 15  # step rows within which a breached level can be reclaimed
    TIER = 2
    MODULES = (
        "stages",
        "columns",
        "stage_step_pivot",
        "swings",
        "timeframes",
        "bars",
        "market",
        "windows",
        "warmup",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("detector", "carry", "book", "last_minute")

    def __init__(self, context):
        super().__init__(context)
        self.detector = swings.Detector(swings.PRICE, self.WINDOW, self.TF.seconds)
        self.carry = np.full(2, np.nan)  # the latest minute row's theta and ATR
        self.book = np.zeros(3, np.int64)  # the last usable book: has, bid, ask
        self.last_minute = NEVER  # its index counter
        self.warm = False  # of the last chunk with rows; not state

    def settings(self) -> dict[str, Any]:
        return {
            "variant": self.VARIANT,
            "stream": self.TF.stream,
            "source": "price",
            "multiplier": self.K,
            "normalizer": f"candle_{self.TF.window}.atr_bps",
            "atr_period": self.context.features.atr_period,
            "atr_snapshot": f"vol_{self.TF.rows}.atr_price",
            "spread": f"bar_{self.TF.rows}.last_bid, last_ask",
            "spread_floor": self.FLOOR,
            "reclaim_window_rows": self.WINDOW,
        }

    def warmup(self) -> int:
        """The threshold's hourly ATR(14), in scheduled-open seconds. The structure itself has no
        finite warm-up (`warm`)."""
        return warmup.wilder(self.context.features.atr_period) * self.TF.window_seconds

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        bars = products["bars"]
        n = len(bars)
        events = products.setdefault("events", {})
        none = np.zeros(0, np.int64)
        if not n:
            events[self.NAME] = swings.event_table(
                np.zeros((0, swings.NEI), np.int64), np.zeros((0, swings.NEF)), none,
                self.context.close_delay,
            )  # fmt: skip
            return swings.dense_table(SPEC, none, none, np.zeros((0, swings.NO)))
        tf = self.TF
        width, step = tf.seconds, tf.step
        tables = products["tables"]
        base, candle, vol = (
            tables[f"bar_{tf.rows}"], tables[f"candle_{tf.window}"], tables[f"vol_{tf.rows}"]
        )  # fmt: skip
        minute_end = base.values["end_ns"]
        if not (
            np.array_equal(candle.values["end_ns"], minute_end)
            and np.array_equal(vol.values["end_ns"], minute_end)
        ):
            raise AssertionError(f"{self.NAME} rows must align with its step rows, candle, and vol")
        second = products["ordinal"]
        minute = (second + (width - 1)) // width  # the step row each second belongs to
        emit = second % width == 0  # a step row is published after its last second
        done = base.values["slot_ordinal"]
        if not np.array_equal(minute[emit], done):
            raise AssertionError(f"{self.NAME} must publish exactly the step rows completed")
        # Threshold inputs of every minute row known so far: the carried one, then this chunk's
        known = np.r_[self.last_minute, done]
        theta, atr = self.carry[:1], self.carry[1:]
        if len(done):
            spread = minute_spread(base, self.book)
            now = np.maximum(self.K * swings.as_float(candle, "atr_bps"), self.FLOOR * spread)
            theta = np.r_[theta, now]
            atr = np.r_[atr, swings.as_float(vol, "atr_price") * PX]
            self.carry = np.array([theta[-1], atr[-1]])
            self.last_minute = int(done[-1])
        at = np.searchsorted(known, minute - 1)  # the minute completed just before its own
        found = known[np.minimum(at, len(known) - 1)] == minute - 1
        at = np.minimum(at, len(known) - 1)
        rows = {
            "missing": bars.status == MISSING,
            "theta": np.where(found, theta[at], np.nan),
            "atr": np.where(found, atr[at], np.nan),
            "group": minute,
            "pub": minute,
            "emit": emit,
        }
        obs = swings.released(chunk, self.context, products)
        out, ev_i, ev_f = self.detector.advance(obs, rows)
        if len(out):
            self.warm = swings.is_warm(out)
        ends = -(-bars.end[ev_i[:, swings.E_ROW]] // step) * step  # each event's step row end
        events[self.NAME] = swings.event_table(ev_i, ev_f, ends, self.context.close_delay)
        return swings.dense_table(SPEC, done, minute_end, out)


def step_pivot(tf: Timeframe) -> type[StepPivotStage]:
    """The base class of timeframe `tf`'s swing scales."""
    attrs = {
        "TF": tf,
        "TABLE": f"pivot_{tf.rows}",
        "RESOLUTION": tf.rows,
        "INPUTS": ("market", "bar_1s", f"bar_{tf.rows}", f"candle_{tf.window}", f"vol_{tf.rows}"),
    }
    return type(f"StepPivot_{tf.rows}", (StepPivotStage,), attrs)


def scale(base: type[StepPivotStage], k: float) -> type[StepPivotStage]:
    """One scale of a timeframe: `<stream>_atr_<k>`, a stage of its own."""
    name = f"{base.TF.stream}_atr_{k:g}".replace(".", "p")
    attrs = {"NAME": f"{base.TABLE}:{name}", "VARIANT": name, "K": k}
    return type(f"{base.__name__}_{name}", (base,), attrs)


# Paul's decision of November 3, 2026: 0.5, 1, and 2 ATRs (plan-1h-and-pivots.md, section 6).
MULTIPLIERS = (0.5, 1.0, 2.0)


def scales(tf: Timeframe) -> tuple[type[StepPivotStage], ...]:
    base = step_pivot(tf)
    return tuple(scale(base, k) for k in MULTIPLIERS)


PivotMinuteStage = step_pivot(SLOW)
SCALES = tuple(scale(PivotMinuteStage, k) for k in MULTIPLIERS)
