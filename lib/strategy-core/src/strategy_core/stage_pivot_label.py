"""Stages `pivot_label_1s` and `pivot_label_1m`: outcome labels of swing candidates, one stage
per swing scale and stage `q` (a variant, such as `fast_atr_1_q25`), written to the table of its
scale's resolution under its `variant_id`. The variant's parameters are the label ID; they were
frozen before any label was computed (docs/project/pivot-label-spec.md).

A label stage reads its scale's rows and events as that stage returned them for the chunk
(`products["tables"]`, `products["events"]`), the released trades (`swings.released`), and the
second rows' data coverage. It adds no model input: labels look into the future, no column of
theirs has a unit, no stage may read them, and the engine does not run them
(`pipeline.FEATURE_STAGES`). Unlike the dense stages, its rows are sparse: one per candidate,
keyed by the candidate's decision row, and emitted when its outcomes are settled, which is
always within the decision row's session.
"""

from typing import Any, ClassVar

import numpy as np

from . import pivot_labels, swings
from .bars import MISSING
from .columns import Table
from .engine import MarketChunk
from .market import SECOND
from .stage_step_pivot import FAST_SCALES, MIDDLE_SCALES
from .stage_step_pivot import SCALES as SLOW_SCALES
from .stages import Stage
from .swings import HIGH, LOW, NONE

LABEL_TIER = 9  # above every tier of inputs: labels read them and nothing reads labels
Q_STAGES = (0.25, 0.5)  # progress that makes a candidate
REVERSAL, INVALIDATION = 1.0, 0.25  # barriers, in thetas from and beyond the extreme
# Rows of the scale's stream after the decision row: 5 minutes fast, 40 minutes middle, 4 hours
# slow (docs/project/pivot-label-spec.md).
HORIZON = {"1s": 300, "10s": 240, "1m": 240}
COLUMNS = (*pivot_labels.KEY_COLUMNS, *pivot_labels.LABEL_COLUMNS)


class PivotLabelStage(Stage):
    LABEL: ClassVar[bool] = True
    TABLE: ClassVar[str]  # the table every label variant of the resolution writes to
    VARIANT: ClassVar[str]  # the label ID's name in `market.variant`
    SCALE: ClassVar[type[Stage]]  # the swing scale whose candidates it labels
    Q: ClassVar[float]
    TIER = LABEL_TIER
    MODULES = (
        "stages",
        "columns",
        "stage_pivot_label",
        "pivot_labels",
        "swings",
        "bars",
        "market",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("labeler",)

    def __init__(self, context):
        super().__init__(context)
        self.width = self.SCALE.TF.seconds  # seconds per row of the scale's stream
        rows = HORIZON[self.RESOLUTION]
        self.labeler = pivot_labels.Labeler(self.Q, REVERSAL, INVALIDATION, rows, rows)
        self.warm = False  # of the last chunk with rows of the scale; not state

    def settings(self) -> dict[str, Any]:
        return {
            "variant": self.VARIANT,
            "scale": self.SCALE.NAME,
            "stage_q": self.Q,
            "reversal": REVERSAL,
            "invalidation": INVALIDATION,
            "horizon_rows": HORIZON[self.RESOLUTION],
            "survival_rows": HORIZON[self.RESOLUTION],
            "session": "calendar interval",
        }

    def warmup(self) -> int:
        """Its scale's: a label needs nothing more than the candidate it describes."""
        return self.SCALE(self.context).warmup()

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        bars = products["bars"]
        if not len(bars):
            empty = np.zeros((0, pivot_labels.NLI), np.int64), np.zeros((0, pivot_labels.NLF))
            return pivot_labels.label_table(*empty, self.context.close_delay)
        scale = products["tables"][self.SCALE.NAME]
        events = products["events"][self.SCALE.NAME]
        second, w = products["ordinal"], self.width
        rows = {
            "missing": bars.status == MISSING,
            "pub": (second + (w - 1)) // w,
            "end": -(-bars.end // (w * SECOND)) * (w * SECOND),
            "emit": second % w == 0,
            # sessions are the calendar's intervals, which end on whole minutes
            "last": self.context.calendar.close_after(bars.end) == bars.end,
        }
        if int(rows["emit"].sum()) != len(scale):
            raise AssertionError(f"{self.NAME} must see every row its scale published")
        v, null = scale.values, scale.nulls
        up = v["dir"] > 0
        prov = np.where(up, v["prov_lh"], v["prov_hl"])
        state = {
            "state": v["state"].astype(np.int64),
            "segment": v["segment"].astype(np.int64),
            "dir": v["dir"].astype(np.int64),
            "px": v["ext_px"].astype(np.float64),
            "ext_ordinal": v["slot_ordinal"] - v["ext_age_s"] // w,
            "progress": swings.as_float(scale, "progress"),
            "theta": swings.as_float(scale, "theta_bps"),
            "prov": np.where(np.where(up, null["prov_lh"], null["prov_hl"]), NONE, prov).astype(
                np.int64
            ),
        }
        e = events.values
        pivot = (e["kind"] == HIGH) | (e["kind"] == LOW)
        confirmed = {
            # a trade assigned at `at` belongs to the second [T - 1s, T) with T > at
            "row": np.searchsorted(bars.end, e["at_ns"][pivot], side="right").astype(np.int64),
            "kind": e["kind"][pivot].astype(np.int64),
            "segment": e["segment"][pivot].astype(np.int64),
            "ext_ordinal": e["ext_ordinal"][pivot].astype(np.int64),
            "level": e["level"][pivot].astype(np.float64),
            "theta": e["theta"][pivot].astype(np.float64),
        }
        obs = swings.released(chunk, self.context, products)
        oi, of = self.labeler.advance(obs, rows, state, confirmed)
        if len(scale):  # as its scale reports it: every row had a confirmed high and low
            self.warm = not bool((null["high_age_s"] | null["low_age_s"]).any())
        return pivot_labels.label_table(oi, of, self.context.close_delay)


def label(scale: type[Stage], q: float) -> type[PivotLabelStage]:
    table = f"pivot_label_{scale.RESOLUTION}"
    name = f"{scale.VARIANT}_q{round(q * 100)}"
    return type(
        f"PivotLabel_{name}",
        (PivotLabelStage,),
        {
            "NAME": f"{table}:{name}",
            "TABLE": table,
            "VARIANT": name,
            "SCALE": scale,
            "Q": q,
            "RESOLUTION": scale.RESOLUTION,
            "INPUTS": ("market", "bar_1s", scale.NAME),
        },
    )


SLOW_LABELS = tuple(label(s, q) for s in SLOW_SCALES for q in Q_STAGES)
MIDDLE_LABELS = tuple(label(s, q) for s in MIDDLE_SCALES for q in Q_STAGES)
FAST_LABELS = tuple(label(s, q) for s in FAST_SCALES for q in Q_STAGES)
