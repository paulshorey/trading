"""Stages `pivot_1s` (tier 2): the fast swing scales, one row per scheduled-open second and scale.

Each scale is its own stage (a variant: `fast_atr_0p5`, `fast_atr_1`, `fast_atr_2`) writing to the
shared table `market.pivot_1s` under its `variant_id`, so every scale has its own builder
identity, checkpoint, and session records, and adding a scale never rebuilds the others.

A scale replays the released trades (`swings.Detector`): a running extreme is confirmed by a
reversal of `theta = max(K x ATR, FLOOR x spread)` in basis points, where ATR is the `1m@1s`
ATR(14) (`candle_1m_1s.atr_bps`) and the spread the last sampled book spread
(`candle_1m_1s.book_spread_bps`), both **as of the previous second's row**: the row of the
extreme would include trades after it. Distances "in ATRs" use the same row's ATR in price units
(`vol_1s.atr_price`), frozen with the extreme. State is published once per second, after that
second's trades; events (confirmed highs and lows, breaches, reclaims) go to
`market.pivot_event` with the second of the trade that produced them.

Structure depends on arbitrarily old swings, so no lead makes it history-complete: it starts a
fresh segment at the contract's span start, and `warm` says whether every row of the last
chunk had a confirmed high and low. `warmup()` covers only the threshold's inputs.
"""

from typing import Any, ClassVar

import numpy as np

from . import swings, warmup
from .bars import MISSING
from .columns import Table
from .engine import MarketChunk
from .market import PX, SECOND
from .stages import Stage
from .windows import FAST

SPEC = swings.dense_columns()
COLUMNS = (*swings.KEY_COLUMNS, *(c for c, _ in SPEC))
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
PERIOD_SECONDS = FAST.period // SECOND  # scheduled-open seconds per same-phase ATR period


class PivotSecondStage(Stage):
    TABLE: ClassVar[str] = "pivot_1s"  # the table every fast scale writes to
    EVENTS: ClassVar[str] = "pivot_event"  # the table its events go to
    EVENT_COLUMNS = swings.EVENT_COLUMNS
    VARIANT: ClassVar[str]  # the scale's name in `market.variant`
    K: ClassVar[float]  # threshold, in ATRs
    FLOOR: ClassVar[float] = 2.0  # and at least this many spreads
    WINDOW: ClassVar[int] = 60  # rows within which a breached level can be reclaimed
    TIER = 2
    RESOLUTION = "1s"
    INPUTS = ("market", "bar_1s", "candle_1m_1s", "vol_1s")
    MODULES = (
        "stages",
        "columns",
        "stage_pivot_1s",
        "swings",
        "bars",
        "market",
        "windows",
        "warmup",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("detector", "carry", "last_ordinal")

    def __init__(self, context):
        super().__init__(context)
        self.detector = swings.Detector(swings.PRICE, self.WINDOW, 1)
        self.carry = np.full(2, np.nan)  # the previous row's theta and ATR
        self.last_ordinal = -1
        self.warm = False  # of the last chunk with rows; not state

    def settings(self) -> dict[str, Any]:
        return {
            "variant": self.VARIANT,
            "stream": "fast",
            "source": "price",
            "multiplier": self.K,
            "normalizer": "candle_1m_1s.atr_bps",
            "atr_period": self.context.features.atr_period,
            "atr_snapshot": "vol_1s.atr_price",
            "spread": "candle_1m_1s.book_spread_bps",
            "spread_floor": self.FLOOR,
            "reclaim_window_rows": self.WINDOW,
        }

    def warmup(self) -> int:
        """The threshold's ATR(14), in scheduled-open seconds. The structure itself has no finite
        warm-up (`warm`)."""
        return warmup.wilder(self.context.features.atr_period) * PERIOD_SECONDS

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        bars = products["bars"]
        n = len(bars)
        events = products.setdefault("events", {})
        if not n:
            events[self.NAME] = swings.event_table(
                np.zeros((0, swings.NEI), np.int64), np.zeros((0, swings.NEF)),
                np.zeros(0, np.int64), self.context.close_delay,
            )  # fmt: skip
            return swings.dense_table(SPEC, *(np.zeros(0, np.int64),) * 2, np.zeros((0, swings.NO)))
        candle, vol = products["tables"]["candle_1m_1s"], products["tables"]["vol_1s"]
        if not (
            np.array_equal(candle.values["end_ns"], bars.end)
            and np.array_equal(vol.values["end_ns"], bars.end)
        ):
            raise AssertionError("pivot_1s rows must align with candle_1m_1s and vol_1s")
        ordinal = candle.values["slot_ordinal"]
        theta = np.maximum(
            self.K * swings.as_float(candle, "atr_bps"),
            self.FLOOR * swings.as_float(candle, "book_spread_bps"),
        )  # NaN when either is undefined
        atr = swings.as_float(vol, "atr_price") * PX  # in fixed-point price units
        if self.last_ordinal + 1 != int(ordinal[0]):  # not the next row: nothing carries
            self.carry = np.full(2, np.nan)
        rows = {
            "missing": bars.status == MISSING,
            "theta": np.r_[self.carry[0], theta[:-1]],  # as of the previous row
            "atr": np.r_[self.carry[1], atr[:-1]],
            "group": ordinal,
            "pub": ordinal,
            "emit": np.ones(n, bool),
        }
        self.carry = np.array([theta[-1], atr[-1]])
        self.last_ordinal = int(ordinal[-1])
        obs = swings.released(chunk, self.context, products)
        out, ev_i, ev_f = self.detector.advance(obs, rows)
        self.warm = swings.is_warm(out)
        events[self.NAME] = swings.event_table(
            ev_i, ev_f, bars.end[ev_i[:, swings.E_ROW]], self.context.close_delay
        )
        return swings.dense_table(SPEC, ordinal, bars.end, out)


def scale(name: str, k: float) -> type[PivotSecondStage]:
    return type(
        f"PivotSecond_{name}",
        (PivotSecondStage,),
        {"NAME": f"{PivotSecondStage.TABLE}:{name}", "VARIANT": name, "K": k},
    )


# Paul's decision of November 3, 2026: 0.5, 1, and 2 ATRs (plan-1h-and-pivots.md, section 6).
SCALES = (scale("fast_atr_0p5", 0.5), scale("fast_atr_1", 1.0), scale("fast_atr_2", 2.0))
