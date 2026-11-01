import os
import shutil
import uuid
from datetime import date
from pathlib import Path

import psycopg
import pytest
from backtest_runner import db
from backtest_runner.catalog import DbnFile
from psycopg import conninfo, sql


@pytest.fixture
def database():
    """A throwaway database on the configured server, dropped afterwards. Skips when the
    server is unreachable unless TRADING_REQUIRE_DB is set (CI sets it)."""
    base = conninfo.conninfo_to_dict(db.database_url())
    admin = conninfo.make_conninfo(**{**base, "dbname": "postgres"})
    name = f"trading_test_{uuid.uuid4().hex[:10]}"
    try:
        conn = psycopg.connect(admin, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as error:
        if os.environ.get("TRADING_REQUIRE_DB"):
            raise
        pytest.skip(f"PostgreSQL not reachable: {error}")
    with conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    yield conninfo.make_conninfo(**{**base, "dbname": name})
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_migrations_apply_once_and_record_checksums(database):
    with db.connect(database) as conn:
        assert [r["state"] for r in db.status(conn)] == ["pending"] * len(db.migrations())
        assert db.migrate(conn) == [f"{m.version:04d}_{m.name}" for m in db.migrations()]
        assert db.migrate(conn) == []
        assert {r["state"] for r in db.status(conn)} == {"applied"}
        schemas = {r[0] for r in conn.execute("SELECT nspname FROM pg_namespace")}
        assert {"market", "research", "ml", "meta"} <= schemas


def test_changed_applied_migration_is_refused(database, tmp_path):
    folder = tmp_path / "migrations"
    shutil.copytree(db.MIGRATIONS, folder)
    with db.connect(database) as conn:
        db.migrate(conn, folder)
        first = sorted(folder.glob("*.sql"))[0]
        first.write_text(first.read_text() + "\n-- edited after applying\n")
        assert db.status(conn, folder)[0]["state"] == "changed"
        with pytest.raises(ValueError, match="add a new migration"):
            db.migrate(conn, folder)


def test_migration_files_must_be_numbered_without_gaps(tmp_path):
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0003_c.sql").write_text("SELECT 1;")
    with pytest.raises(ValueError, match="without gaps"):
        db.migrations(tmp_path)
    (tmp_path / "bad name.sql").write_text("SELECT 1;")
    with pytest.raises(ValueError, match=r"0001_name\.sql"):
        db.migrations(tmp_path)


def test_register_files_is_idempotent(database):
    f = DbnFile(
        Path("glbx-mdp3-20260901.tbbo.dbn.zst"),
        date(2026, 9, 1),
        "JOB-1",
        "GLBX.MDP3",
        ("GC.FUT", "NQ.FUT"),
        "a" * 64,
        123,
        "available",
    )
    with db.connect(database) as conn:
        db.migrate(conn)
        db.register_files(conn, [f])
        db.register_files(conn, [f])
        rows = conn.execute("SELECT job_id, parents, condition FROM market.source_file").fetchall()
        assert rows == [("JOB-1", ["GC.FUT", "NQ.FUT"], "available")]
