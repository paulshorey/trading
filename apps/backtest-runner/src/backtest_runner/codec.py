"""PostgreSQL binary COPY encoding of stage tables, directly from numpy arrays.

How a value is written (its type, its NULL) determines what is stored, so this module is part
of every stage's builder identity (`ingest.CODEC_FILES`); `store.py` only orchestrates.
"""

import numpy as np
from strategy_core.columns import Column, Table

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
