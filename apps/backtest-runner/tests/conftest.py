import os
import sys
import time
import uuid
from pathlib import Path

import psycopg
import pytest
from backtest_runner import db
from psycopg import conninfo, sql

sys.path.insert(0, str(Path(__file__).parent))


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
    # A plain DROP stops autovacuum workers itself (FORCE would need rights over them); retry
    # while they exit, then fall back to FORCE for leftover sessions of this role.
    with psycopg.connect(admin, autocommit=True) as conn:
        for _ in range(20):
            try:
                conn.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name)))
                return
            except psycopg.errors.ObjectInUse:
                time.sleep(0.5)
        conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
