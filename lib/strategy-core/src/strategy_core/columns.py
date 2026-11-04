"""Stored columns and the tables of values a stage produces.

Every stored column has a **role** (docs/project/feature-pipeline.md#database-properties):

- `feature`: a normalized model input with a `features.Unit` value;
- `context`: data in source units (raw prices, volumes, times of events), never a model input;
- `key`: what identifies a row (index counter, end time).

The column registry of every stage is mirrored into `market.column` and into PostgreSQL column
comments, and tests keep it equal to the schema.
"""

from dataclasses import dataclass

import numpy as np

BIGINT, INTEGER, SMALLINT, DOUBLE = "bigint", "integer", "smallint", "double precision"
FEATURE, CONTEXT, KEY = "feature", "context", "key"
KEYS = frozenset({"slot_ordinal", "end_ns"})


@dataclass(frozen=True)
class Column:
    name: str
    sql: str
    description: str
    unit: str = ""  # normalized unit of a feature column (a `features.Unit` value)

    @property
    def role(self) -> str:
        if self.unit:
            return FEATURE
        return KEY if self.name in KEYS else CONTEXT


@dataclass(frozen=True)
class Table:
    """Column arrays for one table and, for nullable columns, a mask that is True for NULL."""

    values: dict[str, np.ndarray]
    nulls: dict[str, np.ndarray]

    def __len__(self) -> int:
        return len(self.values["end_ns"])
