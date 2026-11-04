"""PostgreSQL storage of stage rows: binary COPY, monthly partitions, the column registry.

Each stage (`strategy_core.pipeline.STAGES`) defines its table's columns and computes their
values and NULL masks; this module only writes them. Rows are encoded directly from numpy
arrays into PostgreSQL's binary COPY format.
"""

from datetime import UTC, date, datetime

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from strategy_core.columns import Column, Table
from strategy_core.market import NS
from strategy_core.pipeline import STAGES

from .codec import HEADER, TRAILER, encode

TABLES: dict[str, tuple[Column, ...]] = {s.NAME: s.COLUMNS for s in STAGES}  # one per stage


def copy_table(conn: psycopg.Connection, name: str, table: Table, contract_id: int) -> None:
    columns = TABLES[name]
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


def delete_rows(
    conn: psycopg.Connection, contract_id: int, first: int, last: int, names=tuple(TABLES)
) -> None:
    """Delete a contract's rows with index counters `first ... last` from the named tables."""
    for name in names:
        conn.execute(
            sql.SQL(
                "DELETE FROM {} WHERE contract_id = %s AND slot_ordinal BETWEEN %s AND %s"
            ).format(sql.Identifier("market", name)),
            (contract_id, first, last),
        )


def month_start(ns: int) -> date:
    d = datetime.fromtimestamp(ns // NS, UTC).date()
    return d.replace(day=1)


def next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def to_ns(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp()) * NS


def ensure_partitions(conn: psycopg.Connection, first_ns: int, last_ns: int) -> list[str]:
    """Monthly partitions (UTC) of both tables covering `end_ns` in [first_ns, last_ns]."""
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
    with conn.transaction():
        for name, columns in TABLES.items():
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
        known = Jsonb({name: [c.name for c in cols] for name, cols in TABLES.items()})
        conn.execute(
            """UPDATE market.column_registry SET status = 'deprecated'
               WHERE status = 'active'
                 AND NOT coalesce((%s::jsonb -> stage) ? name, false)""",
            (known,),
        )


def table_columns(conn: psycopg.Connection, name: str) -> dict[str, str]:
    """Stored columns (except the key and the generated phase) with their types."""
    rows = conn.execute(
        """SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'market' AND table_name = %s
             AND column_name NOT IN ('contract_id', 'phase')""",
        (name,),
    ).fetchall()
    return dict(rows)
