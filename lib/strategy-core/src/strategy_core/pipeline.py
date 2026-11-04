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
"""

from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

from .bars import AggregationReport
from .columns import Table
from .engine import MarketChunk
from .features import FeatureConfig, FeatureFrame, FeatureSpec, Unit, WindowFeatures
from .market import NS, SessionCalendar
from .stage_bar_1m import MinuteBarStage
from .stage_bar_1s import BarStage
from .stage_candle_1h_1m import HourCandleStage
from .stage_candle_1m_1s import CandleStage
from .stage_stats_1h_1m import HourStatsStage
from .stages import Stage, StageContext
from .state import export_state, import_state

# In dependency (tier) order; the two resolutions are independent branches.
STAGES: tuple[type[Stage], ...] = (
    BarStage,
    MinuteBarStage,
    CandleStage,
    HourCandleStage,
    HourStatsStage,
)
BY_NAME = {s.NAME: s for s in STAGES}


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


class FastAtr:
    """The `1m@1s` ATR in price units, which sizes the engine's brackets. The candle stage
    computes it but stores only `atr_bps`, and its module is part of the stored rows' identity,
    so until the stage's next rebuild publishes it, this records it as the stage's window
    features return it."""

    def __init__(self, window: WindowFeatures):
        self.values = np.zeros(0)
        update = window.update

        def record(bars):
            candles, features, atr = update(bars)
            self.values = atr
            return candles, features, atr

        window.update = record


class StageFeatures:
    """Feature rows at every scheduled-open second from the stage graph: the `1m@1s` features of
    the candle ending then (`candle_1m_1s`) and the `1h@1m` features of the latest completed
    minute (`candle_1h_1m` and `stats_1h_1m`, one row each per minute), with that minute's age,
    `1h@1m.age_s`. `context` holds the price-unit values execution needs (the latest close and
    the `1m@1s` ATR), never inputs to signals or models."""

    FAST, BIAS = "candle_1m_1s", "candle_1h_1m"
    HOURLY = (BIAS, "stats_1h_1m")  # rows per completed minute, joined as of each second
    PREFIX: ClassVar[dict[str, str]] = {FAST: "1m@1s", **{name: "1h@1m" for name in HOURLY}}
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
            calendar, feed_latency=feed_latency, close_delay=close_delay, config=config
        )
        self.atr = FastAtr(self.pipeline.stages[self.FAST].fast)
        self.last_bias: dict[str, np.ndarray] = {}  # the latest minute's values, one row each
        self.last_bias_end = np.zeros(0, np.int64)

    @staticmethod
    def names(stage: str) -> list[str]:
        return [c.name for c in BY_NAME[stage].COLUMNS if c.unit]

    def specs(self) -> list[FeatureSpec]:
        out = [
            FeatureSpec(f"{self.PREFIX[name]}.{c.name}", Unit(c.unit), c.description)
            for name in (self.FAST, *self.HOURLY)
            for c in BY_NAME[name].COLUMNS
            if c.unit
        ]
        return [*out, self.AGE]

    def update(self, chunk: MarketChunk) -> FeatureFrame:
        rows = self.pipeline.process(chunk)
        fast = rows.tables[self.FAST].values
        features = {f"1m@1s.{n}": fast[n] for n in self.names(self.FAST)}
        ends = fast["end_ns"]
        bias_end = rows.tables[self.BIAS].values["end_ns"]
        minute_end = np.r_[self.last_bias_end, bias_end]
        values: dict[str, np.ndarray] = {}
        for stage in self.HOURLY:
            table = rows.tables[stage].values
            if not np.array_equal(table["end_ns"], bias_end):
                raise AssertionError(f"{stage} rows must align with {self.BIAS}")
            for n in self.names(stage):
                values[n] = np.r_[self.last_bias.get(n, []), table[n]]
        # As-of join: the latest minute completed at or before each second. The minute ending at
        # T completes with the second ending at T, so its age is then zero.
        i = np.searchsorted(minute_end, ends, side="right") - 1
        known = i >= 0
        safe = np.maximum(i, 0)
        nan = np.full(len(ends), np.nan)
        for n, v in values.items():
            features[f"1h@1m.{n}"] = np.where(known, v[safe], np.nan) if len(v) else nan.copy()
        features[self.AGE.name] = (
            np.where(known, (ends - minute_end[safe]) / NS, np.nan) if len(minute_end) else nan
        )
        if len(minute_end):
            self.last_bias = {n: v[-1:] for n, v in values.items()}
            self.last_bias_end = minute_end[-1:]
        candles = rows.products["candles"]
        return FeatureFrame(ends, features, {"close": candles.close, "atr": self.atr.values})
