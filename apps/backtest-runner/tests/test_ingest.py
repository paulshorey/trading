"""Ingestion into PostgreSQL: schema, binary COPY, planning, checkpoints, and repairs."""

from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from backtest_runner import db, ingest, store
from backtest_runner.catalog import DbnFile
from backtest_runner.source import HistoricalSource, next_front
from strategy_core.engine import MarketChunk
from strategy_core.market import NS, PRODUCTS
from strategy_core.rows import BASE_COLUMNS, FEATURE_COLUMNS, SecondRowBuilder, Table
from strategy_core.synthetic import random_trades
from test_runner import RECORD, FakeCache

GC = PRODUCTS["GC"]
Z6, G7 = ("GCZ6", 11), ("GCG7", 12)


def day_ns(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp()) * NS


def day_records(d: date, rates: dict[tuple[str, int], float], seed: int) -> np.ndarray:
    parts = []
    for k, ((_, iid), rate) in enumerate(rates.items()):
        t = random_trades(day_ns(d), day_ns(d) + 86_400 * NS, rate=rate, seed=seed * 10 + k)
        r = np.zeros(len(t), RECORD)
        r["instrument_id"], r["ts_event"], r["ts_recv"] = iid, t.ts_event, t.ts_recv
        r["action"] = b"T"
        r["side"] = np.where(t.side > 0, b"B", np.where(t.side < 0, b"A", b"N"))
        r["price"], r["size"] = t.price, t.size
        r["bid_px_00"], r["ask_px_00"] = t.bid, t.ask
        r["bid_sz_00"], r["ask_sz_00"] = t.bid_size, t.ask_size
        r["bid_ct_00"], r["ask_ct_00"] = t.bid_count, t.ask_count
        parts.append(r)
    out = np.concatenate(parts)
    return out[np.argsort(out["ts_recv"], kind="stable")]


def mappings(d: date) -> dict:
    nxt = d + timedelta(days=1)
    return {s: [{"start_date": d, "end_date": nxt, "symbol": str(i)}] for s, i in (Z6, G7)}


def dbn(d: date, sha: str = "0" * 64) -> DbnFile:
    return DbnFile(
        Path(f"/fake/{d:%Y%m%d}.tbbo.dbn.zst"),
        d,
        "job",
        "GLBX.MDP3",
        ("GC.FUT",),
        sha,
        0,
        "available",
    )


# Z6 is front until G7 trades more in the 2026-09-02 session, so G7 is front from 09-03.
DAYS = {
    date(2026, 8, 31): {Z6: 0.2, G7: 0.05},
    date(2026, 9, 1): {Z6: 0.2, G7: 0.05},
    date(2026, 9, 2): {Z6: 0.05, G7: 0.2},
    date(2026, 9, 3): {Z6: 0.05, G7: 0.2},
    date(2026, 9, 4): {Z6: 0.05, G7: 0.2},
}


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    cache = FakeCache(
        {d: (day_records(d, r, i), mappings(d)) for i, (d, r) in enumerate(DAYS.items())}
    )

    def data(last: date) -> dict[str, ingest.ProductData]:
        files = {d: dbn(d) for d in DAYS if d <= last}
        ranges = [(day_ns(date(2026, 8, 31)), day_ns(last))]  # [start, end): days before `last`
        return {"GC": ingest.ProductData(GC, files, ranges)}

    return cache, data


def test_registry_matches_the_migrated_tables(database):
    with db.connect(database) as conn:
        db.migrate(conn)
        for name, columns in store.TABLES.items():
            assert store.table_columns(conn, name) == {c.name: c.sql for c in columns}, name
            view = store.table_columns(conn, f"continuous_{name}")  # the series of each product
            assert view == {c.name: c.sql for c in columns} | {
                "product": "text",
                "trade_date": "date",
                "contract": "text",
                "roll_basis": "text",
                "rolled": "boolean",
            }, name
        store.apply_comments(conn)
        comment = conn.execute(
            "SELECT col_description('market.candle_1m_1s'::regclass, attnum) FROM pg_attribute "
            "WHERE attrelid = 'market.candle_1m_1s'::regclass AND attname = 'rsi'"
        ).fetchone()[0]
        assert "index_0_100" in comment


def test_encoding_rejects_values_that_do_not_fit():
    n = 2
    values = {
        c.name: np.zeros(n, np.float64 if c.sql == "double precision" else np.int64)
        for c in BASE_COLUMNS
    }
    values["volume"] = np.array([1, 2**31], np.int64)
    with pytest.raises(ValueError, match="volume"):
        store.encode(BASE_COLUMNS, Table(values, {}), 1)
    values["volume"] = np.array([1, 2], np.int64)
    values["pv"] = np.array([np.nan, 1.0])
    with pytest.raises(ValueError, match="pv"):
        store.encode(BASE_COLUMNS, Table(values, {}), 1)


def test_contract_months_and_forward_only_rolls():
    assert GC.contract_month("GCZ6", date(2026, 11, 1)) == date(2026, 12, 1)
    assert GC.contract_month("GCG7", date(2026, 11, 1)) == date(2027, 2, 1)
    assert GC.contract_month("GCF0", date(2029, 12, 1)) == date(2030, 1, 1)
    assert GC.contract_month("GCZ26", date(2026, 1, 5)) == date(2026, 12, 1)
    on = date(2026, 9, 1)
    assert next_front(GC, {"GCZ6": 9, "GCQ6": 5}, "GCQ6", on) == ("GCZ6", "previous_session")
    assert next_front(GC, {"GCZ6": 5, "GCQ6": 9}, "GCZ6", on) == ("GCZ6", "forward_only")
    assert next_front(GC, {"GCQ6": 1}, None, on) == ("GCQ6", "previous_session")
    assert next_front(GC, None, "GCQ6", on) == ("GCQ6", "kept")
    assert next_front(GC, None, None, on) == (None, "")


def read(conn, table: str, cid: int, columns: list[str], every: int = 1) -> dict[str, np.ndarray]:
    rows = conn.execute(
        f"SELECT {', '.join(columns)} FROM market.{table} WHERE contract_id = %s "
        "AND slot_ordinal %% %s = 0 ORDER BY slot_ordinal",
        (cid, every),
    ).fetchall()
    return {c: np.array([r[i] for r in rows], dtype=object) for i, c in enumerate(columns)}


def in_memory(cache, data, symbol: str, dates: list[date]):
    """The same contract built in one process without the database."""
    from backtest_runner.calendars import load_sessions

    calendar, _, sessions = load_sessions(GC, dates[0], dates[-1], 0)
    by_date = {s.trade_date: s for s in sessions}
    source = HistoricalSource(GC, data["GC"].files, [], [], ingest.EXECUTION, symbol, cache)
    b = SecondRowBuilder(
        calendar,
        feed_latency=ingest.EXECUTION.feed_latency,
        close_delay=ingest.EXECUTION.close_delay,
        config=ingest.FEATURES,
    )
    parts = []
    for d in dates:
        s = by_date[d]
        trades, cov, _, _ = source.session_trades(symbol, s)
        parts.append(b.process(MarketChunk(symbol, s.open, s.close, trades, cov)))
    return parts


def test_ingest_plans_builds_extends_and_repairs(database, world):
    cache, data = world
    logs = []
    options = {"url": database, "cache": cache, "log": logs.append, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)

    first = data(date(2026, 9, 4))  # sessions 09-01 .. 09-03 are downloaded
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    by = {c["contract"]: c for c in plan["contracts"]}
    assert plan["downloaded_sessions"] == 3 and plan["front_sessions"] == 3
    assert (by["GCZ6"]["first"], by["GCZ6"]["last"], by["GCZ6"]["action"]) == (
        "2026-09-01",
        "2026-09-02",
        "new",
    )
    assert (by["GCG7"]["first"], by["GCG7"]["last"]) == ("2026-09-02", "2026-09-03")  # lead 1
    assert by["GCZ6"]["rows"] == 2 * 82_800  # every scheduled second of two 23-hour sessions

    result = ingest.run(["GC"], workers=1, data=first, **options)
    assert result["status"] == "done", result
    with db.connect(database) as conn:
        rolls = conn.execute(
            "SELECT r.trade_date, c.raw_symbol, r.basis FROM market.roll r "
            "JOIN market.contract c ON c.id = r.contract_id ORDER BY 1"
        ).fetchall()
        assert [(r[1], r[2]) for r in rolls] == [
            ("GCZ6", "same_session"),
            ("GCZ6", "previous_session"),
            ("GCG7", "previous_session"),
        ]
        ids = dict(conn.execute("SELECT raw_symbol, id FROM market.contract").fetchall())
        counts = conn.execute(
            "SELECT contract_id, count(*), count(close), sum(volume) FROM market.bar_1s GROUP BY 1"
        ).fetchall()
        assert {r[0]: r[1] for r in counts} == {ids["GCZ6"]: 165_600, ids["GCG7"]: 165_600}
        candles = conn.execute("SELECT count(*) FROM market.candle_1m_1s").fetchone()[0]
        assert candles == 2 * 165_600
        slices = conn.execute("SELECT count(*), sum(row_count) FROM market.ingest_slice").fetchone()
        assert slices == (4, 4 * 82_800)
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])

    # Unchanged inputs: nothing to do
    again = ingest.run(["GC"], workers=1, data=first, **options)
    assert again["run_id"] is None
    assert {c["action"] for p in again["products"] for c in p["contracts"]} == {"current"}

    # A newly downloaded day extends the front contract from its checkpoint
    second = data(date(2026, 9, 5))
    result = ingest.run(["GC"], workers=1, data=second, **options)
    actions = {c["contract"]: c["action"] for c in result["products"][0]["contracts"]}
    assert actions == {"GCZ6": "current", "GCG7": "extend"}
    with db.connect(database) as conn:
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7", "GCG7"])
    dates = [date(2026, 9, 2), date(2026, 9, 3), date(2026, 9, 4)]
    expected = in_memory(cache, second, "GCG7", dates)
    with db.connect(database) as conn:
        cols = ["slot_ordinal", *FEATURE_COLUMNS, "close", "volume", "status"]
        got = read(conn, "candle_1m_1s", ids["GCG7"], cols, every=97)
        base = read(conn, "bar_1s", ids["GCG7"], [c.name for c in BASE_COLUMNS], every=89)
    candle = {k: np.concatenate([p.candle.values[k] for p in expected]) for k in cols}
    nulls = {
        k: np.concatenate([p.candle.nulls.get(k, np.zeros(len(p), bool)) for p in expected])
        for k in cols
    }
    at = np.searchsorted(candle["slot_ordinal"], got["slot_ordinal"].astype(np.int64))
    assert len(at) > 2000
    for k in cols:
        stored = got[k]
        is_null = np.array([v is None for v in stored])
        np.testing.assert_array_equal(is_null, nulls[k][at], err_msg=k)
        want = candle[k][at][~is_null]
        np.testing.assert_array_equal(stored[~is_null].astype(want.dtype), want, err_msg=k)
    flat = {k: np.concatenate([p.base.values[k] for p in expected]) for k in base}
    flat_null = {
        k: np.concatenate([p.base.nulls.get(k, np.zeros(len(p), bool)) for p in expected])
        for k in base
    }
    at = np.searchsorted(flat["slot_ordinal"], base["slot_ordinal"].astype(np.int64))
    for k in base:
        is_null = np.array([v is None for v in base[k]])
        np.testing.assert_array_equal(is_null, flat_null[k][at], err_msg=k)
        np.testing.assert_array_equal(
            base[k][~is_null].astype(flat[k].dtype), flat[k][at][~is_null], err_msg=k
        )

    # A re-delivered file repairs the sessions that read it, from the previous checkpoint
    changed = data(date(2026, 9, 5))
    changed["GC"].files[date(2026, 9, 2)] = dbn(date(2026, 9, 2), "1" * 64)
    plans = ingest.summarize(ingest.plan(["GC"], data=changed, **options))["products"][0]
    actions = {c["contract"]: (c["action"], c["todo"]) for c in plans["contracts"]}
    assert actions == {"GCZ6": ("repair", 1), "GCG7": ("needs_rebuild", 0)}
    result = ingest.run(["GC"], workers=1, data=changed, rebuild=True, **options)
    actions = {c["contract"]: (c["action"], c["todo"]) for c in result["products"][0]["contracts"]}
    assert actions == {"GCZ6": ("repair", 1), "GCG7": ("rebuild", 3)}
    assert result["status"] == "done"
    with db.connect(database) as conn:
        assert conn.execute("SELECT count(*) FROM market.ingest_slice").fetchone()[0] == 5
        dup = conn.execute(
            "SELECT count(*) FROM (SELECT contract_id, slot_ordinal FROM market.bar_1s "
            "GROUP BY 1, 2 HAVING count(*) > 1) d"
        ).fetchone()[0]
        assert dup == 0
        # Rows from other code are stale until rebuilt
        conn.execute("INSERT INTO market.builder (sha256, product, code_sha256, settings) "
                     "VALUES (repeat('a', 64), 'GC', 'x', '{}')")  # fmt: skip
        conn.execute("UPDATE market.ingest_slice SET builder_id = "
                     "(SELECT id FROM market.builder WHERE sha256 = repeat('a', 64))")  # fmt: skip
        conn.commit()
    plans = ingest.summarize(ingest.plan(["GC"], data=changed, **options))["products"][0]
    assert {c["action"] for c in plans["contracts"]} == {"stale"}
    status = ingest.status(database)
    assert {c["contract"] for c in status["contracts"]} == {"GCZ6", "GCG7"}
    [series] = status["continuous"]
    assert (series["product"], series["front_sessions"], series["stored_sessions"]) == ("GC", 4, 4)
    assert series["contracts"] == ["GCZ6", "GCG7"] and series["missing"] == []
    assert status["table_gigabytes"]["bar_1s"] > 0
    assert any("GCG7 2026-09-04" in line for line in logs)


def assert_continuous(conn, fronts: list[str]) -> None:
    """The product series has one row per scheduled second, each session from its front
    contract, with the index counter continuing across the roll."""
    sessions = conn.execute(
        """SELECT trade_date, contract, rolled, count(*), min(slot_ordinal), max(slot_ordinal),
                  count(DISTINCT contract_id)
           FROM market.continuous_candle_1m_1s WHERE product = 'GC' GROUP BY 1, 2, 3 ORDER BY 1"""
    ).fetchall()
    assert [s[1] for s in sessions] == fronts
    assert [s[2] for s in sessions] == [
        i == 0 or fronts[i] != fronts[i - 1] for i in range(len(fronts))
    ]
    assert all(s[3] == 82_800 and s[5] - s[4] + 1 == 82_800 and s[6] == 1 for s in sessions)
    ordinals = [
        r[0]
        for r in conn.execute(
            "SELECT slot_ordinal FROM market.continuous_bar_1s WHERE product = 'GC' ORDER BY 1"
        )
    ]
    assert len(ordinals) == len(set(ordinals)) == 82_800 * len(fronts)
    # each row equals its contract's stored row
    mismatch = conn.execute(
        """SELECT count(*) FROM market.continuous_bar_1s c
           JOIN market.bar_1s b USING (contract_id, slot_ordinal, end_ns)
           WHERE c.product = 'GC' AND (c.close, c.volume, c.session_cvd)
                 IS DISTINCT FROM (b.close, b.volume, b.session_cvd)"""
    ).fetchone()[0]
    assert mismatch == 0


def test_diff_rules():
    from backtest_runner.calendars import Session

    s = [Session(date(2026, 9, d), d, d + 1, d) for d in range(1, 6)]
    files = {x.trade_date: [{"f": x.trade_date.isoformat()}] for x in s}
    stored = [(x.trade_date, 1, files[x.trade_date]) for x in s[:3]]
    _, i, delete_from, action, _ = ingest.diff(s, s, stored, 1, files, False)
    assert (i, delete_from, action) == (3, None, "extend")
    _, i, _, action, _ = ingest.diff(s[:3], s, stored, 1, files, False)
    assert (i, action) == (3, "current")
    _, i, _, action, _ = ingest.diff(s, s, stored, 2, files, False)
    assert action == "stale"
    _, i, _, action, _ = ingest.diff(s, s, stored, 2, files, True)
    assert (i, action) == (0, "rebuild")
    changed = {**files, s[1].trade_date: [{"f": "new"}]}
    _, i, delete_from, action, _ = ingest.diff(s, s, stored, 1, changed, False)
    assert (i, delete_from, action) == (1, s[1].trade_date, "repair")
    _, _, _, action, _ = ingest.diff(s, s, stored[1:], 1, files, False)
    assert action == "needs_rebuild"  # an earlier session than the stored ones
    span, i, _, action, _ = ingest.diff(s[1:3], s, stored, 1, files, False)
    assert (len(span), i, action) == (3, 3, "current")  # keeps the earlier stored chain
    # Regression (PR #63 review): a rebuild or repair covers the whole stored chain, so a later
    # --start or an earlier --end never deletes stored sessions without rebuilding them
    span, i, delete_from, action, _ = ingest.diff(s[2:], s, stored, 2, files, True)
    assert (len(span), i, delete_from, action) == (5, 0, s[0].trade_date, "rebuild")
    span, i, delete_from, action, _ = ingest.diff(s[:2], s, stored, 1, changed, False)
    assert (len(span), i, delete_from, action) == (3, 1, s[1].trade_date, "repair")


def test_a_gap_between_downloads_is_missing_rows_and_each_range_picks_its_front(database, world):
    """Regression (PR #63 review). Two downloads with a hole between them: sessions in the hole
    are stored as rows without coverage, so a contract's index counter never jumps, and the
    first session after the hole chooses its own front instead of keeping the old one."""
    cache, _ = world
    files = {d: dbn(d) for d in DAYS if d != date(2026, 9, 2)}  # the hole: no 2026-09-02 file
    ranges = [
        (day_ns(date(2026, 8, 31)), day_ns(date(2026, 9, 2))),
        (day_ns(date(2026, 9, 3)), day_ns(date(2026, 9, 5))),
    ]
    data = {"GC": ingest.ProductData(GC, files, ranges)}
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 3}
    with db.connect(database) as conn:
        db.migrate(conn)
    plans = ingest.plan(["GC", "GC"], data=data, **options)  # a repeated product is planned once
    assert len(plans) == 1 and plans[0]["downloaded_sessions"] == 2  # 09-01 and 09-04
    result = ingest.run(["GC", "GC"], workers=1, data=data, **options)
    assert result["status"] == "done", result
    with db.connect(database) as conn:
        rolls = conn.execute(
            "SELECT r.trade_date, c.raw_symbol, r.basis FROM market.roll r "
            "JOIN market.contract c ON c.id = r.contract_id ORDER BY 1"
        ).fetchall()
        assert rolls == [
            (date(2026, 9, 1), "GCZ6", "same_session"),
            (date(2026, 9, 4), "GCG7", "same_session"),  # not GCZ6 kept across the hole
        ]
        slices = conn.execute(
            """SELECT s.trade_date, s.first_ordinal, s.last_ordinal, s.missing
               FROM market.ingest_slice s JOIN market.contract c ON c.id = s.contract_id
               WHERE c.raw_symbol = 'GCG7' ORDER BY 1"""
        ).fetchall()
        assert [x[0] for x in slices] == [date(2026, 9, d) for d in (1, 2, 3, 4)]
        assert all(b[1] == a[2] + 1 for a, b in pairwise(slices))  # no index jump
        # 09-02 is covered only from its 22:00 UTC open to midnight; 09-03 lacks its first 2 hours
        assert [x[3] for x in slices] == [0, 75_600, 7_200, 0]
        fronts = conn.execute(
            "SELECT trade_date, contract, count(*) FROM market.continuous_bar_1s "
            "GROUP BY 1, 2 ORDER BY 1"
        ).fetchall()
        assert fronts == [(date(2026, 9, 1), "GCZ6", 82_800), (date(2026, 9, 4), "GCG7", 82_800)]


def test_cached_scans_and_stored_rows_follow_the_code_that_made_them(database, world, monkeypatch):
    """Regression (PR #63 review): cached session volumes are reused only while the code and
    settings that computed them are unchanged, and the builder version covers the ingestion
    code that selects, feeds, and writes rows."""
    cache, data = world
    logs = []
    options = {"url": database, "cache": cache, "log": logs.append, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))

    def scans() -> list[str]:
        logs.clear()
        ingest.plan(["GC"], data=first, **options)
        return [line for line in logs if "scanned volumes" in line]

    assert scans() == ["GC: scanned volumes of 3/3 sessions"]
    assert scans() == []  # unchanged files and code: reused
    # Regression (PR #63 review): a calendar package upgrade can move session hours
    real = ingest.version
    monkeypatch.setattr(
        ingest, "version", lambda p: "99.0" if p == "pandas_market_calendars" else real(p)
    )
    assert scans() == ["GC: scanned volumes of 3/3 sessions"]
    assert scans() == []
    with db.connect(database) as conn:  # a session scanned over other hours is read again
        conn.execute(
            "UPDATE market.session_scan SET close_ns = close_ns - 60000000000 "
            "WHERE trade_date = '2026-09-02'"
        )
        conn.commit()
    assert scans() == ["GC: scanned volumes of 1/1 sessions"]
    monkeypatch.setattr(ingest, "scan_identity", lambda: "f" * 64)
    assert scans() == ["GC: scanned volumes of 3/3 sessions"]  # other code: scanned again
    with db.connect(database) as conn:
        assert conn.execute("SELECT DISTINCT scan_sha256 FROM market.session_scan").fetchall() == [
            ("f" * 64,)
        ]
    for name in ("ingest", "store", "catalog", "source", "calendars"):
        assert f"apps/backtest-runner/src/backtest_runner/{name}.py" in ingest.BUILDER_FILES
    for name in ("ingest", "catalog", "source", "calendars"):  # scans are versioned the same way
        assert f"apps/backtest-runner/src/backtest_runner/{name}.py" in ingest.SCAN_FILES
    assert all((ingest.ROOT / rel).is_file() for rel in ingest.BUILDER_FILES + ingest.SCAN_FILES)
