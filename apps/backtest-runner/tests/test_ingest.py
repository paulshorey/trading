"""Ingestion into PostgreSQL: schema, binary COPY, planning, checkpoints, and repairs."""

import dataclasses
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from backtest_runner import db, ingest, service, store
from backtest_runner.catalog import DbnFile
from backtest_runner.source import DayCache, HistoricalSource, next_front
from strategy_core.columns import Table
from strategy_core.engine import MarketChunk
from strategy_core.market import NS, PRODUCTS
from strategy_core.pipeline import SPARSE, STEP_STAGES, Pipeline, stored_ordinals, stored_rows
from strategy_core.stage_bar_1s import COLUMNS as BASE_COLUMNS
from strategy_core.stage_candle_1m_1s import FEATURE_COLUMNS
from strategy_core.stage_pivot_1s import COLUMNS as PIVOT_COLUMNS
from strategy_core.stage_pivot_1s import SCALES as FAST_SCALES
from strategy_core.stage_pivot_label import COLUMNS as LABEL_COLUMNS
from strategy_core.stage_pivot_label import FAST_LABELS, MIDDLE_LABELS, SLOW_LABELS
from strategy_core.stage_step_bar import COLUMNS as MINUTE_COLUMNS
from strategy_core.stage_step_candle import HourCandleStage
from strategy_core.stage_step_pivot import MIDDLE_SCALES, PivotMiddleStage, PivotMinuteStage
from strategy_core.stage_step_pivot import SCALES as SLOW_SCALES
from strategy_core.stage_step_stats import COLUMNS as STATS_COLUMNS
from strategy_core.stage_step_stats import HourStatsStage
from strategy_core.stage_step_vol import COLUMNS as VOL_COLUMNS
from strategy_core.stage_step_vol import VolMinuteStage
from strategy_core.stage_vol_1s import COLUMNS as VOL_SECOND_COLUMNS
from strategy_core.stage_vol_1s import VolSecondStage
from strategy_core.swings import EVENT_COLUMNS
from strategy_core.synthetic import random_trades
from strategy_core.timeframes import MIDDLE
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
        Path(f"/fake/{d:%Y%m%d}.mbp-1.dbn.zst"),
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
    # The world has five sessions, fewer than the hourly and volatility stages' warm-ups (about
    # 10, 5, 37, and 37 sessions: test_stages checks them; 5 for the slow swing scales' hourly
    # ATR), so planning tests use one-hour stand-ins.
    monkeypatch.setattr(HourCandleStage, "warmup", lambda self: 3600)
    monkeypatch.setattr(HourStatsStage, "warmup", lambda self: 3600)
    monkeypatch.setattr(VolMinuteStage, "warmup", lambda self: 3600)
    monkeypatch.setattr(VolSecondStage, "warmup", lambda self: 3600)
    monkeypatch.setattr(PivotMinuteStage, "warmup", lambda self: 3600)
    for stage in (*STEP_STAGES[MIDDLE.name][1:], PivotMiddleStage):  # the middle timeframe's
        monkeypatch.setattr(stage, "warmup", lambda self: 3600)
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
        conn.execute(
            "INSERT INTO market.column_registry (stage, name, role, sql_type, description, "
            "status) VALUES ('bar_1s', 'retired', 'context', 'bigint', 'gone', 'active')"
        )
        store.apply_registry(conn)
        comment = conn.execute(
            "SELECT col_description('market.candle_1m_1s'::regclass, attnum) FROM pg_attribute "
            "WHERE attrelid = 'market.candle_1m_1s'::regclass AND attname = 'rsi'"
        ).fetchone()[0]
        assert "index_0_100" in comment
        # The column registry holds every stored column with its role; features carry units
        registry = {
            (stage, name): (role, unit, sql_type, status)
            for stage, name, role, unit, sql_type, status in conn.execute(
                "SELECT stage, name, role, unit, sql_type, status FROM market.column_registry"
            )
        }
        want = {
            (stage, c.name): (c.role, c.unit or None, c.sql, "active")
            for stage, columns in (store.TABLES | store.EVENT_TABLES).items()
            for c in columns
        }
        # swing scales share a table per resolution and one event table; ingestion adds the keys
        assert store.EVENT_TABLES == {"pivot_event": EVENT_COLUMNS}
        assert store.table_columns(conn, "pivot_event") == {c.name: c.sql for c in EVENT_COLUMNS}
        assert {"pivot_1s", "pivot_1m"} <= set(store.TABLES)
        assert registry[("pivot_1s", "progress")][:2] == ("feature", "ratio")
        assert registry[("pivot_1s", "ext_px")][0] == "context"  # a raw level is never a feature
        assert registry[("pivot_event", "level")][0] == "context"
        assert {k: v for k, v in registry.items() if v[3] == "active"} == want
        assert registry[("bar_1s", "retired")][3] == "deprecated"  # never deleted
        assert registry[("candle_1m_1s", "rsi")][:2] == ("feature", "index_0_100")
        assert registry[("bar_1s", "close")][0] == "context"  # raw prices are never features
        assert registry[("bar_1s", "slot_ordinal")][0] == "key"


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
    b = Pipeline(
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
    with db.connect(database) as conn:  # planning publishes nothing to the continuous series
        assert conn.execute("SELECT count(*) FROM market.roll").fetchone()[0] == 0

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
        candles = conn.execute(
            "SELECT (SELECT count(*) FROM market.candle_1m_1s), "
            "(SELECT count(*) FROM market.vol_1s)"
        ).fetchone()
        assert candles == (2 * 165_600,) * 2  # one row per scheduled second, per contract
        minutes = conn.execute(
            "SELECT (SELECT count(*) FROM market.bar_1m), "
            "(SELECT count(*) FROM market.candle_1h_1m), "
            "(SELECT count(*) FROM market.stats_1h_1m), (SELECT count(*) FROM market.vol_1m)"
        ).fetchone()
        assert minutes == (4 * 1380,) * 4  # one row per scheduled minute, per contract
        slices = conn.execute("SELECT count(*), sum(row_count) FROM market.ingest_slice").fetchone()
        assert slices == (4, 4 * 82_800)
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
        # Regression (PR #63 review): a front without stored rows is not published; the
        # session keeps its readable entry
        [now] = ingest.plan(["GC"], data=first, **options)
        current = (now["builders"], now["expected"], now["variants"])
        schedule = {date(2026, 9, 1): ("GCG7", "previous_session")}
        assert ingest.publish_rolls(conn, GC, schedule, *current) == 0
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
        # Regression (PR #63 review): stale rows (another builder) are never published
        other = conn.execute(
            "INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
            "VALUES (repeat('c', 64), 'GC', 'x', '{}', 'source') RETURNING id"
        ).fetchone()[0]
        where = "WHERE trade_date = '2026-09-03'"
        conn.execute(f"UPDATE market.ingest_slice SET builder_id = %s {where}", (other,))
        assert ingest.publish_rolls(conn, GC, {date(2026, 9, 3): ("GCG7", "kept")}, *current) == 0
        conn.execute(
            f"UPDATE market.ingest_slice SET builder_id = %s {where}", (current[0]["source"],)
        )
        conn.commit()

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
    candle = {
        k: np.concatenate([p.tables["candle_1m_1s"].values[k] for p in expected]) for k in cols
    }
    nulls = {
        k: np.concatenate(
            [p.tables["candle_1m_1s"].nulls.get(k, np.zeros(len(p), bool)) for p in expected]
        )
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
    flat = {k: np.concatenate([p.tables["bar_1s"].values[k] for p in expected]) for k in base}
    flat_null = {
        k: np.concatenate(
            [p.tables["bar_1s"].nulls.get(k, np.zeros(len(p), bool)) for p in expected]
        )
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
        conn.execute("INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
                     "VALUES (repeat('a', 64), 'GC', 'x', '{}', 'source')")  # fmt: skip
        conn.execute("UPDATE market.ingest_slice SET builder_id = "
                     "(SELECT id FROM market.builder WHERE sha256 = repeat('a', 64))")  # fmt: skip
        conn.commit()
    plans = ingest.summarize(ingest.plan(["GC"], data=changed, **options))["products"][0]
    assert {c["action"] for c in plans["contracts"]} == {"stale"}
    status = ingest.status(database)
    assert {(c["contract"], c["delivery"]) for c in status["contracts"]} == {
        ("GCZ6", "2026-12"),
        ("GCG7", "2027-02"),
    }
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
    # the minute series reads the same sessions: whole minutes inside each session's seconds
    minutes = conn.execute(
        """SELECT trade_date, contract, count(*), min(slot_ordinal), max(slot_ordinal)
           FROM market.continuous_candle_1h_1m WHERE product = 'GC' GROUP BY 1, 2 ORDER BY 1"""
    ).fetchall()
    assert [m[:2] for m in minutes] == [s[:2] for s in sessions]
    for m, s in zip(minutes, sessions, strict=True):
        assert m[2] == 1380 and (m[3], m[4]) == ((s[4] + 59) // 60, s[5] // 60)
    bars = conn.execute(
        "SELECT count(*), count(DISTINCT slot_ordinal) FROM market.continuous_bar_1m "
        "WHERE product = 'GC'"
    ).fetchone()
    assert bars == (1380 * len(fronts), 1380 * len(fronts))


def test_minute_bounds_follow_the_session_seconds():
    """Sessions are whole minutes: seconds 61 ... 180 hold minutes 2 and 3."""
    assert store.row_bounds("bar_1s", 61, 180) == (61, 180)
    assert store.row_bounds("bar_1m", 61, 180) == (2, 3)
    assert store.row_bounds("candle_1h_1m", 61, 180) == (2, 3)
    assert store.row_bounds("stats_1h_1m", 61, 180) == (2, 3)
    assert store.row_bounds("vol_1m", 61, 180) == (2, 3)
    assert store.row_bounds("vol_1s", 61, 180) == (61, 180)
    assert store.row_bounds("pivot_1m", 61, 180) == (2, 3)
    assert store.row_bounds("pivot_1s", 61, 180) == (61, 180)
    assert store.row_bounds("pivot_label_1m", 61, 180) == (2, 3)
    for table in ("bar_10s", "candle_10m_10s", "stats_10m_10s", "vol_10s", "pivot_10s"):
        assert store.row_bounds(table, 61, 180) == (7, 18)  # seconds 61 ... 70 are row 7
    assert store.SLOT_SECONDS == {
        "bar_1s": 1,
        "bar_1m": 60,
        "candle_1m_1s": 1,
        "candle_1h_1m": 60,
        "stats_1h_1m": 60,
        "vol_1m": 60,
        "vol_1s": 1,
        "pivot_1m": 60,  # one table for the slow swing scales, one for the fast
        "pivot_1s": 1,
        "pivot_label_1m": 60,  # labels are keyed by their decision row, of the scale's stream
        "bar_10s": 10,  # the middle timeframe: six rows a minute
        "candle_10m_10s": 10,
        "stats_10m_10s": 10,
        "vol_10s": 10,
        "pivot_10s": 10,
        "pivot_label_10s": 10,
        "pivot_label_1s": 1,
    }


def test_spans_keep_each_delivery_of_a_repeated_symbol_apart():
    """Regression (PR #63 review): one-digit-year symbols repeat each decade, so GCZ6 traded in
    2016 and in 2026 are two contracts, with two spans, also for an explicit --contract."""
    from backtest_runner.calendars import Session

    days = [date(2016, 11, d) for d in (1, 2, 3)] + [date(2026, 11, d) for d in (2, 3, 4)]
    period = [Session(d, i, i + 1, i) for i, d in enumerate(days)]
    front = {d: "GCZ6" for d in days}
    out = ingest.spans(GC, period, front, {}, contract=None, start=None, end=None, lead=1)
    assert {k: [s.trade_date for s in v] for k, v in out.items()} == {
        ("GCZ6", date(2016, 12, 1)): days[:3],
        ("GCZ6", date(2026, 12, 1)): days[2:],  # one lead session, then its own
    }
    volumes = {d: {"GCZ6": 5} for d in days}
    out = ingest.spans(GC, period, {}, volumes, contract="GCZ6", start=None, end=None, lead=1)
    assert {k: len(v) for k, v in out.items()} == {
        ("GCZ6", date(2016, 12, 1)): 3,
        ("GCZ6", date(2026, 12, 1)): 3,
    }


def stored_of(rows, stages=None) -> ingest.Stored:
    """Stored sessions [(date, builder, files)]: the source and, unless `stages` says otherwise
    ({stage: {date: builder}}), every stage built by the same builder."""
    source = {d: (b, f) for d, b, f in rows}
    if stages is None:
        stages = {n: {d: b for d, b, _ in rows} for n in NAMES}
    return ingest.Stored(source, stages)


NAMES = [cls.NAME for cls in ingest.STAGES]
SWINGS = [s.NAME for s in (*MIDDLE_SCALES, *SLOW_SCALES, *FAST_SCALES)]  # each scale is a stage


def without(*stored: str) -> str:
    """The plan's reason when only `stored` stages have rows."""
    return "stages without stored rows: " + ", ".join(sorted(set(NAMES) - set(stored)))


def builders(b: int, **stage) -> dict[str, int]:
    return {"source": b, **{n: stage.get(n, b) for n in NAMES}}


def test_diff_rules():
    from backtest_runner.calendars import Session

    s = [Session(date(2026, 9, d), d, d + 1, d) for d in range(1, 6)]
    files = {x.trade_date: [{"f": x.trade_date.isoformat()}] for x in s}
    rows = [(x.trade_date, 1, files[x.trade_date]) for x in s[:3]]
    stored = stored_of(rows)
    _, i, delete_from, action, _ = ingest.diff(s, s, stored, builders(1), files, False)
    assert (i, delete_from, action) == (3, None, "extend")
    _, i, _, action, _ = ingest.diff(s[:3], s, stored, builders(1), files, False)
    assert (i, action) == (3, "current")
    _, i, _, action, _ = ingest.diff(s, s, stored, builders(2), files, False)
    assert action == "stale"
    _, i, _, action, _ = ingest.diff(s, s, stored, builders(2), files, True)
    assert (i, action) == (0, "rebuild")
    changed = {**files, s[1].trade_date: [{"f": "new"}]}
    _, i, delete_from, action, _ = ingest.diff(s, s, stored, builders(1), changed, False)
    assert (i, delete_from, action) == (1, s[1].trade_date, "repair")
    _, _, _, action, _ = ingest.diff(s, s, stored_of(rows[1:]), builders(1), files, False)
    assert action == "needs_rebuild"  # an earlier session than the stored ones
    span, i, _, action, _ = ingest.diff(s[1:3], s, stored, builders(1), files, False)
    assert (len(span), i, action) == (3, 3, "current")  # keeps the earlier stored chain
    # Regression (PR #63 review): a rebuild or repair covers the whole stored chain, so a later
    # --start or an earlier --end never deletes stored sessions without rebuilding them
    span, i, delete_from, action, _ = ingest.diff(s[2:], s, stored, builders(2), files, True)
    assert (len(span), i, delete_from, action) == (5, 0, s[0].trade_date, "rebuild")
    span, i, delete_from, action, _ = ingest.diff(s[:2], s, stored, builders(1), changed, False)
    assert (len(span), i, delete_from, action) == (3, 1, s[1].trade_date, "repair")
    # Regression (PR #63 review): an interrupted rebuild resumes after its current prefix
    mixed = stored_of([(x.trade_date, 2 if k < 2 else 1, files[x.trade_date])
                       for k, x in enumerate(s[:4])])  # fmt: skip
    _, i, delete_from, action, _ = ingest.diff(s, s, mixed, builders(2), files, True)
    assert (i, delete_from, action) == (2, s[2].trade_date, "rebuild")
    _, _, _, action, _ = ingest.diff(s, s, mixed, builders(2), files, False)
    assert action == "stale"
    # Stages are versioned on their own: changed candle code leaves the source and bar_1s
    # current, but the candle rows are stale until rebuilt
    new_candles = builders(1, candle_1m_1s=9)
    _, i, _, action, _ = ingest.diff(s[:3], s, stored, new_candles, files, False)
    assert (i, action) == (3, "stale")  # nothing runs without --rebuild
    _, i, delete_from, action, _ = ingest.diff(s[:3], s, stored, new_candles, files, True)
    assert (i, delete_from, action) == (0, s[0].trade_date, "rebuild")
    # A stage without stored rows (a new stage) is added without --rebuild, from the start
    only_bar = stored_of(rows, {"bar_1s": {d: 1 for d, _, _ in rows}})
    _, i, delete_from, action, why = ingest.diff(s[:3], s, only_bar, builders(1), files, False)
    assert (i, delete_from, action) == (0, None, "add") and "candle_1m_1s" in why
    # ... as the minute stages were added next to the stored second stages
    seconds = {n: {d: 1 for d, _, _ in rows} for n in ("bar_1s", "candle_1m_1s")}
    added = stored_of(rows, seconds)
    _, i, _, action, why = ingest.diff(s[:3], s, added, builders(1), files, False)
    assert (i, action, why) == (0, "add", without("bar_1s", "candle_1m_1s"))
    assert "bar_10s, bar_1m, candle_10m_10s" in why and "pivot_1m:slow_atr_0p5" in why
    # ... the hourly statistics next to the stages before them (PR B2)
    later = ("stats_1h_1m", "vol_1m", "vol_1s", *SWINGS)
    before_b2 = {n: {d: 1 for d, _, _ in rows} for n in NAMES if n not in later}
    _, i, _, action, why = ingest.diff(s[:3], s, stored_of(rows, before_b2), builders(1),
                                       files, False)  # fmt: skip
    assert (i, action, why) == (0, "add", without(*before_b2))
    # ... the minute volatility next to the stages before it (PR C1)
    stored_five = {n: {d: 1 for d, _, _ in rows} for n in NAMES if n not in later[1:]}
    _, i, _, action, why = ingest.diff(s[:3], s, stored_of(rows, stored_five), builders(1),
                                       files, False)  # fmt: skip
    assert (i, action, why) == (0, "add", without(*stored_five))
    # ... the second volatility next to the stages before it (PR C2)
    stored_six = {n: {d: 1 for d, _, _ in rows} for n in NAMES if n not in later[2:]}
    _, i, _, action, why = ingest.diff(s[:3], s, stored_of(rows, stored_six), builders(1),
                                       files, False)  # fmt: skip
    assert (i, action, why) == (0, "add", without(*stored_six))
    # ... and the six swing scales next to every other stored stage (PR D)
    stored_seven = {n: {d: 1 for d, _, _ in rows} for n in NAMES if n not in SWINGS}
    _, i, _, action, why = ingest.diff(s[:3], s, stored_of(rows, stored_seven), builders(1),
                                       files, False)  # fmt: skip
    assert (i, action, why) == (0, "add", "stages without stored rows: " + ", ".join(SWINGS))
    # a new scale next to the stored ones is added the same way, alone
    five = {n: {d: 1 for d, _, _ in rows} for n in NAMES if n != SWINGS[-1]}
    _, i, _, action, why = ingest.diff(s[:3], s, stored_of(rows, five), builders(1), files, False)
    assert (i, action, why) == (0, "add", f"stages without stored rows: {SWINGS[-1]}")
    # ... and an interrupted add resumes after the sessions it already stored
    first = {s[0].trade_date: 1}
    minute = {n: first for n in NAMES if n not in seconds}
    part = stored_of(rows, seconds | minute)
    _, i, _, action, _ = ingest.diff(s, s, part, builders(1), files, False)
    assert (i, action) == (1, "add")
    # A missing stage next to changed files is a repair of the changed session
    _, i, _, action, _ = ingest.diff(s, s, only_bar, builders(1), changed, False)
    assert action == "needs_rebuild"  # the first session lacks candles and is not a repair


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


def test_a_backtest_warmed_for_the_lead_computes_the_stored_rows(database, world, monkeypatch):
    """A backtest's default warm-up is the lead storage gives each contract, so from a roll on it
    computes exactly the stored rows of every stage, even when that lead reaches back before the
    downloaded data (those sessions are empty, as storage never had them)."""
    cache, _ = world
    files = {d: dbn(d) for d in DAYS}
    ranges = [(day_ns(date(2026, 8, 30)), day_ns(date(2026, 9, 5)))]  # sessions 08-31 .. 09-04
    data = {"GC": ingest.ProductData(GC, files, ranges)}
    options = {"url": database, "cache": cache, "log": lambda line: None}  # the default lead
    with db.connect(database) as conn:
        db.migrate(conn)
    [plan] = ingest.plan(["GC"], data=data, **options)
    assert plan["lead_sessions"] == ingest.LEAD_FLOOR
    assert ingest.run(["GC"], workers=1, data=data, **options)["status"] == "done"

    monkeypatch.setattr(service, "files_for", lambda parent, dataset: files)
    monkeypatch.setattr(service, "job_ranges", lambda parent, dataset: ranges)
    monkeypatch.setattr(DayCache, "get", lambda self, file: cache.get(file))
    rows = []
    process = Pipeline.process

    def capture(self, chunk):
        out = process(self, chunk)
        if chunk.tradable:
            rows.append(out)
        return out

    monkeypatch.setattr(Pipeline, "process", capture)
    # GCG7 becomes front on 09-03 (it traded more in the 09-02 session).
    body = {"product": "GC", "contract": "GCG7", "start": "2026-09-03", "end": "2026-09-03"}
    p = service.prepare(service.RunSpec.parse(body))
    assert p.spec.warmup_sessions == plan["lead_sessions"]
    engine = p.engine()
    for chunk in p.source.chunks():
        engine.process(chunk)
    [computed] = rows
    with db.connect(database) as conn:
        cid = conn.execute("SELECT id FROM market.contract WHERE raw_symbol = 'GCG7'").fetchone()
        for stage, table in computed.tables.items():
            ends = table.values["end_ns"]
            scale = plan["variants"][stage]  # a swing scale's rows carry its id; others have none
            stored = conn.execute(
                f"SELECT {', '.join(table.values)} FROM market.{store.STAGE_TABLE[stage]} "
                "WHERE contract_id = %s AND end_ns BETWEEN %s AND %s"
                + (f" AND variant_id = {scale}" if scale else "")
                + " ORDER BY end_ns",
                (cid[0], int(ends[0]), int(ends[-1])),
            ).fetchall()
            names = list(table.values)
            kept = np.array([r[names.index("end_ns")] for r in stored], np.int64)
            # a sparse stage stores some of its rows (a backtest computes no labels, so it
            # cannot name them): what is stored must be rows the backtest computed
            at = np.isin(ends, kept) if stage in SPARSE else np.ones(len(ends), bool)
            assert at.sum() == len(stored) and (len(stored) >= 1380 or not len(ends)), stage
            for j, (name, every) in enumerate(table.values.items()):
                values = every[at]
                null = table.nulls.get(name, np.zeros(len(every), bool))[at]
                if values.dtype.kind == "f":
                    null = null | np.isnan(values)
                want_null = np.array([r[j] is None for r in stored])
                want = np.array([0 if r[j] is None else r[j] for r in stored], values.dtype)
                assert np.array_equal(null, want_null), (stage, name)
                assert np.array_equal(values[~null], want[~null]), (stage, name)


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
    # Regression (PR #63 review): a file whose job range changed covers other seconds
    day = date(2026, 9, 2)
    first["GC"].files[day] = dataclasses.replace(
        first["GC"].files[day], start_ns=day_ns(day) + 3600 * NS
    )
    assert scans() == ["GC: scanned volumes of 2/2 sessions"]  # both sessions reading 09-02
    monkeypatch.setattr(ingest, "scan_identity", lambda: "f" * 64)
    assert scans() == ["GC: scanned volumes of 3/3 sessions"]  # other code: scanned again
    with db.connect(database) as conn:
        assert conn.execute("SELECT DISTINCT scan_sha256 FROM market.session_scan").fetchall() == [
            ("f" * 64,)
        ]
    # The source identity covers the code that selects files and sessions and feeds the stages;
    # every stage covers its own modules and the encoding of its rows. Orchestration (ingest,
    # store) is in neither, so adding a stage never makes the others stale; the end-to-end test
    # proves that stored rows equal the pipeline's output.
    runner = "apps/backtest-runner/src/backtest_runner"
    for name in ("catalog", "source", "calendars"):
        assert f"{runner}/{name}.py" in ingest.SOURCE_FILES
    assert f"{runner}/ingest.py" not in ingest.SOURCE_FILES
    ids = ingest.identities(GC, "COMEX")
    for cls in ingest.STAGES:
        assert ids[cls.NAME]["settings"]["inputs"]  # inputs' identities are part of it
        assert f"{runner}/codec.py" in ingest.CODEC_FILES
    assert ids["candle_1m_1s"]["settings"]["inputs"]["bar_1s"] == ids["bar_1s"]["sha256"]
    for name in ("ingest", "catalog", "source", "calendars"):  # scans are versioned the same way
        assert f"{runner}/{name}.py" in ingest.SCAN_FILES
    files = ingest.SOURCE_FILES + ingest.CODEC_FILES + ingest.SCAN_FILES
    modules = [f"{ingest.CORE}/{m}.py" for cls in ingest.STAGES for m in cls.MODULES]
    assert all((ingest.ROOT / rel).is_file() for rel in (*files, *modules))


def test_incomplete_range_openings_keep_a_front_and_explicit_contracts_keep_partial_edges(
    database, world
):
    """Regression (PR #63 review). A downloaded range whose first session has incomplete data
    still gets a front contract (from its own partial volume, or else the range's first
    front), so the continuous series keeps the session; partial volumes also bound an
    explicit contract's span; a range without any volume is reported, not silently dropped."""
    cache, _ = world
    with db.connect(database) as conn:
        db.migrate(conn)
    ranges = [(day_ns(date(2026, 8, 31)), day_ns(date(2026, 9, 5)))]

    def plan(missing_days, contract=None, ranges=ranges):
        files = {d: dbn(d) for d in DAYS if d not in missing_days}
        data = {"GC": ingest.ProductData(GC, files, ranges)}
        [p] = ingest.plan(
            ["GC"], url=database, data=data, cache=cache, log=lambda line: None, lead=1,
            contract=contract,
        )  # fmt: skip
        return p, [(d.day, s, b) for d, (s, b) in p["schedule"].items()]  # planned, unpublished

    # 08-31 is missing, so the 09-01 session (opening 08-31 22:00 UTC) has partial volume only
    p, rolls = plan({date(2026, 8, 31)})
    assert rolls[0] == (1, "GCZ6", "same_session") and len(rolls) == 4
    assert p["unresolved_sessions"] == []
    p, _ = plan({date(2026, 8, 31)}, contract="GCZ6")
    [z6] = p["contracts"]
    assert z6.sessions[0] == "2026-09-01"  # its partial first session is kept

    # 08-31 and 09-01 are missing: 09-01 has no volume, so it takes the range's first front
    p, rolls = plan({date(2026, 8, 31), date(2026, 9, 1)})
    assert rolls[:2] == [(1, "GCG7", "same_session"), (2, "GCG7", "same_session")]

    # a range without any file: its sessions are reported as unresolved
    empty = [(day_ns(date(2026, 8, 31)), day_ns(date(2026, 9, 3)))]
    p, rolls = plan(set(DAYS), ranges=empty)
    assert p["unresolved_sessions"] == ["2026-09-01", "2026-09-02"] and rolls == []


def test_a_failed_rebuild_keeps_every_session_readable(database, world, monkeypatch):
    """Regression (PR #63 review): stored sessions are replaced one at a time, each in one
    transaction, so a build that fails partway leaves the rest on their previous rows."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    assert ingest.run(["GC"], workers=1, data=first, **options)["status"] == "done"
    with db.connect(database) as conn:
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
        conn.execute(  # rows from other code: every contract must be rebuilt
            "INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
            "VALUES (repeat('b', 64), 'GC', 'x', '{}', 'source')"
        )
        conn.execute(
            "UPDATE market.ingest_slice SET builder_id = "
            "(SELECT id FROM market.builder WHERE sha256 = repeat('b', 64))"
        )
        conn.commit()
    real, calls = store.copy_table, []

    def failing(conn, name, table, cid, **keys):  # one call per stage table and session
        calls.append(cid)
        if len(calls) == 3:  # the first session's third table
            raise RuntimeError("disk full")
        return real(conn, name, table, cid, **keys)

    monkeypatch.setattr(store, "copy_table", failing)
    result = ingest.run(["GC"], workers=1, data=first, rebuild=True, **options)
    assert result["status"] in ("partial", "failed")
    with db.connect(database) as conn:
        rows = conn.execute("SELECT count(*) FROM market.bar_1s").fetchone()[0]
        assert rows == 4 * 82_800  # no session lost its rows
        builders = conn.execute(
            "SELECT count(DISTINCT builder_id) FROM market.ingest_slice"
        ).fetchone()[0]
        assert builders == 2  # replaced sessions next to old ones, each whole


def test_stages_are_versioned_written_and_warmed_on_their_own(database, world):
    """A stage built by other code is rebuilt with the stages that read it (`vol_1s` reads
    `candle_1m_1s`), leaving the rows of the stages they do not depend on untouched; a stage
    without rows is added without --rebuild; every stage records whether its values had settled;
    the lead follows the stages' derived warm-ups."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    assert ingest.run(["GC"], workers=1, data=first, **options)["status"] == "done"

    def slices(conn):
        return {
            (stage, cid, day, variant): (builder, warm, at)
            for stage, cid, day, variant, builder, warm, at in conn.execute(
                "SELECT stage, contract_id, trade_date, variant_id, builder_id, warm, ingested_at "
                "FROM market.stage_slice"
            )
        }

    with db.connect(database) as conn:
        before = slices(conn)
        ids = dict(conn.execute("SELECT raw_symbol, id FROM market.contract").fetchall())
        # warm: the candle stage needs part of a session to settle, so a contract's first stored
        # session is not warm and its later ones are; bar_1s has nothing to settle
        g7 = sorted(
            (k[2], v[1]) for k, v in before.items() if k[:2] == ("candle_1m_1s", ids["GCG7"])
        )
        assert [w for _, w in g7] == [False, True]
        assert all(v[1] for k, v in before.items() if k[0] == "bar_1s")
        # candle rows from other code: stale, and --rebuild rewrites only the candle stage
        other = conn.execute(
            "INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
            "VALUES (repeat('d', 64), 'GC', 'x', '{}', 'candle_1m_1s') RETURNING id"
        ).fetchone()[0]
        conn.execute("UPDATE market.stage_slice SET builder_id = %s WHERE stage = 'candle_1m_1s'",
                     (other,))  # fmt: skip
        conn.commit()
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in plan["contracts"]} == {"stale"}
    assert ingest.run(["GC"], workers=1, data=first, rebuild=True, **options)["status"] == "done"
    with db.connect(database) as conn:
        after = slices(conn)
        for key, (builder, _, at) in after.items():
            # the fast scales read both, and their labels read them
            if key[0] not in ("candle_1m_1s", "vol_1s", "pivot_1s", "pivot_label_1s"):
                assert (builder, at) == (before[key][0], before[key][2]), key  # untouched
            else:
                assert at > before[key][2] and builder == before[key][0], key  # rewritten
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
        # a stage without rows is added from the span start, without --rebuild
        conn.execute("DELETE FROM market.stage_slice WHERE stage = 'candle_1m_1s'")
        conn.execute("DELETE FROM market.candle_1m_1s")
        conn.commit()
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {(c["action"], c["todo"]) for c in plan["contracts"]} == {("add", 2)}
    assert ingest.run(["GC"], workers=1, data=first, **options)["status"] == "done"
    expected = in_memory(cache, first, "GCG7", [date(2026, 9, 2), date(2026, 9, 3)])
    with db.connect(database) as conn:
        restored = slices(conn)
        assert all(restored[k][2] == after[k][2] for k in after if k[0] == "bar_1s")
        cols = ["slot_ordinal", "rsi", "ema50_atr", "adx"]
        got = read(conn, "candle_1m_1s", ids["GCG7"], cols, every=101)
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
    want = {k: np.concatenate([p.tables["candle_1m_1s"].values[k] for p in expected]) for k in cols}
    at = np.searchsorted(want["slot_ordinal"], got["slot_ordinal"].astype(np.int64))
    for k in cols[1:]:
        stored = np.array([np.nan if v is None else v for v in got[k]], float)
        np.testing.assert_array_equal(stored, want[k][at], err_msg=k)
    # the derived lead: at least the floor, and a lead below a stage's warm-up is refused
    [plan] = ingest.plan(["GC"], data=first, url=database, cache=cache, log=lambda line: None)
    assert plan["lead_sessions"] == max(ingest.LEAD_FLOOR, plan["required_lead"]["sessions"])
    assert plan["warm_sessions"] == {
        "bar_1s": 0,
        "bar_1m": 0,
        "candle_1m_1s": 1,
        "candle_1h_1m": 1,
        "stats_1h_1m": 1,
        "vol_1m": 1,
        "vol_1s": 1,
        "bar_10s": 0,
        "candle_10m_10s": 1,
        "stats_10m_10s": 1,
        "vol_10s": 1,
        # their thresholds' ATR(14)
        **{s.NAME: 1 for s in (*MIDDLE_SCALES, *SLOW_SCALES, *FAST_SCALES)},
        # a label needs only its scale's
        **{s.NAME: 1 for s in (*MIDDLE_LABELS, *SLOW_LABELS, *FAST_LABELS)},
    }
    with pytest.raises(ValueError, match="candle_1m_1s"):
        ingest.plan(["GC"], data=first, **{**options, "lead": 0})
    # a longer lead prepends sessions: every later value changes, so the plan says why
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **{**options, "lead": 2}))["products"]
    g7 = next(c for c in plan["contracts"] if c["contract"] == "GCG7")
    assert g7["action"] == "needs_rebuild" and "lead of 2 sessions" in g7["reason"]


def test_a_stale_minute_stage_is_rebuilt_alone(database, world):
    """Minute tables count minutes: a stale `bar_1m` is replaced session by session at its own
    resolution (no duplicate keys, no leftovers), together with `candle_1h_1m`, `stats_1h_1m`,
    `vol_1m`, and the slow swing scales, which read it, while the second tables stay untouched.
    The stored minutes equal an in-memory build."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    assert ingest.run(["GC"], workers=1, data=first, **options)["status"] == "done"

    def slices(conn):
        return {
            (stage, cid, day, variant): (builder, at)
            for stage, cid, day, variant, builder, at in conn.execute(
                "SELECT stage, contract_id, trade_date, variant_id, builder_id, ingested_at "
                "FROM market.stage_slice"
            )
        }

    with db.connect(database) as conn:
        before = slices(conn)
        ids = dict(conn.execute("SELECT raw_symbol, id FROM market.contract").fetchall())
        other = conn.execute(
            "INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
            "VALUES (repeat('e', 64), 'GC', 'x', '{}', 'bar_1m') RETURNING id"
        ).fetchone()[0]
        conn.execute("UPDATE market.stage_slice SET builder_id = %s WHERE stage = 'bar_1m'",
                     (other,))  # fmt: skip
        conn.commit()
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in plan["contracts"]} == {"stale"}
    result = ingest.run(["GC"], workers=1, data=first, rebuild=True, **options)
    assert result["status"] == "done", result
    assert {t for r in result["results"] for t in r["tables"]} == {
        "bar_1m",
        "candle_1h_1m",
        "stats_1h_1m",
        "vol_1m",
        "pivot_1m",
        "pivot_event",  # the slow scales' events are replaced with their rows
        "pivot_label_1m",  # ... and their labels follow them
    }
    with db.connect(database) as conn:
        after = slices(conn)
        assert after.keys() == before.keys()
        for key, (builder, at) in after.items():
            if key[0] in ("bar_1s", "candle_1m_1s", "vol_1s", "pivot_1s", "pivot_label_1s") or (
                key[0].split(":")[0].endswith("10s")  # the middle timeframe is another branch
            ):
                assert (builder, at) == before[key], key  # untouched
            else:
                assert at > before[key][1] and builder == before[key][0], key  # rewritten
        counts = conn.execute(
            "SELECT (SELECT count(*) FROM market.bar_1m), "
            "(SELECT count(*) FROM market.candle_1h_1m), "
            "(SELECT count(*) FROM market.stats_1h_1m), (SELECT count(*) FROM market.vol_1m)"
        ).fetchone()
        assert counts == (4 * 1380,) * 4
        assert_continuous(conn, ["GCZ6", "GCZ6", "GCG7"])
        columns = [c.name for c in MINUTE_COLUMNS]
        got = read(conn, "bar_1m", ids["GCG7"], columns)
    expected = in_memory(cache, first, "GCG7", [date(2026, 9, 2), date(2026, 9, 3)])
    want = {k: np.concatenate([p.tables["bar_1m"].values[k] for p in expected]) for k in columns}
    null = {
        k: np.concatenate(
            [p.tables["bar_1m"].nulls.get(k, np.zeros(len(p.tables["bar_1m"]), bool))
             for p in expected]
        )
        for k in columns
    }  # fmt: skip
    np.testing.assert_array_equal(got["slot_ordinal"].astype(np.int64), want["slot_ordinal"])
    for k in columns:
        is_null = np.array([v is None for v in got[k]])
        np.testing.assert_array_equal(is_null, null[k], err_msg=k)
        stored = got[k][~is_null].astype(want[k].dtype)
        np.testing.assert_array_equal(stored, want[k][~is_null], err_msg=k)


@pytest.mark.parametrize(
    ("stage", "columns", "defined", "per", "every"),
    [
        ("stats_1h_1m", STATS_COLUMNS, ("rv_bps", "prior_close_atr"), 1380, 1),  # PR B2
        ("vol_1m", VOL_COLUMNS, ("bull_atr_bps", "tr_atr", "atr_usd"), 1380, 1),  # PR C1
        ("vol_1s", VOL_SECOND_COLUMNS, ("bull_atr_bps", "rv_atr", "atr_usd"), 82_800, 7),  # C2
    ],
)
def test_a_new_stage_is_added_alone(database, world, stage, columns, defined, per, every):
    """A new stage next to stored ones. With every other stage current, the plan adds only that
    stage (no --rebuild), the run writes only its table and those of the stages that read it (the
    swing scales read the volatility of their resolution), every other stage's records stay
    untouched, and the stored rows equal an in-memory build, NULLs included (`per` rows per
    contract session; every `every`-th slot is compared)."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    assert ingest.run(["GC"], workers=1, data=first, **options)["status"] == "done"

    def slices(conn):
        return {
            (stage, cid, day, variant): (builder, at)
            for stage, cid, day, variant, builder, at in conn.execute(
                "SELECT stage, contract_id, trade_date, variant_id, builder_id, ingested_at "
                "FROM market.stage_slice"
            )
        }

    with db.connect(database) as conn:  # as before the stage was added: it has no rows
        conn.execute("DELETE FROM market.stage_slice WHERE stage = %s", (stage,))
        conn.execute(f"DELETE FROM market.{stage}")
        conn.commit()
        before = slices(conn)
        ids = dict(conn.execute("SELECT raw_symbol, id FROM market.contract").fetchall())
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {(c["action"], c["reason"]) for c in plan["contracts"]} == {
        ("add", f"stages without stored rows: {stage}")
    }
    result = ingest.run(["GC"], workers=1, data=first, **options)
    assert result["status"] == "done", result
    readers = {
        "vol_1m": {"pivot_1m", "pivot_event", "pivot_label_1m"},
        "vol_1s": {"pivot_1s", "pivot_event", "pivot_label_1s"},
    }
    written = {stage} | readers.get(stage, set())
    assert {t for r in result["results"] for t in r["tables"]} == written
    with db.connect(database) as conn:
        after = slices(conn)
        assert {k: v for k, v in after.items() if k[0] not in written} == {
            k: v for k, v in before.items() if k[0] not in written
        }  # untouched
        assert {k[1:3] for k in after if k[0] == stage} == {k[1:3] for k in before}
        assert conn.execute(f"SELECT count(*) FROM market.{stage}").fetchone()[0] == 4 * per
        series = conn.execute(
            f"SELECT count(*), count(DISTINCT slot_ordinal) FROM market.continuous_{stage} "
            "WHERE product = 'GC'"
        ).fetchone()
        assert series == (3 * per, 3 * per)
        columns = [c.name for c in columns]
        got = read(conn, stage, ids["GCG7"], columns, every=every)
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in plan["contracts"]} == {"current"}
    expected = in_memory(cache, first, "GCG7", [date(2026, 9, 2), date(2026, 9, 3)])
    tables = [p.tables[stage] for p in expected]
    want = {k: np.concatenate([t.values[k] for t in tables]) for k in columns}
    null = {
        k: np.concatenate([t.nulls.get(k, np.zeros(len(t), bool)) for t in tables]) for k in columns
    }
    sample = want["slot_ordinal"] % every == 0
    want = {k: v[sample] for k, v in want.items()}
    null = {k: v[sample] for k, v in null.items()}
    np.testing.assert_array_equal(got["slot_ordinal"].astype(np.int64), want["slot_ordinal"])
    assert all((~null[k]).sum() > 1000 for k in defined)
    for k in columns:
        is_null = np.array([v is None for v in got[k]])
        np.testing.assert_array_equal(is_null, null[k], err_msg=k)
        stored = got[k][~is_null].astype(want[k].dtype)
        np.testing.assert_array_equal(stored, want[k][~is_null], err_msg=k)


def assert_stored(got: list[tuple], columns: list[str], tables: list[Table], keep=None) -> None:
    """Stored rows (tuples in `columns` order) equal the in-memory tables, NULLs included."""
    for j, k in enumerate(columns):
        want = np.concatenate([t.values[k] for t in tables])
        null = np.concatenate([t.nulls.get(k, np.zeros(len(t), bool)) for t in tables])
        if keep is not None:
            want, null = want[keep], null[keep]
        assert len(got) == len(want), k
        is_null = np.array([r[j] is None for r in got], bool)
        np.testing.assert_array_equal(is_null, null, err_msg=k)
        stored = np.array([r[j] for r in got], dtype=object)[~is_null].astype(want.dtype)
        np.testing.assert_array_equal(stored, want[~null], err_msg=k)


def test_swing_scales_are_stages_of_their_own_in_shared_tables(database, world):
    """PR D. Each swing scale is a variant: a stage with its own builder, checkpoint, and session
    records, writing rows keyed by `variant_id` into its resolution's table and its events into
    `market.pivot_event`. Stored rows and events equal an in-memory build; a stale scale is
    rebuilt alone, leaving the other scales' rows, events, and records untouched; scales without
    rows are added without --rebuild."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    result = ingest.run(["GC"], workers=1, data=first, **options)
    assert result["status"] == "done", result
    assert {"pivot_1s", "pivot_1m", "pivot_event"} <= {
        t for r in result["results"] for t in r["tables"]
    }
    [plan] = ingest.plan(["GC"], data=first, **options)
    every = (*MIDDLE_SCALES, *SLOW_SCALES, *FAST_SCALES)
    variants = {s.NAME: plan["variants"][s.NAME] for s in every}
    assert len(set(variants.values())) == 9 and all(variants.values())
    scales = (*SLOW_SCALES, *FAST_SCALES)  # checked row by row below; the middle ones as slow
    all_labels = (*MIDDLE_LABELS, *SLOW_LABELS, *FAST_LABELS)
    labels = {s.NAME: plan["variants"][s.NAME] for s in all_labels}
    assert len(set(labels.values())) == 18 and all(labels.values())  # label IDs are variants too
    assert all(plan["variants"][n] == 0 for n in plan["variants"] if n not in variants | labels)
    dates = [date(2026, 9, 2), date(2026, 9, 3)]
    expected = in_memory(cache, first, "GCG7", dates)
    columns = [c.name for c in PIVOT_COLUMNS]
    event_columns = [c.name for c in EVENT_COLUMNS]

    def slices(conn):
        return {
            (stage, variant, cid, day): (builder, at)
            for stage, variant, cid, day, builder, at in conn.execute(
                "SELECT stage, variant_id, contract_id, trade_date, builder_id, ingested_at "
                "FROM market.stage_slice"
            )
        }

    def fingerprints(conn):
        """Per table and scale: rows and a checksum of every stored value."""
        return {
            (table, variant): (n, digest)
            for table in ("pivot_1s", "pivot_1m", "pivot_event")
            for variant, n, digest in conn.execute(
                f"SELECT variant_id, count(*), md5(string_agg(t::text, '' ORDER BY contract_id, "
                f"slot_ordinal{', seq' if table == 'pivot_event' else ''})) "
                f"FROM market.{table} t GROUP BY 1"
            )
        }

    with db.connect(database) as conn:
        registry = {
            f"{stage}:{name}": (vid, params)
            for stage, name, vid, params in conn.execute(
                "SELECT stage, name, id, params FROM market.variant"
            )
        }
        assert {n: v for n, (v, _) in registry.items()} == variants | labels
        assert registry["pivot_1s:fast_atr_0p5"][1]["multiplier"] == 0.5
        assert (
            registry["pivot_1m:slow_atr_2"][1] | {"spread_floor": 2.0, "stream": "slow"}
            == (registry["pivot_1m:slow_atr_2"][1])
        )
        ids = dict(conn.execute("SELECT raw_symbol, id FROM market.contract").fetchall())
        before, prints = slices(conn), fingerprints(conn)
        warm = {}
        for s in scales:
            table, variant = store.STAGE_TABLE[s.NAME], variants[s.NAME]
            series = conn.execute(
                f"SELECT count(*), count(DISTINCT slot_ordinal) FROM market.continuous_{table} "
                "WHERE product = 'GC' AND variant_id = %s",
                (variant,),
            ).fetchone()
            if table == "pivot_1m":  # every minute: two contracts, two sessions
                assert prints[table, variant][0] == 4 * 1380, s.NAME
                assert series == (3 * 1380, 3 * 1380), s.NAME
            else:  # the fast scales store the seconds something reads, far fewer than all
                assert 3 * 1380 <= series[0] == series[1] < 3 * 82_800 // 4, s.NAME
            # stored rows equal the in-memory build, at the rows storage keeps
            got = conn.execute(
                f"SELECT {', '.join(columns)} FROM market.{table} WHERE contract_id = %s "
                "AND variant_id = %s ORDER BY slot_ordinal",
                (ids["GCG7"], variant),
            ).fetchall()
            tables = [p.tables[s.NAME] for p in expected]
            assert_stored(got, columns, [stored_rows(s.NAME, p) for p in expected])
            # ... and so do its events, each carrying the scale's builder
            events = [p.products["events"][s.NAME] for p in expected]
            got = conn.execute(
                f"SELECT {', '.join(event_columns)} FROM market.pivot_event "
                "WHERE contract_id = %s AND variant_id = %s ORDER BY slot_ordinal, seq",
                (ids["GCG7"], variant),
            ).fetchall()
            assert_stored(got, event_columns, events)
            builders = conn.execute(
                "SELECT DISTINCT builder_id FROM market.pivot_event WHERE variant_id = %s",
                (variant,),
            ).fetchall()
            assert builders in ([(plan["builders"][s.NAME],)], []), s.NAME
            # warm is the stage's own report: every row had a confirmed high and low
            flags = conn.execute(
                "SELECT warm FROM market.stage_slice WHERE stage = %s AND variant_id = %s "
                "AND contract_id = %s ORDER BY trade_date",
                (table, variant, ids["GCG7"]),
            ).fetchall()
            want = [bool(not (t.nulls["high_age_s"] | t.nulls["low_age_s"]).any()) for t in tables]
            assert [f[0] for f in flags] == want, s.NAME
            warm[s.NAME] = want
        assert warm["pivot_1s:fast_atr_0p5"] == [False, True]  # a first session starts cold
        # Every fast scale keeps the same seconds: each minute's last, every row of a fast
        # label, and every row with a fast event. So a candidate finds every scale at its row.
        fast = [variants[s.NAME] for s in FAST_SCALES]
        keys = conn.execute(
            "SELECT variant_id, md5(string_agg(contract_id || ':' || slot_ordinal, ',' "
            "ORDER BY contract_id, slot_ordinal)) FROM market.pivot_1s GROUP BY 1"
        ).fetchall()
        assert sorted(v for v, _ in keys) == sorted(fast) and len({k for _, k in keys}) == 1
        missing = """SELECT count(*) FROM {} x WHERE NOT EXISTS (SELECT 1 FROM market.pivot_1s p
                     WHERE p.contract_id = x.contract_id AND p.slot_ordinal = x.slot_ordinal
                       AND p.end_ns = x.end_ns AND p.variant_id = %s)"""
        for source in (
            "market.pivot_label_1s",
            "(SELECT * FROM market.pivot_event WHERE variant_id = ANY(%s))",
            "(SELECT * FROM market.candle_1m_1s WHERE slot_ordinal %% 60 = 0)",
        ):
            args = (fast, fast[0]) if "ANY" in source else (fast[0],)
            assert conn.execute(missing.format(source), args).fetchone()[0] == 0, source
        assert conn.execute("SELECT count(*) FROM market.pivot_label_1s").fetchone()[0] > 100
        kept = stored_ordinals(expected[1])
        assert len(kept) and (kept % 60 != 0).any()  # not only minute ends
        assert prints["pivot_event", variants["pivot_1s:fast_atr_0p5"]][0] > 2000
        assert prints["pivot_event", variants["pivot_1m:slow_atr_0p5"]][0] > 10
        reads = conn.execute(
            "SELECT scale, count(*) FROM market.continuous_pivot_event WHERE product = 'GC' "
            "GROUP BY 1"
        ).fetchall()
        assert {name for name, _ in reads} >= {s.VARIANT for s in FAST_SCALES}
        # one scale built by other code: stale, and --rebuild rewrites that scale alone
        stale = "pivot_1s:fast_atr_1"
        other = conn.execute(
            "INSERT INTO market.builder (sha256, product, code_sha256, settings, stage) "
            "VALUES (repeat('9', 64), 'GC', 'x', '{}', %s) RETURNING id",
            (stale,),
        ).fetchone()[0]
        conn.execute(
            "UPDATE market.stage_slice SET builder_id = %s WHERE stage = 'pivot_1s' "
            "AND variant_id = %s",
            (other, variants[stale]),
        )
        conn.commit()
    [now] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in now["contracts"]} == {"stale"}
    result = ingest.run(["GC"], workers=1, data=first, rebuild=True, **options)
    assert result["status"] == "done", result
    assert {t for r in result["results"] for t in r["tables"]} == {
        "pivot_1s", "pivot_event", "pivot_label_1s",
    }  # fmt: skip
    # The scale and its labels are rebuilt; the label rows are among the seconds every fast
    # scale keeps, so the other fast scales and their labels are written again with them.
    rewritten = {("pivot_1s", variants[s.NAME]) for s in FAST_SCALES} | {
        ("pivot_label_1s", labels[s.NAME]) for s in FAST_LABELS
    }
    with db.connect(database) as conn:
        after = slices(conn)
        assert after.keys() == before.keys()
        for key, (builder, at) in after.items():
            if key[:2] in rewritten:
                assert at > before[key][1] and builder == before[key][0], key  # rewritten
            else:
                assert (builder, at) == before[key], key  # untouched
        assert fingerprints(conn) == prints  # the same code writes the same rows and events
        # scales without rows (as before they existed) are added, with their events
        for table in ("pivot_1s", "pivot_1m"):
            conn.execute("DELETE FROM market.stage_slice WHERE stage = %s", (table,))
            conn.execute(f"DELETE FROM market.{table}")
        conn.execute(
            "DELETE FROM market.pivot_event WHERE variant_id = ANY(%s)",
            ([variants[s.NAME] for s in scales],),
        )  # the middle scales keep their rows and events
        conn.commit()
    [now] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {(c["action"], c["reason"]) for c in now["contracts"]} == {
        ("add", "stages without stored rows: " + ", ".join(sorted(s.NAME for s in scales)))
    }
    result = ingest.run(["GC"], workers=1, data=first, **options)
    assert {t for r in result["results"] for t in r["tables"]} == {
        "pivot_1s", "pivot_1m", "pivot_event", "pivot_label_1s", "pivot_label_1m",
    }  # fmt: skip
    with db.connect(database) as conn:
        assert fingerprints(conn) == prints
        added = slices(conn)
        assert {k: v for k, v in added.items() if not k[0].startswith("pivot")} == {
            k: v for k, v in after.items() if not k[0].startswith("pivot")
        }
    [now] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in now["contracts"]} == {"current"}

    # A scale that no stage defines any more (here: one copied under another name) is retired,
    # not deleted: the planner ignores its records, its rows stay, and the continuous views
    # leave them out (PR #82 review).
    kept = variants["pivot_1s:fast_atr_2"]
    with db.connect(database) as conn:
        old = conn.execute(
            "INSERT INTO market.variant (stage, name, params) "
            "VALUES ('pivot_1s', 'fast_old', '{}') RETURNING id"
        ).fetchone()[0]
        names = ", ".join(c.name for c in PIVOT_COLUMNS)
        conn.execute(
            f"INSERT INTO market.pivot_1s (contract_id, variant_id, {names}) "
            f"SELECT contract_id, %s, {names} FROM market.pivot_1s WHERE variant_id = %s",
            (old, kept),
        )
        conn.execute(
            "INSERT INTO market.stage_slice (stage, variant_id, contract_id, trade_date, "
            "builder_id, run_id, state, warm, build_seconds) SELECT stage, %s, contract_id, "
            "trade_date, builder_id, run_id, state, warm, build_seconds FROM market.stage_slice "
            "WHERE stage = 'pivot_1s' AND variant_id = %s",
            (old, kept),
        )
        conn.commit()
    [now] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in now["contracts"]} == {"current"}
    with db.connect(database) as conn:
        retired = dict(conn.execute("SELECT name, retired_at IS NOT NULL FROM market.variant"))
        active = (*every, *all_labels)
        assert retired == {"fast_old": True} | {s.VARIANT: False for s in active}
        count = "SELECT count(*) FROM market.{} WHERE variant_id = %s"
        copied = conn.execute(count.format("pivot_1s"), (kept,)).fetchone()[0]
        assert conn.execute(count.format("pivot_1s"), (old,)).fetchone()[0] == copied > 4 * 1380
        assert conn.execute(count.format("continuous_pivot_1s"), (old,)).fetchone()[0] == 0
        assert conn.execute(count.format("continuous_pivot_1s"), (kept,)).fetchone()[0] > 0
        # A registered name never changes meaning: other parameters under it are refused, so
        # stored rows are never read under parameters they were not built with (PR #82 review)
        conn.execute(
            "UPDATE market.variant SET params = params || '{\"multiplier\": 0.75}' "
            "WHERE name = 'fast_atr_1'"
        )
        conn.commit()
    with pytest.raises(ValueError, match=r"pivot_1s:fast_atr_1 .*\(multiplier\).* new name"):
        ingest.plan(["GC"], data=first, **options)


def test_labels_are_stored_per_variant_within_their_session_and_never_as_features(database, world):
    """PR F. Each label variant (a swing scale at one stage q) is a stage writing sparse rows,
    one per candidate, into its resolution's label table. Stored labels equal an in-memory
    build, every label is settled inside its own session, the variant's parameters are the label
    ID, and no label column is registered as a feature."""
    cache, data = world
    options = {"url": database, "cache": cache, "log": lambda line: None, "lead": 1}
    with db.connect(database) as conn:
        db.migrate(conn)
    first = data(date(2026, 9, 4))
    result = ingest.run(["GC"], workers=1, data=first, **options)
    assert result["status"] == "done", result
    assert {"pivot_label_1s", "pivot_label_1m"} <= {
        t for r in result["results"] for t in r["tables"]
    }
    [plan] = ingest.plan(["GC"], data=first, **options)
    expected = in_memory(cache, first, "GCG7", [date(2026, 9, 2), date(2026, 9, 3)])
    names = [c.name for c in LABEL_COLUMNS]
    with db.connect(database) as conn:
        cid = conn.execute("SELECT id FROM market.contract WHERE raw_symbol = 'GCG7'").fetchone()[0]
        for stage in (*SLOW_LABELS, *FAST_LABELS):
            tables = [p.tables[stage.NAME] for p in expected]
            want = sorted(
                tuple(
                    None if t.nulls.get(n, np.zeros(len(t), bool))[i] else t.values[n][i].item()
                    for n in names
                )
                for t in tables
                for i in range(len(t))
            )
            got = conn.execute(
                f"SELECT {', '.join(names)} FROM market.{stage.TABLE} WHERE contract_id = %s "
                "AND variant_id = %s ORDER BY slot_ordinal, seq",
                (cid, plan["variants"][stage.NAME]),
            ).fetchall()
            assert got == want, stage.NAME
            assert len(got) > (500 if stage.RESOLUTION == "1s" else 0), stage.NAME
            params = conn.execute(
                "SELECT params FROM market.variant WHERE stage = %s AND name = %s",
                (stage.TABLE, stage.VARIANT),
            ).fetchone()[0]
            assert params["scale"] == stage.SCALE.NAME and params["stage_q"] == stage.Q
            assert (params["reversal"], params["invalidation"]) == (1.0, 0.25)
        for table, per in (("pivot_label_1s", 1), ("pivot_label_1m", 60)):
            outside = conn.execute(
                f"""SELECT count(*) FROM market.{table} l JOIN market.ingest_slice s
                      ON s.contract_id = l.contract_id
                     AND l.end_ns > s.open_ns AND l.end_ns <= s.close_ns
                    WHERE l.outcome_ordinal * {per} > s.last_ordinal
                       OR coalesce(l.survival_ordinal, 0) * {per} > s.last_ordinal
                       OR l.slot_ordinal * {per} < s.first_ordinal"""
            ).fetchone()[0]
            assert outside == 0, table  # so a session's labels are replaced with its rows
            front, stored = conn.execute(
                f"SELECT (SELECT count(*) FROM market.continuous_{table} WHERE product = 'GC'), "
                f"(SELECT count(*) FROM market.{table})"
            ).fetchone()
            assert 0 < front < stored  # only front sessions; lead sessions stay out
        roles = conn.execute(
            "SELECT DISTINCT role FROM market.column_registry WHERE stage LIKE 'pivot_label%'"
        ).fetchall()
        assert {r[0] for r in roles} == {"key", "context"}  # never a model input
        outcomes = conn.execute(
            "SELECT array_agg(DISTINCT outcome ORDER BY outcome) FROM market.pivot_label_1s"
        ).fetchone()[0]
        assert outcomes[:5] == [0, 1, 2, 3, 4]
    [plan] = ingest.summarize(ingest.plan(["GC"], data=first, **options))["products"]
    assert {c["action"] for c in plan["contracts"]} == {"current"}
