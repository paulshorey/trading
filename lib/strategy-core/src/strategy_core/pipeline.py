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
from .stage_bar_1s import BarStage
from .stage_step_bar import MinuteBarStage, step_bar
from .stage_step_candle import CandleStage, HourCandleStage, step_candle
from .stage_step_pivot import BY_TIMEFRAME as STEP_SCALES
from .stage_step_pivot import FAST_SCALES
from .stage_step_stats import HourStatsStage, SecondStatsStage, step_stats
from .stage_step_vol import VolMinuteStage, VolSecondStage, step_vol
from .stages import Stage, StageContext
from .state import export_state, import_state
from .timeframes import FAST as FAST_TF
from .timeframes import MIDDLE, SLOW, Timeframe

# The timeframes whose stages are registered and stored, fastest first. Adding one adds stages;
# it changes no other stage's identity.
TIMEFRAMES: tuple[Timeframe, ...] = (FAST_TF, MIDDLE, SLOW)
MERGED = tuple(tf for tf in TIMEFRAMES if tf.merged)  # their step rows are merged from seconds

# The stages of each timeframe: step rows (the source rows for one second), window, statistics,
# volatility. `1m@1s` and `1h@1m` keep the classes their modules export.
EXPORTED = {
    FAST_TF.name: (BarStage, CandleStage, SecondStatsStage, VolSecondStage),
    SLOW.name: (MinuteBarStage, HourCandleStage, HourStatsStage, VolMinuteStage),
}
STEP_STAGES: dict[str, tuple[type[Stage], ...]] = {
    tf.name: EXPORTED.get(tf.name) or (step_bar(tf), step_candle(tf), step_stats(tf), step_vol(tf))
    for tf in TIMEFRAMES
}

# In dependency (tier) order; the timeframes are independent branches above `bar_1s`.
STAGES: tuple[type[Stage], ...] = (
    *(STEP_STAGES[tf.name][0] for tf in TIMEFRAMES),
    *(s for tf in TIMEFRAMES for s in STEP_STAGES[tf.name][1:]),
    *(s for tf in TIMEFRAMES for s in STEP_SCALES[tf.name]),
)
BY_NAME = {s.NAME: s for s in STAGES}
# What a backtest or live session computes: every stage. A stage that looks into the future
# (an outcome label) would be stored but left out here; none is registered today.
FEATURE_STAGES = STAGES


# Stages computed for every row but stored only at `stored_ordinals` (docs/project/ingestion.md).
SPARSE = frozenset(s.NAME for s in FAST_SCALES)
# Every merged timeframe's step rows end on a multiple of the shortest merged step (steps divide
# a minute), so keeping those seconds lets any slower row read the fast scales as of its own
# end. The step is part of the rule's name: another shortest step rebuilds the sparse stages.
STEP_ROWS = min(tf.seconds for tf in MERGED)
STORED_ROWS = f"events+step_ends_{STEP_ROWS}s:v4"


def check_graph(stages: tuple[type[Stage], ...] = STAGES) -> None:
    """Every stage reads only the source or stages before it, of no higher tier."""
    seen: dict[str, int] = {}
    for s in stages:
        for name in s.INPUTS:
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
    """The seconds of this chunk at which the sparse stages keep a row, besides the last second
    of every step row: every row in which a fast scale emitted an event. All sparse stages keep
    the same seconds, so any scale can be joined to any other there."""
    parts = [rows.products["events"][name].values["slot_ordinal"] for name in sorted(SPARSE)]
    return np.unique(np.concatenate(parts).astype(np.int64))


def stored_rows(name: str, rows: PipelineRows) -> Table:
    """The rows of stage `name` that storage keeps: all of them, or for a sparse stage those at
    `stored_ordinals` and at the last second of every step row. Values are never changed."""
    table = rows.tables[name]
    if name not in SPARSE:
        return table
    ordinal = table.values["slot_ordinal"]
    keep = (ordinal % STEP_ROWS == 0) | np.isin(ordinal, stored_ordinals(rows))
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
    row) and, for every merged timeframe (`10m@10s`, `1h@1m`), the features of its latest
    completed step row (its candle, statistics, and volatility stages, one row each per step
    row), with that row's age, `<timeframe>.age_s`. Swing scales join the same way under their
    own names: the fast ones row by row as `1m@1s.<scale>.<feature>`, the others as of the
    latest completed step row as `<timeframe>.<scale>.<feature>`. `context` holds the price-unit
    values execution needs, never inputs to signals or models: the latest close, and each
    timeframe's ATR as `atr:<timeframe>` (`atr` is the `1m@1s` one), from its volatility
    stage, as of the same row as its features."""

    FAST, BIAS = "candle_1m_1s", "candle_1h_1m"
    # rows per second, joined row by row: the one-second timeframe's
    SECONDLY = (
        *(s.NAME for s in STEP_STAGES[FAST_TF.name][1:]),
        *(s.NAME for s in STEP_SCALES[FAST_TF.name]),
    )
    # rows per completed step row of each merged timeframe, joined as of each second; the
    # first stage of each is its candle
    STEPWISE: ClassVar[dict[str, tuple[str, ...]]] = {
        tf.name: (
            *(s.NAME for s in STEP_STAGES[tf.name][1:]),
            *(s.NAME for s in STEP_SCALES[tf.name]),
        )
        for tf in MERGED
    }
    HOURLY = STEPWISE[SLOW.name]
    PREFIX: ClassVar[dict[str, str]] = {
        **{s.NAME: tf.name for tf in TIMEFRAMES for s in STEP_STAGES[tf.name][1:]},
        **{s.NAME: f"{tf.name}.{s.VARIANT}" for tf in TIMEFRAMES for s in STEP_SCALES[tf.name]},
    }
    AGES: ClassVar[dict[str, FeatureSpec]] = {
        tf.name: FeatureSpec(
            f"{tf.name}.age_s",
            Unit.SECONDS,
            f"Seconds since the latest {tf.name} step row completed",
        )
        for tf in MERGED
    }
    AGE = AGES[SLOW.name]
    ATR = "#atr_price"  # a timeframe's ATR while it is carried with its features: context

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
        # per merged timeframe: the latest step row's values (one row each) and its end
        self.last: dict[str, dict[str, np.ndarray]] = {name: {} for name in self.STEPWISE}
        self.last_end = {name: np.zeros(0, np.int64) for name in self.STEPWISE}

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

    @classmethod
    def stages(cls) -> tuple[str, ...]:
        """Every stage the engine reads, in feature order."""
        return (*cls.SECONDLY, *(name for group in cls.STEPWISE.values() for name in group))

    def specs(self) -> list[FeatureSpec]:
        def of(names: tuple[str, ...]) -> list[FeatureSpec]:
            return [
                FeatureSpec(f"{self.PREFIX[name]}.{c.name}", Unit(c.unit), c.description)
                for name in names
                for c in BY_NAME[name].COLUMNS
                if c.unit
            ]

        out = of(self.SECONDLY)
        for timeframe, group in self.STEPWISE.items():  # each timeframe's features, then its age
            out += [*of(group), self.AGES[timeframe]]
        return out

    @classmethod
    def sources(cls) -> dict[str, str]:
        """The stage each feature comes from, by name (a timeframe's age from its candle)."""
        out = {f"{cls.PREFIX[name]}.{n}": name for name in cls.stages() for n in cls.names(name)}
        return out | {cls.AGES[tf].name: group[0] for tf, group in cls.STEPWISE.items()}

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
        fast = self.atr(rows.tables["vol_1s"])
        context = {"atr": fast, f"atr:{FAST_TF.name}": fast}
        for timeframe, group in self.STEPWISE.items():
            found = self.as_of(timeframe, group, rows, ends)
            context[f"atr:{timeframe}"] = found.pop(self.ATR)
            features |= found
        candles = FAST_TF.frame(rows.products)["candles"]
        return FeatureFrame(ends, features, {"close": candles.close} | context)

    def as_of(
        self, timeframe: str, group: tuple[str, ...], rows: PipelineRows, ends: np.ndarray
    ) -> dict[str, np.ndarray]:
        """One merged timeframe's features at every second: those of its latest step row
        completed at or before the second, and that row's age. The step row ending at T
        completes with the second ending at T, so its age is then zero."""
        step_end = rows.tables[group[0]].values["end_ns"]
        row_end = np.r_[self.last_end[timeframe], step_end]
        last = self.last[timeframe]
        values: dict[str, np.ndarray] = {}
        for stage in group:
            table = rows.tables[stage]
            if not np.array_equal(table.values["end_ns"], step_end):
                raise AssertionError(f"{stage} rows must align with {group[0]}")
            prefix = self.PREFIX[stage]
            for n, v in self.read(table, stage).items():
                values[f"{prefix}.{n}"] = np.r_[last.get(f"{prefix}.{n}", []), v]
            if "atr_price" in table.values:  # the timeframe's volatility stage
                values[self.ATR] = np.r_[last.get(self.ATR, []), self.atr(table)]
        i = np.searchsorted(row_end, ends, side="right") - 1
        known = i >= 0
        safe = np.maximum(i, 0)
        nan = np.full(len(ends), np.nan)
        out = {}
        for n, v in values.items():
            out[n] = np.where(known, v[safe], np.nan) if len(v) else nan.copy()
        out[self.AGES[timeframe].name] = (
            np.where(known, (ends - row_end[safe]) / NS, np.nan) if len(row_end) else nan
        )
        if len(row_end):
            self.last[timeframe] = {n: v[-1:] for n, v in values.items()}
            self.last_end[timeframe] = row_end[-1:]
        return out

    @staticmethod
    def atr(table: Table) -> np.ndarray:
        """A volatility stage's ATR in price units, which sizes brackets: `atr_price`, NaN where
        it is NULL (the same ATR its candle stage normalizes `atr_bps` with, bit for bit)."""
        atr = table.values["atr_price"]
        null = table.nulls.get("atr_price")
        return atr if null is None else np.where(null, np.nan, atr)
