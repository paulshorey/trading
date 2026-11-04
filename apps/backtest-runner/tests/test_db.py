import shutil
from datetime import date
from pathlib import Path

import pytest
from backtest_runner import db
from backtest_runner.catalog import DbnFile


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


def test_a_database_from_before_the_baseline_is_refused_with_its_remedy(database):
    """Migrations 0001-0004 were folded into 0001_baseline: a database that applied them is
    rebuilt, never upgraded, and migrate says so instead of reporting changed files."""
    with db.connect(database) as conn:
        db.status(conn)  # creates meta.schema_migration
        conn.execute(  # only the first folded migration: version 1 under its old name
            "INSERT INTO meta.schema_migration (version, name, sha256) VALUES "
            "(1, 'foundation', repeat('0', 64))"
        )
        conn.commit()
        with pytest.raises(ValueError, match="folded into 0001_baseline"):
            db.migrate(conn)
