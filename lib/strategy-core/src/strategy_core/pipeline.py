"""The stage graph, run in tier order on one contract's market chunks.

`Pipeline` runs every registered stage (`STAGES`) on a `MarketChunk`, a whole session at once or
one second at a time, and returns each stage's table. Upstream stages pass their in-memory
products (bars, metrics, candles) to the stages that read them, so each stage is computed once
per chunk. Each stage keeps its own state and is checkpointed on its own (`export`, `restore`).

A stage reads its inputs' in-memory products and, through `products["tables"]`, the rows they
return for the chunk: the values they store.

`StageFeatures` is the engine's view of the same graph: one feature row per second, so
backtests, rehearsals, and stored rows compute every feature with the same code.

This module only composes stages; it computes nothing itself, so it is not part of any stage's
identity. Tests prove that stored rows equal its output in any chunking.

It also names which rows of a stage are stored (`stored`). Most stages store every row. The
fast swing scales are computed for every second but stored only where something reads them;
the rule's name (`STORED_ROWS`) is part of their builder identity, so changing the rule
rebuilds them.
"""

from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

from .bars import AggregationReport
from .columns import Table
from .engine import MarketChunk
from .features import FeatureConfig, FeatureFrame, FeatureSpec, Unit
from .market import NS, SessionCalendar
from .stage_bar_1m import MinuteBarStage
from .stage_bar_1s import BarStage
from .stage_candle_1h_1m import HourCandleStage
from .stage_candle_1m_1s import CandleStage
from .stage_pivot_1m import SCALES as SLOW_SCALES
from .stage_pivot_1s import SCALES as FAST_SCALES
from .stage_pivot_label import FAST_LABELS, SLOW_LABELS
from .stage_stats_1h_1m import HourStatsStage
from .stage_vol_1m import VolMinuteStage
from .stage_vol_1s import VolSecondStage
from .stages import Stage, StageContext
from .state import export_state, import_state

# In dependency (tier) order; the two resolutions are independent branches.
STAGES: tuple[type[Stage], ...] = (
    BarStage,
    MinuteBarStage,
    CandleStage,
    HourCandleStage,
    HourStatsStage,
    VolMinuteStage,
    VolSecondStage,
    *SLOW_SCALES,
    *FAST_SCALES,
    *SLOW_LABELS,  # labels look into the future: stored, but never read by a stage or the engine
    *FAST_LABELS,
)
BY_NAME = {s.NAME: s for s in STAGES}
# What a backtest or live session computes: every stage but the labels.
FEATURE_STAGES = tuple(s for s in STAGES if not getattr(s, "LABEL", False))


# Stages computed for every row but stored only at `stored_ordinals` (docs/project/ingestion.md).
SPARSE = frozenset(s.NAME for s in FAST_SCALES)
SPARSE_LABELS = frozenset(s.NAME for s in FAST_LABELS)  # their rows are the decision rows
STORED_ROWS = "label_rows+events+minute_ends:v1"
MINUTE_ROWS = 60  # minute m ends with second 60m


def check_graph(stages: tuple[type[Stage], ...] = STAGES) -> None:
    """Every stage reads only the source or stages before it, of no higher tier, and never a
    label stage."""
    seen: dict[str, int] = {}
    labels = {s.NAME for s in stages if getattr(s, "LABEL", False)}
    for s in stages:
        for name in s.INPUTS:
            if name in labels:
                raise ValueError(f"{s.NAME} reads {name}, a label: labels are never inputs")
            if name != "market" and (name not in seen or seen[name] > s.TIER):
                raise ValueError(f"{s.NAME} reads {name}, which is not an earlier stage")
        if s.NAME in seen:
            raise ValueError(f"Stage {s.NAME} is registered twice")
        seen[s.NAME] = s.TIER


check_graph()


@dataclass(frozen=True)
class PipelineRows:
    tables: dict[str, Table]  # stage name -> its rows for the chunk
    report: AggregationReport
    products: dict[str, Any] = field(default_factory=dict)  # in-memory values passed between stages

    def __len__(self) -> int:
        return len(next(iter(self.tables.values())))


def stored_ordinals(rows: PipelineRows) -> np.ndarray:
    """The seconds of this chunk at which the sparse stages keep a row, besides each minute's
    last second: every row of a fast label (a candidate's decision row, or the confirmation row
    of a swing that never had one) and every row in which a fast scale emitted an event. All
    sparse stages keep the same seconds, so any scale can be joined to any other there."""
    parts = [rows.tables[name].values["slot_ordinal"] for name in sorted(SPARSE_LABELS)]
    parts += [rows.products["events"][name].values["slot_ordinal"] for name in sorted(SPARSE)]
    return np.unique(np.concatenate(parts).astype(np.int64))


def stored_rows(name: str, rows: PipelineRows) -> Table:
    """The rows of stage `name` that storage keeps: all of them, or for a sparse stage those at
    `stored_ordinals` and at each minute's last second. Values are never changed."""
    table = rows.tables[name]
    if name not in SPARSE:
        return table
    ordinal = table.values["slot_ordinal"]
    keep = (ordinal % MINUTE_ROWS == 0) | np.isin(ordinal, stored_ordinals(rows))
    return Table(
        {k: v[keep] for k, v in table.values.items()},
        {k: v[keep] for k, v in table.nulls.items()},
    )


class Pipeline:
    def __init__(
        self,
        calendar: SessionCalendar,
        *,
        feed_latency: int,
        close_delay: int,
        config: FeatureConfig | None = None,
        stages: tuple[type[Stage], ...] = STAGES,
    ):
        self.context = StageContext(calendar, feed_latency, close_delay, config or FeatureConfig())
        self.stages: dict[str, Stage] = {s.NAME: s(self.context) for s in stages}

    def process(self, chunk: MarketChunk) -> PipelineRows:
        tables: dict[str, Table] = {}
        products: dict[str, Any] = {"tables": tables}  # each stage's rows, for those after it
        for name, stage in self.stages.items():
            tables[name] = stage.process(chunk, products)
        return PipelineRows(dict(tables), products["report"], products)

    def export(self, name: str) -> dict:
        return export_state(self.stages[name])

    def restore(self, name: str, state: dict) -> None:
        import_state(self.stages[name], state)


class StageFeatures:
    """Feature rows at every scheduled-open second from the stage graph: the `1m@1s` features of
    the window ending then (`candle_1m_1s` and `vol_1s`, one row each per second, joined row by
    row) and the `1h@1m` features of the latest completed minute (`candle_1h_1m`, `stats_1h_1m`,
    and `vol_1m`, one row each per minute), with that minute's age, `1h@1m.age_s`. Swing scales
    join the same way under their own names: the fast ones row by row as
    `1m@1s.<scale>.<feature>`, the slow ones as of the latest completed minute as
    `1h@1m.<scale>.<feature>`. `context` holds the price-unit values execution needs (the latest
    close and the `1m@1s` ATR from `vol_1s`), never inputs to signals or models."""

    FAST, BIAS = "candle_1m_1s", "candle_1h_1m"
    # rows per second, joined row by row
    SECONDLY = (FAST, "vol_1s", *(s.NAME for s in FAST_SCALES))
    # rows per completed minute, joined as of each second
    HOURLY = (BIAS, "stats_1h_1m", "vol_1m", *(s.NAME for s in SLOW_SCALES))
    PREFIX: ClassVar[dict[str, str]] = {
        **{name: "1m@1s" for name in (FAST, "vol_1s")},
        **{name: "1h@1m" for name in (BIAS, "stats_1h_1m", "vol_1m")},
        **{s.NAME: f"1m@1s.{s.VARIANT}" for s in FAST_SCALES},
        **{s.NAME: f"1h@1m.{s.VARIANT}" for s in SLOW_SCALES},
    }
    AGE = FeatureSpec("1h@1m.age_s", Unit.SECONDS, "Seconds since the bias candle completed")

    def __init__(
        self,
        calendar: SessionCalendar,
        *,
        feed_latency: int,
        close_delay: int,
        config: FeatureConfig | None = None,
    ):
        self.pipeline = Pipeline(
            calendar,
            feed_latency=feed_latency,
            close_delay=close_delay,
            config=config,
            stages=FEATURE_STAGES,
        )
        self.last_bias: dict[str, np.ndarray] = {}  # the latest minute's values, one row each
        self.last_bias_end = np.zeros(0, np.int64)

    @staticmethod
    def names(stage: str) -> list[str]:
        return [c.name for c in BY_NAME[stage].COLUMNS if c.unit]

    @classmethod
    def read(cls, table: Table, stage: str) -> dict[str, np.ndarray]:
        """A stage's features as stored: NaN wherever the stored value is NULL."""
        out = {}
        for n in cls.names(stage):
            null = table.nulls.get(n)
            out[n] = table.values[n] if null is None else np.where(null, np.nan, table.values[n])
        return out

    def specs(self) -> list[FeatureSpec]:
        out = [
            FeatureSpec(f"{self.PREFIX[name]}.{c.name}", Unit(c.unit), c.description)
            for name in (*self.SECONDLY, *self.HOURLY)
            for c in BY_NAME[name].COLUMNS
            if c.unit
        ]
        return [*out, self.AGE]

    @classmethod
    def sources(cls) -> dict[str, str]:
        """The stage each feature comes from, by name (the bias age from the bias candle)."""
        out = {
            f"{cls.PREFIX[name]}.{n}": name
            for name in (*cls.SECONDLY, *cls.HOURLY)
            for n in cls.names(name)
        }
        return out | {cls.AGE.name: cls.BIAS}

    def update(self, chunk: MarketChunk) -> FeatureFrame:
        rows = self.pipeline.process(chunk)
        ends = rows.tables[self.FAST].values["end_ns"]
        features: dict[str, np.ndarray] = {}
        for stage in self.SECONDLY:
            table = rows.tables[stage]
            if not np.array_equal(table.values["end_ns"], ends):
                raise AssertionError(f"{stage} rows must align with {self.FAST}")
            prefix = self.PREFIX[stage]
            features |= {f"{prefix}.{n}": v for n, v in self.read(table, stage).items()}
        bias_end = rows.tables[self.BIAS].values["end_ns"]
        minute_end = np.r_[self.last_bias_end, bias_end]
        values: dict[str, np.ndarray] = {}
        for stage in self.HOURLY:
            table = rows.tables[stage]
            if not np.array_equal(table.values["end_ns"], bias_end):
                raise AssertionError(f"{stage} rows must align with {self.BIAS}")
            prefix = self.PREFIX[stage]
            for n, v in self.read(table, stage).items():
                values[f"{prefix}.{n}"] = np.r_[self.last_bias.get(f"{prefix}.{n}", []), v]
        # As-of join: the latest minute completed at or before each second. The minute ending at
        # T completes with the second ending at T, so its age is then zero.
        i = np.searchsorted(minute_end, ends, side="right") - 1
        known = i >= 0
        safe = np.maximum(i, 0)
        nan = np.full(len(ends), np.nan)
        for n, v in values.items():
            features[n] = np.where(known, v[safe], np.nan) if len(v) else nan.copy()
        features[self.AGE.name] = (
            np.where(known, (ends - minute_end[safe]) / NS, np.nan) if len(minute_end) else nan
        )
        if len(minute_end):
            self.last_bias = {n: v[-1:] for n, v in values.items()}
            self.last_bias_end = minute_end[-1:]
        candles = rows.products["candles"]
        return FeatureFrame(ends, features, {"close": candles.close, "atr": self.atr(rows)})

    @staticmethod
    def atr(rows: PipelineRows) -> np.ndarray:
        """The `1m@1s` ATR in price units, which sizes brackets: `vol_1s.atr_price`, NaN where it
        is NULL (the same ATR the candle stage normalizes `atr_bps` with, bit for bit)."""
        table = rows.tables["vol_1s"]
        atr = table.values["atr_price"]
        null = table.nulls.get("atr_price")
        return atr if null is None else np.where(null, np.nan, atr)
