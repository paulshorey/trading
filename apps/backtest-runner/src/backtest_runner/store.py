"""PostgreSQL storage of stage rows: binary COPY, monthly partitions, the column registry.

Each stage (`strategy_core.pipeline.STAGES`) defines its table's columns and computes their
values and NULL masks; this module only writes them. Rows are encoded directly from numpy
arrays into PostgreSQL's binary COPY format.
"""

from datetime import UTC, date, datetime

import numpy as np
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from strategy_core.columns import BIGINT, SMALLINT, Column, Table
from strategy_core.market import NS
from strategy_core.pipeline import BY_NAME, STAGES

from .codec import HEADER, TRAILER, encode

STAGE_TABLE = {s.NAME: getattr(s, "TABLE", s.NAME) for s in STAGES}  # variants share a table
TABLES: dict[str, tuple[Column, ...]] = {STAGE_TABLE[s.NAME]: s.COLUMNS for s in STAGES}
# Sparse tables of events that stages emit next to their rows (`products["events"]`)
EVENT_TABLES: dict[str, tuple[Column, ...]] = {
    s.EVENTS: s.EVENT_COLUMNS for s in STAGES if hasattr(s, "EVENTS")
}
STAGE_EVENTS = {s.NAME: s.EVENTS for s in STAGES if hasattr(s, "EVENTS")}
# Seconds per row of each table: its `slot_ordinal` counts rows of this many seconds
SLOT_SECONDS = {STAGE_TABLE[s.NAME]: {"1s": 1, "1m": 60}[s.RESOLUTION] for s in STAGES}
VARIANT = Column("variant_id", SMALLINT, "The variant (a swing scale): market.variant.id")
BUILDER = Column("builder_id", BIGINT, "The builder that wrote the row: market.builder.id")


def copy_table(
    conn: psycopg.Connection,
    name: str,
    table: Table,
    contract_id: int,
    *,
    variant_id: int | None = None,
    builder_id: int | None = None,
) -> None:
    """Copy a stage's rows into its table, or its events into their table. A variant's rows
    carry its `variant_id`; events also carry the builder that wrote them."""
    columns = TABLES[name] if name in TABLES else EVENT_TABLES[name]
    for column, value in ((VARIANT, variant_id), (BUILDER, builder_id)):
        if value is not None:
            columns = (column, *columns)
            constant = np.full(len(table), value, np.int64)
            table = Table(table.values | {column.name: constant}, table.nulls)
    target = sql.SQL("COPY {} ({}) FROM STDIN (FORMAT BINARY)").format(
        sql.Identifier("market", name),
        sql.SQL(", ").join(sql.Identifier(x) for x in ["contract_id", *(c.name for c in columns)]),
    )
    body = encode(columns, table, contract_id)
    with conn.cursor().copy(target) as copy:
        copy.write(HEADER)
        for i in range(0, len(body), 1 << 24):
            copy.write(body[i : i + (1 << 24)])
        copy.write(TRAILER)


def row_bounds(name: str, first: int, last: int) -> tuple[int, int]:
    """Index counters in table `name` of the rows inside seconds `first ... last` (second
    ordinals). Sessions are whole minutes, so minute `m` (seconds 60m - 59 ... 60m) lies inside
    them exactly when `(first + 59) // 60 <= m <= last // 60`."""
    k = SLOT_SECONDS[name]
    return -(-first // k), last // k


def delete_rows(
    conn: psycopg.Connection,
    contract_id: int,
    first: int,
    last: int,
    names=tuple(STAGE_TABLE),
    variants: dict[str, int] | None = None,
) -> None:
    """Delete a contract's rows inside seconds `first ... last` (second ordinals) of the named
    stages, each at its table's resolution (`row_bounds`). A variant's stage (`variants`: its
    id) deletes only its own rows and events, never another variant's."""
    for stage in names:
        name = STAGE_TABLE[stage]
        lo, hi = row_bounds(name, first, last)
        variant = (variants or {}).get(stage, 0)
        if hasattr(BY_NAME[stage], "VARIANT") and not variant:
            raise ValueError(f"{stage} needs its variant id")
        scope = sql.SQL(" AND variant_id = {}").format(sql.Literal(variant)) if variant else None
        for target in (name, STAGE_EVENTS.get(stage)):
            if target is None:
                continue
            conn.execute(
                sql.SQL(
                    "DELETE FROM {} WHERE contract_id = %s AND slot_ordinal BETWEEN %s AND %s{}"
                ).format(sql.Identifier("market", target), scope or sql.SQL("")),
                (contract_id, lo, hi),
            )


def register_variants(conn: psycopg.Connection, settings: dict[str, dict]) -> dict[str, int]:
    """Every stage's variant id (0 without variants), registering new variants with their
    parameters (`settings`: each stage's) in `market.variant`.

    A variant's name never changes meaning: its parameters are fixed when it is registered, so
    stored rows are never read under other parameters than they were built with. A stage whose
    settings differ from its registered variant is refused; give the changed variant a new name
    (it is then added next to the old one). Variants that no stage defines are marked retired:
    their rows are kept, the planner ignores them, and the continuous views leave them out."""
    out = {}
    with conn.transaction():
        for s in STAGES:
            if not hasattr(s, "VARIANT"):
                out[s.NAME] = 0
                continue
            key = (STAGE_TABLE[s.NAME], s.VARIANT)
            conn.execute(
                """INSERT INTO market.variant (stage, name, params) VALUES (%s, %s, %s)
                   ON CONFLICT (stage, name) DO NOTHING""",
                (*key, Jsonb(settings[s.NAME])),
            )
            vid, params = conn.execute(
                "SELECT id, params FROM market.variant WHERE stage = %s AND name = %s", key
            ).fetchone()
            if params != settings[s.NAME]:
                changed = sorted(
                    k for k in params.keys() | settings[s.NAME].keys()
                    if params.get(k) != settings[s.NAME].get(k)
                )  # fmt: skip
                raise ValueError(
                    f"{s.NAME} is registered with other parameters ({', '.join(changed)}); a "
                    "variant's name never changes meaning: give the changed variant a new name"
                )
            out[s.NAME] = int(vid)
        active = [v for v in out.values() if v]
        conn.execute(
            """UPDATE market.variant
               SET retired_at = CASE WHEN id = ANY(%s) THEN NULL ELSE now() END
               WHERE (id = ANY(%s)) <> (retired_at IS NULL)""",
            (active, active),
        )
    return out


def month_start(ns: int) -> date:
    d = datetime.fromtimestamp(ns // NS, UTC).date()
    return d.replace(day=1)


def next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def to_ns(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp()) * NS


def ensure_partitions(conn: psycopg.Connection, first_ns: int, last_ns: int) -> list[str]:
    """Monthly partitions (UTC) of every stage table covering `end_ns` in [first_ns, last_ns]."""
    created, month = [], month_start(first_ns)
    while to_ns(month) <= last_ns:
        nxt = next_month(month)
        for name in TABLES:
            part = f"{name}_{month:%Y_%m}"
            exists = conn.execute("SELECT to_regclass(%s)", (f"market.{part}",)).fetchone()[0]
            if exists is None:
                conn.execute(  # DDL takes no bind parameters: the bounds are literals
                    sql.SQL("CREATE TABLE {} PARTITION OF {} FOR VALUES FROM ({}) TO ({})").format(
                        sql.Identifier("market", part),
                        sql.Identifier("market", name),
                        sql.Literal(to_ns(month)),
                        sql.Literal(to_ns(nxt)),
                    )
                )
                created.append(part)
        month = nxt
    return created


def apply_registry(conn: psycopg.Connection) -> None:
    """The column registry of every stage into `market.column_registry` (role, unit, type,
    description), and the descriptions into PostgreSQL column comments. Registered columns that
    no stage defines any more are marked `deprecated`, never deleted."""
    registered = TABLES | EVENT_TABLES
    with conn.transaction():
        for name, columns in registered.items():
            for c in columns:
                text = c.description + (f" [{c.unit}]" if c.unit else "")
                conn.execute(
                    sql.SQL("COMMENT ON COLUMN {}.{} IS {}").format(
                        sql.Identifier("market", name), sql.Identifier(c.name), sql.Literal(text)
                    )
                )
                conn.execute(
                    """INSERT INTO market.column_registry (stage, name, role, unit, sql_type,
                           description, status) VALUES (%s, %s, %s, %s, %s, %s, 'active')
                       ON CONFLICT (stage, name) DO UPDATE SET role = EXCLUDED.role,
                           unit = EXCLUDED.unit, sql_type = EXCLUDED.sql_type,
                           description = EXCLUDED.description, status = 'active'""",
                    (name, c.name, c.role, c.unit or None, c.sql, c.description),
                )
        known = Jsonb({name: [c.name for c in cols] for name, cols in registered.items()})
        conn.execute(
            """UPDATE market.column_registry SET status = 'deprecated'
               WHERE status = 'active'
                 AND NOT coalesce((%s::jsonb -> stage) ? name, false)""",
            (known,),
        )


def table_columns(conn: psycopg.Connection, name: str) -> dict[str, str]:
    """Stored columns with their types, except those no stage registry holds: the contract,
    the generated phase, and what ingestion adds (a variant's id, an event's builder)."""
    rows = conn.execute(
        """SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'market' AND table_name = %s
             AND column_name NOT IN ('contract_id', 'phase', 'variant_id', 'builder_id')""",
        (name,),
    ).fetchall()
    return dict(rows)
