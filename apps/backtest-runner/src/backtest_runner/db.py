"""PostgreSQL connection and schema migrations.

The database URL comes from `TRADING_DATABASE_URL`, defaulting to the local
Homebrew PostgreSQL database set up for this project. Migrations are numbered SQL
files in `lib/db-research/migrations/` (`0001_name.sql`), applied once each, in
order, inside a transaction. An applied migration must never change; add a new one.
"""

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg

from .catalog import ROOT, DbnFile

DEFAULT_URL = "postgresql://trading@127.0.0.1:5432/trading"
MIGRATIONS = ROOT / "lib/db-research/migrations"
NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


def database_url() -> str:
    return os.environ.get("TRADING_DATABASE_URL", DEFAULT_URL)


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(url or database_url(), application_name="trading-research")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text()

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()


def migrations(folder: Path = MIGRATIONS) -> list[Migration]:
    found = []
    for path in sorted(folder.glob("*.sql")):
        match = NAME.match(path.name)
        if not match:
            raise ValueError(f"Migration file names must look like 0001_name.sql: {path.name}")
        found.append(Migration(int(match.group(1)), match.group(2), path))
    versions = [m.version for m in found]
    if versions != list(range(1, len(found) + 1)):
        raise ValueError(f"Migration versions must be 1..n without gaps: {versions}")
    return found


BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS meta;
CREATE TABLE IF NOT EXISTS meta.schema_migration (
    version integer PRIMARY KEY,
    name text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
"""


def status(conn: psycopg.Connection, folder: Path = MIGRATIONS) -> list[dict]:
    """Every migration file with its state: applied, pending, or changed after applying."""
    conn.execute(BOOTSTRAP)
    applied = {
        v: (name, sha, at)
        for v, name, sha, at in conn.execute(
            "SELECT version, name, sha256, applied_at FROM meta.schema_migration"
        )
    }
    conn.commit()
    out = []
    for m in migrations(folder):
        row = applied.pop(m.version, None)
        state = "pending" if row is None else "applied" if row[1] == m.sha256 else "changed"
        out.append(
            {
                "version": m.version,
                "name": m.name,
                "state": state,
                "applied_at": row[2].isoformat() if row else None,
            }
        )
    for version, (name, _, at) in sorted(applied.items()):
        out.append(
            {
                "version": version,
                "name": name,
                "state": "missing_file",
                "applied_at": at.isoformat(),
            }
        )
    return out


# Migrations folded into 0001_baseline on November 4, 2026. A database that applied them holds
# only derived rows; it is rebuilt from the DBN files, never upgraded in place.
FOLDED = {(1, "foundation"), (2, "second_rows"), (3, "side_bridges"), (4, "stages")}


def migrate(conn: psycopg.Connection, folder: Path = MIGRATIONS) -> list[str]:
    """Apply pending migrations in order. Refuses to run if an applied file changed."""
    current = status(conn, folder)
    recorded = set(conn.execute("SELECT version, name FROM meta.schema_migration").fetchall())
    if recorded & FOLDED:  # the recorded names, which differ from the current files
        raise ValueError(
            "This database predates the baseline schema: migrations 0001-0004 were folded into "
            "0001_baseline on 2026-11-04. Its rows are all derived from the DBN files: rebuild it "
            "as described in lib/db-research/README.md (Migrations), with Paul's approval."
        )
    bad = [
        f"{r['version']:04d}_{r['name']} ({r['state']})"
        for r in current
        if r["state"] in ("changed", "missing_file")
    ]
    if bad:
        raise ValueError(f"Applied migrations differ from the files; add a new migration: {bad}")
    done = []
    by_version = {m.version: m for m in migrations(folder)}
    for r in current:
        if r["state"] != "pending":
            continue
        m = by_version[r["version"]]
        with conn.transaction():
            conn.execute(m.sql)
            conn.execute(
                "INSERT INTO meta.schema_migration (version, name, sha256) VALUES (%s, %s, %s)",
                (m.version, m.name, m.sha256),
            )
        done.append(f"{m.version:04d}_{m.name}")
    return done


def register_files(conn: psycopg.Connection, files: list[DbnFile]) -> int:
    """Record downloaded Databento files in `market.source_file` (idempotent)."""
    with conn.transaction():
        for f in files:
            conn.execute(
                """INSERT INTO market.source_file (dataset, schema_name, job_id, file_name,
                       utc_date, parents, byte_count, sha256, condition)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (job_id, file_name) DO UPDATE SET condition = EXCLUDED.condition""",
                (
                    f.dataset,
                    f.schema,
                    f.job_id,
                    f.path.name,
                    f.date,
                    list(f.parents),
                    f.size,
                    f.sha256,
                    f.condition,
                ),
            )
    return len(files)
