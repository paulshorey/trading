"""Stages `pivot_<rows>` (tier 2): the swing scales of a timeframe (`timeframes.py`), one row per
scheduled-open step row and scale. `pivot_1s` holds the fast scales of `1m@1s`, `pivot_10s` the
middle ones of `10m@10s`, and `pivot_1m` the slow ones of `1h@1m`.

Each scale is its own stage (a variant: `fast_atr_0p5`, `mid_atr_1`, `slow_atr_2`, ...) writing
to its timeframe's shared table under its `variant_id`, so every scale has its own builder
identity, checkpoint, and session records, and adding a scale never rebuilds the others.

Every scale replays the same released trades (`swings.Detector`); only its threshold and its
publication differ. A running extreme is confirmed by a reversal of
`theta = max(K x ATR, FLOOR x spread)` in basis points. It uses the timeframe's ATR(14)
(`candle_<window>.atr_bps`) and the last sampled book spread, both **as of the latest step row
completed before the trade's own row** (on `1m@1s`, the previous second: the row of the extreme
would include trades after it), with that row's normalizing ATR in price units
(`vol_<rows>.norm_atr_price`: the ATR, or the spread where that is larger, so it is positive in
a market that has stopped moving) as the frozen ATR. The spread is carried from the step rows
(`last_bid`, `last_ask`: the last trade in the row with a usable book), never across a missing
row.

State is published once per step row, after its last second; a confirmation or breach inside a
row appears on that row and never earlier. Faster rows read it through an as-of join
(`pipeline.StageFeatures`). A missing second ends the segment at once and keeps the scale idle
for the rest of its row; the next rows then wait for the ATR. Events (confirmed highs and lows,
breaches, reclaims) go to `market.pivot_event` with the row of the trade that produced them.
Ages count step rows x their seconds: scheduled-open seconds.

Structure depends on arbitrarily old swings, so no lead makes it history-complete: it starts a
fresh segment at the contract's span start, and `warm` says whether every row of the last
chunk had a confirmed high and low. `warmup()` covers only the threshold's inputs.
"""

from typing import Any, ClassVar

import numpy as np

from . import swings, warmup
from .bars import MISSING
from .columns import SMALLINT, Column, Table
from .engine import MarketChunk
from .features import Unit
from .market import PX
from .normalizer import last_spread_bps
from .stages import Stage
from .timeframes import FAST, MIDDLE, SLOW, Timeframe

SPEC = swings.dense_columns()
# Trend and breaks in one code (roadmap decision 32), from the row's own columns.
STRUCTURE = Column(
    "structure",
    SMALLINT,
    "3 x (trend + 1) + (break + 1), 0..8: trend as above; break is 1 once price has exceeded "
    "the latest confirmed high, -1 once it has gone below the latest confirmed low, 0 while "
    "both hold (the more recent break when neither does). 8 up and extending, 7 up and "
    "inside, 6 up with its low broken, 5..3 mixed, 2 down with its high broken, 1 down and "
    "inside, 0 down and extending; NULL until trend is known",
    Unit.RATIO.value,
)
COLUMNS = (*swings.KEY_COLUMNS, *(c for c, _ in SPEC), STRUCTURE)
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
NEVER = -(2**62)  # no step row seen yet
# Step rows within which a breached level can be reclaimed: a quarter of the hourly window (15
# minutes), half of the ten-minute one (5 minutes), the whole one-minute one (60 seconds).
RECLAIM_ROWS = {"1m": 15, "10s": 30, "1s": 60}


def with_structure(table: Table) -> Table:
    """The published rows with the `structure` code computed from their own columns."""
    v, null = table.values, table.nulls
    up, down = ~null["break_up_age_s"], ~null["break_down_age_s"]
    newer_up = v["break_up_age_s"] <= v["break_down_age_s"]
    broke = np.where(up & down, np.where(newer_up, 1, -1), up.astype(np.int64) - down)
    code = np.where(null["trend"], 0, 3 * (v["trend"] + 1) + broke + 1).astype(np.int64)
    return Table(v | {STRUCTURE.name: code}, null | {STRUCTURE.name: null["trend"].copy()})


def minute_spread(base: Table, carry: np.ndarray) -> np.ndarray:
    """The last sampled book spread as of each step row, in bps of its midpoint
    (`normalizer.last_spread_bps`): from the latest row with a usable book, in this chunk or
    carried (`carry`: has, bid, ask; updated in place), and unknown from a missing row until
    the next usable book."""
    return last_spread_bps(
        base.values["status"],
        ~base.nulls["last_bid"] & ~base.nulls["last_ask"],
        base.values["last_bid"],
        base.values["last_ask"],
        carry,
    )


class StepPivotStage(Stage):
    TF: ClassVar[Timeframe]  # set by `step_pivot`, with TABLE, RESOLUTION, and INPUTS
    TABLE: ClassVar[str]  # the table every scale of the timeframe writes to
    EVENTS: ClassVar[str] = "pivot_event"  # the table its events go to
    EVENT_COLUMNS = swings.EVENT_COLUMNS
    VARIANT: ClassVar[str]  # the scale's name in `market.variant`
    K: ClassVar[float]  # threshold, in ATRs
    FLOOR: ClassVar[float] = 2.0  # and at least this many spreads
    WINDOW: ClassVar[int]  # step rows within which a breached level can be reclaimed
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
        "normalizer",
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
            "atr_snapshot": f"vol_{self.TF.rows}.norm_atr_price",
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
            return with_structure(swings.dense_table(SPEC, none, none, np.zeros((0, swings.NO))))
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
            # the frozen ATR that swing values are measured in: floored at the spread, so it
            # is positive even where the ATR itself has decayed to exactly zero
            atr = np.r_[atr, swings.as_float(vol, "norm_atr_price") * PX]
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
        return with_structure(swings.dense_table(SPEC, done, minute_end, out))


def step_pivot(tf: Timeframe) -> type[StepPivotStage]:
    """The base class of timeframe `tf`'s swing scales."""
    attrs = {
        "TF": tf,
        "TABLE": f"pivot_{tf.rows}",
        "WINDOW": RECLAIM_ROWS[tf.rows],
        "RESOLUTION": tf.rows,
        "INPUTS": tuple(
            dict.fromkeys(  # `bar_1s` once on the one-second timeframe
                ("market", "bar_1s", f"bar_{tf.rows}", f"candle_{tf.window}", f"vol_{tf.rows}")
            )
        ),
    }
    return type(f"StepPivot_{tf.rows}", (StepPivotStage,), attrs)


def scale(base: type[StepPivotStage], k: float) -> type[StepPivotStage]:
    """One scale of a timeframe: `<stream>_atr_<k>`, a stage of its own."""
    name = f"{base.TF.stream}_atr_{k:g}".replace(".", "p")
    attrs = {"NAME": f"{base.TABLE}:{name}", "VARIANT": name, "K": k}
    return type(f"{base.__name__}_{name}", (base,), attrs)


# Paul's decisions: 0.5, 1, and 2 ATRs (November 3, 2026), and 3 ATRs as the swing the trend
# gate reads (roadmap decisions 30 and 38, November 23 and 24).
MULTIPLIERS = (0.5, 1.0, 2.0, 3.0)


PivotMinuteStage = step_pivot(SLOW)
SCALES = tuple(scale(PivotMinuteStage, k) for k in MULTIPLIERS)  # the slow scales
PivotMiddleStage = step_pivot(MIDDLE)
MIDDLE_SCALES = tuple(scale(PivotMiddleStage, k) for k in MULTIPLIERS)
PivotSecondStage = step_pivot(FAST)
FAST_SCALES = tuple(scale(PivotSecondStage, k) for k in MULTIPLIERS)
BY_TIMEFRAME = {FAST.name: FAST_SCALES, MIDDLE.name: MIDDLE_SCALES, SLOW.name: SCALES}
