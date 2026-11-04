"""The stage graph, run in tier order on one contract's market chunks.

`Pipeline` runs every registered stage (`STAGES`) on a `MarketChunk`, a whole session at once or
one second at a time, and returns each stage's table. Upstream stages pass their in-memory
products (bars, metrics, candles) to the stages that read them, so each stage is computed once
per chunk. Each stage keeps its own state and is checkpointed on its own (`export`, `restore`).

This module only composes stages; it computes nothing itself, so it is not part of any stage's
identity. Tests prove that stored rows equal its output in any chunking.
"""

from dataclasses import dataclass
from typing import Any

from .bars import AggregationReport
from .columns import Table
from .engine import MarketChunk
from .features import FeatureConfig
from .market import SessionCalendar
from .stage_bar_1s import BarStage
from .stage_candle_1m_1s import CandleStage
from .stages import Stage, StageContext
from .state import export_state, import_state

STAGES: tuple[type[Stage], ...] = (BarStage, CandleStage)  # in dependency (tier) order
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
        products: dict[str, Any] = {}
        tables = {name: stage.process(chunk, products) for name, stage in self.stages.items()}
        return PipelineRows(tables, products["report"])

    def export(self, name: str) -> dict:
        return export_state(self.stages[name])

    def restore(self, name: str, state: dict) -> None:
        import_state(self.stages[name], state)
