"""PostgreSQL storage of one-second rows: binary COPY, monthly partitions, column comments.

`strategy_core.rows` defines the columns of `market.bar_1s` and `market.candle_1m_1s` and
computes their values and NULL masks; this module only writes them. Rows are encoded
directly from numpy arrays into PostgreSQL's binary COPY format.
"""

from datetime import UTC, date, datetime

import numpy as np
import psycopg
from psycopg import sql
from strategy_core.market import NS
from strategy_core.rows import BASE_COLUMNS, CANDLE_COLUMNS, Column, SecondRows, Table

TABLES: dict[str, tuple[Column, ...]] = {
    "bar_1s": BASE_COLUMNS,
    "candle_1m_1s": CANDLE_COLUMNS,
}
TYPES = {  # PostgreSQL type: (big-endian dtype, bytes, integer limits)
    "bigint": (">i8", 8, np.iinfo(np.int64)),
    "integer": (">i4", 4, np.iinfo(np.int32)),
    "smallint": (">i2", 2, np.iinfo(np.int16)),
    "double precision": (">f8", 8, None),
}
HEADER = b"PGCOPY\n\xff\r\n\x00" + bytes(8)  # signature, flags, header extension length
TRAILER = (-1).to_bytes(2, "big", signed=True)


def encode(columns: tuple[Column, ...], table: Table, contract_id: int) -> bytes:
    """Rows in PostgreSQL binary COPY format (without header and trailer), with a leading
    constant `contract_id` column. NULL fields carry length -1 and no data."""
    n = len(table)
    layout = [("count", ">i2"), ("cid.len", ">i4"), ("cid.val", ">i8")]
    for c in columns:
        layout += [(f"{c.name}.len", ">i4"), (f"{c.name}.val", TYPES[c.sql][0])]
    rec = np.zeros(n, np.dtype(layout))
    rec["count"] = len(columns) + 1
    rec["cid.len"], rec["cid.val"] = 8, contract_id
    keep = None
    for c in columns:
        _, size, limits = TYPES[c.sql]
        values = table.values[c.name]
        null = table.nulls.get(c.name)
        if null is None:
            null = np.zeros(n, bool)
        if values.dtype.kind == "f" and c.sql != "double precision":
            raise TypeError(f"{c.name}: float values for a {c.sql} column")
        present = values[~null]
        if (
            limits is not None
            and len(present)
            and (present.min() < limits.min or present.max() > limits.max)
        ):
            raise ValueError(f"{c.name}: values outside the {c.sql} range")
        if c.sql == "double precision" and not np.isfinite(present).all():
            raise ValueError(f"{c.name}: non-finite values must be NULL")
        rec[f"{c.name}.len"] = np.where(null, -1, size)
        rec[f"{c.name}.val"] = np.where(null, 0, values)
        if null.any():
            if keep is None:
                keep = np.ones((n, rec.dtype.itemsize), bool)
            offset = rec.dtype.fields[f"{c.name}.val"][1]
            keep[null, offset : offset + size] = False
    raw = rec.view(np.uint8).reshape(n, rec.dtype.itemsize)
    return (raw[keep] if keep is not None else raw.reshape(-1)).tobytes()


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


def write_rows(conn: psycopg.Connection, contract_id: int, rows: SecondRows) -> None:
    copy_table(conn, "bar_1s", rows.base, contract_id)
    copy_table(conn, "candle_1m_1s", rows.candle, contract_id)


def delete_rows(conn: psycopg.Connection, contract_id: int, from_ordinal: int) -> None:
    """Delete a contract's rows from one index counter on (both tables)."""
    for name in TABLES:
        conn.execute(
            sql.SQL("DELETE FROM {} WHERE contract_id = %s AND slot_ordinal >= %s").format(
                sql.Identifier("market", name)
            ),
            (contract_id, from_ordinal),
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


def apply_comments(conn: psycopg.Connection) -> None:
    """Column descriptions (and units of feature columns) from the Python registry."""
    for name, columns in TABLES.items():
        for c in columns:
            text = c.description + (f" [{c.unit}]" if c.unit else "")
            conn.execute(
                sql.SQL("COMMENT ON COLUMN {}.{} IS {}").format(
                    sql.Identifier("market", name), sql.Identifier(c.name), sql.Literal(text)
                )
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
