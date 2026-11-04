"""Stages: the units of calculation, storage, and versioning (docs/project/feature-pipeline.md).

A stage turns one contract's chunk of market data (a whole session, or one second at a time)
into one stored table, reading only the in-memory products of the stages it declares as
inputs. It keeps its own streaming state (`STATE`, see `state.export_state`), so it can be
checkpointed and resumed on its own, and processing a session at once or one second at a time
gives identical rows.

A stage declares what determines its stored values, so ingestion can version it on its own:

- `MODULES`: the `strategy_core` modules whose code computes it (hashed into its identity);
- `settings()`: the parameters it was built with;
- `COLUMNS`: its stored columns, with roles and units (`columns.Column`);
- `INPUTS`: the stages it reads, whose identities become part of its own.

Adding a stage, or changing one, never changes the identity of a stage that does not depend on
it. `warmup()` reports how many scheduled-open seconds its values need to settle, derived from
its parameters (`warmup.py`); the contract lead is computed from it.
"""

from dataclasses import dataclass
from typing import Any, ClassVar

from .columns import Column, Table
from .engine import MarketChunk
from .features import FeatureConfig
from .market import SessionCalendar


@dataclass(frozen=True)
class StageContext:
    """What every stage of a contract is built with: the exchange calendar (which defines the
    scheduled-open rows and their index counters), trade-assignment timing, and settings."""

    calendar: SessionCalendar
    feed_latency: int
    close_delay: int
    features: FeatureConfig


class Stage:
    NAME: ClassVar[str]
    TIER: ClassVar[int]
    RESOLUTION: ClassVar[str]  # step of the stage's rows, for example "1s"
    INPUTS: ClassVar[tuple[str, ...]]  # "market" is the source chunk itself
    MODULES: ClassVar[tuple[str, ...]]  # strategy_core modules (without .py) that compute it
    COLUMNS: ClassVar[tuple[Column, ...]]
    STATE: ClassVar[tuple[str, ...]]

    def __init__(self, context: StageContext):
        self.context = context

    def settings(self) -> dict[str, Any]:
        """Parameters that determine stored values, beyond the code in `MODULES`."""
        return {}

    def warmup(self) -> int:
        """Scheduled-open seconds after which every value of this stage has settled."""
        return 0

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        """Rows of this stage for the chunk. Reads its inputs' entries of `products` and adds its
        own, for the stages after it."""
        raise NotImplementedError
