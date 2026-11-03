import dataclasses
import hashlib
import json
import threading
from datetime import date, datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
import pytest
from backtest_runner import catalog, server, service
from backtest_runner.calendars import Session, load_sessions
from backtest_runner.catalog import DbnFile
from backtest_runner.source import HistoricalSource, instrument_id, to_trades
from strategy_core.bars import MISSING, OBSERVED, aggregate
from strategy_core.engine import Engine, split_by_second
from strategy_core.execution import ExecutionConfig
from strategy_core.market import HOUR, NS, PRODUCTS, SECOND, UNDEF_PRICE, SessionCalendar
from strategy_core.strategies import make_strategy

GC = PRODUCTS["GC"]
D1, D2, D3 = date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)
DAY0 = 1_788_220_800 * NS  # 2026-09-01 00:00 UTC
RECORD = np.dtype(
    [
        ("instrument_id", "u4"),
        ("ts_event", "u8"),
        ("ts_recv", "u8"),
        ("action", "S1"),
        ("side", "S1"),
        ("price", "i8"),
        ("size", "u4"),
        ("bid_px_00", "i8"),
        ("ask_px_00", "i8"),
        ("bid_sz_00", "u4"),
        ("ask_sz_00", "u4"),
        ("bid_ct_00", "u4"),
        ("ask_ct_00", "u4"),
        ("flags", "u1"),
    ]
)


def records(rows):
    """Rows of (instrument_id, ts_event, side, price, size[, receive delay]), in receive order."""
    out = np.zeros(len(rows), RECORD)
    for i, (iid, ts, side, price, size, *delay) in enumerate(rows):
        px = round(price * 1e9)
        recv = ts + (delay[0] if delay else 1000)
        out[i] = (iid, ts, recv, b"T", side, px, size, px - 100_000_000, px, 3, 3, 1, 1, 0)
    return out[np.argsort(out["ts_recv"], kind="stable")]


def mappings(symbols: dict[str, int], day: date) -> dict:
    nxt = date.fromordinal(day.toordinal() + 1)
    return {s: [{"start_date": day, "end_date": nxt, "symbol": str(i)}] for s, i in symbols.items()}


class FakeCache:
    def __init__(self, days):
        self.days = days

    def get(self, file):
        return self.days[file.date]


def dbn_file(day: date) -> DbnFile:
    return DbnFile(
        Path(f"/nonexistent/{day}.dbn"),
        day,
        "job",
        "GLBX.MDP3",
        ("GC.FUT",),
        "0" * 64,
        0,
        "available",
    )


def test_side_mapping_contract_ids_per_day_and_spreads_are_not_outrights():
    t = to_trades(
        records(
            [
                (1, DAY0, b"B", 2000.0, 1),
                (1, DAY0 + 1, b"A", 2000.1, 2),
                (1, DAY0 + 2, b"N", 2000.2, 3),
            ]
        )
    )
    assert t.side.tolist() == [1, -1, 0]
    m = {
        "GCZ6": [
            {"start_date": D1, "end_date": D2, "symbol": "11"},
            {"start_date": D2, "end_date": D3, "symbol": "12"},
        ]
    }
    assert (instrument_id(m, "GCZ6", D1), instrument_id(m, "GCZ6", D2)) == (11, 12)
    assert instrument_id(m, "GCZ6", D3) is None
    assert GC.is_outright("GCZ6") and not GC.is_outright("GCZ6-GCG7")
    assert not GC.is_outright("MGCZ6") and PRODUCTS["MGC"].is_outright("MGCZ6")


def test_front_contract_by_previous_session_volume_with_warmup_on_roll(monkeypatch):
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    sessions = [
        Session(D1, DAY0, DAY0 + 20 * HOUR, DAY0 - 4 * HOUR),
        Session(D2, DAY0 + 24 * HOUR, DAY0 + 44 * HOUR, DAY0 + 20 * HOUR),
        Session(D3, DAY0 + 48 * HOUR, DAY0 + 68 * HOUR, DAY0 + 44 * HOUR),
    ]
    ids = {"GCG7": 1, "GCZ6": 2, "GCZ6-GCG7": 3}  # D1 busiest is GCZ6, D2 busiest GCG7
    days = {
        D1: (
            records(
                [
                    (1, DAY0 + HOUR, b"B", 2000, 10),
                    (2, DAY0 + HOUR, b"B", 2010, 50),
                    (3, DAY0 + HOUR, b"B", -10, 999),
                ]
            ),
            mappings(ids, D1),
        ),
        D2: (
            records([(1, DAY0 + 25 * HOUR, b"A", 2000, 90), (2, DAY0 + 25 * HOUR, b"B", 2010, 5)]),
            mappings(ids, D2),
        ),
        D3: (records([(2, DAY0 + 49 * HOUR, b"B", 2010, 1)]), mappings(ids, D3)),
    }
    files = {d: dbn_file(d) for d in days}
    source = HistoricalSource(
        GC, files, sessions[:1], sessions[1:], ExecutionConfig(), cache=FakeCache(days)
    )
    chunks = list(source.chunks())
    assert [(c.contract, c.session, c.tradable) for c in chunks] == [
        ("GCZ6", "2026-09-01 GCZ6 (warmup)", False),  # D1's busiest outright; the spread is ignored
        ("GCZ6", "2026-09-02 GCZ6", True),
        ("GCG7", "2026-09-02 GCG7 (warmup)", False),  # rolled on D2's volume: re-warm D2
        ("GCG7", "2026-09-03 GCG7", True),
    ]
    assert len(chunks[1].trades) == 1 and chunks[1].trades.side.tolist() == [1]
    # D2's session reads D1's file too (the closure before it starts on D1)
    assert chunks[1].coverage.tolist() == [
        [DAY0, DAY0 + 24 * HOUR],
        [DAY0 + 24 * HOUR, DAY0 + 48 * HOUR],
    ]
    explicit = HistoricalSource(
        GC, files, [], sessions[1:2], ExecutionConfig(), "GCG7", cache=FakeCache(days)
    )
    assert [c.contract for c in explicit.chunks()] == ["GCG7"]
    with pytest.raises(ValueError, match="front contract"):
        list(
            HistoricalSource(
                GC, files, [], sessions[:1], ExecutionConfig(), cache=FakeCache(days)
            ).chunks()
        )
    backward = {"GCZ6": 1, "GCG7": 2, "GCZ6-GCG7": 3}  # D2's busiest is now the earlier month
    back_days = {d: (r, mappings(backward, d)) for d, (r, _) in days.items()}
    source = HistoricalSource(
        GC, files, sessions[:1], sessions[1:], ExecutionConfig(), cache=FakeCache(back_days)
    )
    assert [c.contract for c in source.chunks()] == ["GCG7", "GCG7", "GCG7"]  # forward only


def test_roll_volume_uses_session_assignment_and_records_its_files(monkeypatch):
    """Regression (PR #62 review): a trade that arrives within the close delay after the close
    still counts toward that session's volume, and files read only to choose the front
    contract are part of the run's provenance."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
    close = DAY0 + 20 * HOUR
    session = Session(D1, DAY0, close, DAY0 - 4 * HOUR)
    rows = [
        (1, close - 10_000_000, b"B", 2000.0, 5, 30_000_000),  # received 20 ms after the close
        (2, DAY0 + HOUR, b"B", 2010.0, 4),
    ]
    days = {D1: (records(rows), mappings({"GCZ6": 1, "GCG7": 2}, D1))}
    source = HistoricalSource(GC, {D1: dbn_file(D1)}, [], [session], config, cache=FakeCache(days))
    assert source.outright_volumes(session) == {"GCZ6": 5, "GCG7": 4}
    assert list(source.used_files) == [f"{D1}.dbn"]


def test_malformed_trade_records_are_rejected_and_reported(monkeypatch):
    """Regression (PR #63 review): a record with an undefined price or no size never reaches
    aggregation or roll volumes; each session reports how many it rejected."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
    session = Session(D1, DAY0, DAY0 + 20 * HOUR, DAY0 - 4 * HOUR)
    rows = [
        (1, DAY0 + HOUR, b"B", 2000.0, 5),
        (1, DAY0 + HOUR + 1, b"B", 2000.0, 7),  # undefined price below
        (1, DAY0 + HOUR + 2, b"A", 2000.0, 9),  # zero size below
        (1, DAY0 + HOUR + 3, b"A", -1.5, 2),  # a negative price is a valid futures price
    ]
    r = records(rows)
    r["price"][1] = UNDEF_PRICE
    r["size"][2] = 0
    days = {D1: (r, mappings({"GCZ6": 1}, D1))}
    source = HistoricalSource(
        GC, {D1: dbn_file(D1)}, [], [session], config, "GCZ6", cache=FakeCache(days)
    )
    trades, _, _, rejected = source.session_trades("GCZ6", session)
    assert trades.size.tolist() == [5, 2]
    assert rejected == {"undefined_price": 1, "nonpositive_size": 1}
    assert source.outright_volumes(session) == {"GCZ6": 7}
    [chunk] = list(source.chunks())
    assert source.quality[chunk.session]["rejected_trades"] == rejected


def write_job(root: Path, job_id: str, start: int, end: int) -> None:
    folder = root / job_id
    folder.mkdir(parents=True)
    name, content = "glbx-mdp3-20260901.tbbo.dbn.zst", job_id.encode()
    (folder / name).write_bytes(content)
    digest = "sha256:" + hashlib.sha256(content).hexdigest()
    files = [{"filename": name, "size": len(content), "hash": digest}]
    (folder / "manifest.json").write_text(json.dumps({"job_id": job_id, "files": files}))
    query = {"dataset": "GLBX.MDP3", "schema": "tbbo", "symbols": ["GC.FUT"]}
    query |= {"stype_in": "parent", "start": start, "end": end}
    (folder / "metadata.json").write_text(json.dumps({"query": query}))


def test_jobs_covering_different_parts_of_a_day_are_refused(tmp_path):
    """Regression (PR #63 review): one file is read per day, so two jobs that each cover part
    of the same UTC day are refused instead of half read; identical days are duplicates."""
    write_job(tmp_path, "A", DAY0 - 86_400 * NS, DAY0 + 86_400 * NS)
    write_job(tmp_path, "B", DAY0, DAY0 + 86_400 * NS)  # the same day, whole: a duplicate
    files = catalog.files_for("GC.FUT", "GLBX.MDP3", roots=(tmp_path,))
    assert [(d, f.job_id) for d, f in files.items()] == [(D1, "A")]
    write_job(tmp_path, "C", DAY0 + 12 * HOUR, DAY0 + 86_400 * NS)  # only the afternoon
    with pytest.raises(ValueError, match="different parts of this day"):
        catalog.files_for("GC.FUT", "GLBX.MDP3", roots=(tmp_path,))


def test_file_coverage_stops_at_its_job_range(monkeypatch):
    """Regression (PR #63 review): a job that starts partway through a UTC day delivers only
    that part of it, so earlier seconds are missing, not quiet, and the day's volume is partial."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
    session = Session(D1, DAY0, DAY0 + 20 * HOUR, DAY0 - 4 * HOUR)
    noon = DAY0 + 12 * HOUR
    days = {D1: (records([(1, DAY0 + 13 * HOUR, b"B", 2000.0, 5)]), mappings({"GCZ6": 1}, D1))}
    file = dataclasses.replace(dbn_file(D1), start_ns=noon)
    source = HistoricalSource(GC, {D1: file}, [], [session], config, "GCZ6", cache=FakeCache(days))
    trades, coverage, _, _ = source.session_trades("GCZ6", session)
    assert coverage.tolist() == [[noon, DAY0 + 24 * HOUR]]
    cal = SessionCalendar("t", np.array([DAY0], np.int64), np.array([DAY0 + 20 * HOUR], np.int64))
    ends = cal.slot_ends(DAY0, DAY0 + 20 * HOUR, SECOND)
    bars = aggregate(trades, ends, SECOND, coverage, feed_latency=0, close_delay=config.close_delay)
    status = bars.bars.status
    assert (status[ends <= noon] == MISSING).all() and (status[ends > noon] != MISSING).all()
    assert source.outright_volumes(session) is None  # the morning is unknown: no roll decision
    assert source.session_volumes(session, partial=True) == ({"GCZ6": 5}, False)


def test_front_contract_waits_for_complete_previous_session(monkeypatch):
    """Regression (PR #62 review): a missing day file inside the previous session's scheduled
    hours makes its volume unavailable, so partial totals never decide a roll."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    previous = Session(D1, DAY0 + 22 * HOUR, DAY0 + 45 * HOUR, DAY0 + 21 * HOUR)  # D1 and D2
    session = Session(D3, DAY0 + 46 * HOUR, DAY0 + 69 * HOUR, DAY0 + 45 * HOUR)
    ids = {"GCZ6": 1, "GCG7": 2}
    days = {
        D2: (records([(2, DAY0 + 30 * HOUR, b"B", 2010.0, 9)]), mappings(ids, D2)),
        D3: (records([(1, DAY0 + 50 * HOUR, b"B", 2000.0, 1)]), mappings(ids, D3)),
    }
    files = {d: dbn_file(d) for d in days}  # D1 is missing
    source = HistoricalSource(GC, files, [], [session], ExecutionConfig(), cache=FakeCache(days))
    assert source.outright_volumes(previous) is None
    with pytest.raises(ValueError, match="complete data"):
        source.front_contract(previous, session)
    assert source.front_contract(previous, session, current="GCZ6") == "GCZ6"
    assert source.kept_front == {D3}


def test_roll_volume_ignores_closure_trades_and_needs_mapped_outrights(monkeypatch):
    """Regression (PR #62 review): trades assigned to the closure before the session do not
    count toward roll volume, and an overlapping day file that lists none of the product's
    outrights makes the volume unavailable rather than zero."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    session = Session(D1, DAY0 + 2 * HOUR, DAY0 + 20 * HOUR, DAY0 + HOUR)
    rows = [(1, DAY0 + 90 * 60 * NS, b"B", 2000.0, 50), (2, DAY0 + 3 * HOUR, b"B", 2010.0, 4)]
    days = {D1: (records(rows), mappings({"GCZ6": 1, "GCG7": 2}, D1))}
    source = HistoricalSource(
        GC, {D1: dbn_file(D1)}, [], [session], ExecutionConfig(), cache=FakeCache(days)
    )
    assert source.outright_volumes(session) == {"GCG7": 4}  # the 50-lot closure trade is out
    only_spreads = {D1: (records(rows), mappings({"GCZ6-GCG7": 1}, D1))}
    source = HistoricalSource(
        GC, {D1: dbn_file(D1)}, [], [session], ExecutionConfig(), cache=FakeCache(only_spreads)
    )
    assert source.outright_volumes(session) is None


def run_both_ways(calendar, chunks, config):
    """Whole-session and second-by-second engine runs, for parity checks."""
    whole, stepwise = (Engine(GC, calendar, make_strategy("bias_pullback"), config) for _ in "ab")
    for chunk in chunks:
        whole.process(chunk)
        for second in split_by_second(chunk, calendar, config):
            stepwise.process(second)
    return whole, stepwise


def test_opening_trades_within_the_close_delay_and_closure_trades_are_kept(monkeypatch):
    """Regression (PR #62 review): a trade received during [open, open + close_delay) belongs
    to the first second, and a trade during the preceding closure is reported, not dropped."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
    s1, s2 = DAY0, DAY0 + 2 * HOUR  # sessions [s1, s1 + 1h) and [s2, s2 + 1h)
    calendar = SessionCalendar(
        "test", np.array([s1, s2], np.int64), np.array([s1 + HOUR, s2 + HOUR], np.int64)
    )
    session = Session(D1, s2, s2 + HOUR, s1 + HOUR)
    rows = [
        (1, s1 + HOUR + 30 * 60 * NS, b"B", 2000.0, 7),  # during the scheduled closure
        (1, s2 + 10_000_000, b"B", 2001.0, 3, 10_000_000),  # received 20 ms after the open
        (1, s2 + 5 * NS, b"A", 2000.5, 1),
    ]
    days = {D1: (records(rows), mappings({"GCZ6": 1}, D1))}
    source = HistoricalSource(
        GC, {D1: dbn_file(D1)}, [], [session], config, "GCZ6", cache=FakeCache(days)
    )
    [chunk] = list(source.chunks())
    assert len(chunk.trades) == 3
    ends = calendar.slot_ends(chunk.start, chunk.end, SECOND)
    agg = aggregate(
        chunk.trades, ends, SECOND, chunk.coverage, feed_latency=0, close_delay=config.close_delay
    )
    assert agg.bars.status[0] == OBSERVED and agg.bars.volume[0] == 3
    assert agg.report.outside_schedule == 1 and agg.report.trades == 2
    assert source.quality[chunk.session]["trades"] == 3
    whole, stepwise = run_both_ways(calendar, [chunk], config)
    assert whole.reports == stepwise.reports
    assert whole.reports[chunk.session].outside_schedule == 1


def test_days_without_the_contract_are_missing_not_quiet(monkeypatch):
    """Regression (PR #62 review): a file that does not list the contract leaves its day
    uncovered (missing slots) and is reported, instead of looking like a day without trades."""
    monkeypatch.setattr(DbnFile, "present", property(lambda self: True))
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
    open_, close = DAY0 + 22 * HOUR, DAY0 + 26 * HOUR  # D1 22:00 to D2 02:00 UTC
    calendar = SessionCalendar("test", np.array([open_], np.int64), np.array([close], np.int64))
    session = Session(D2, open_, close, open_ - HOUR)
    days = {
        D1: (records([(1, open_ + 60 * NS, b"B", 2000.0, 1)]), mappings({"GCZ6": 1}, D1)),
        D2: (records([(9, DAY0 + 25 * HOUR, b"B", 2000.0, 1)]), mappings({"GCG7": 9}, D2)),
    }
    files = {d: dbn_file(d) for d in days}
    source = HistoricalSource(GC, files, [], [session], config, "GCZ6", cache=FakeCache(days))
    [chunk] = list(source.chunks())
    assert chunk.coverage.tolist() == [[DAY0, DAY0 + 24 * HOUR]]
    assert source.quality[chunk.session]["contract_unmapped_days"] == ["2026-09-02"]
    whole, stepwise = run_both_ways(calendar, [chunk], config)
    report = whole.reports[chunk.session]
    assert report.missing_slots == 2 * 3600  # every D2 second of the session
    assert whole.reports == stepwise.reports


def test_catalog_reads_job_folders_and_rejects_altered_files(tmp_path, monkeypatch):
    folder = tmp_path / "GLBX.MDP3" / "JOB-1"
    folder.mkdir(parents=True)
    content = b"not really dbn"
    name = "glbx-mdp3-20260901.tbbo.dbn.zst"
    (folder / name).write_bytes(content)
    (folder / "manifest.json").write_text(
        json.dumps(
            {
                "job_id": "JOB-1",
                "files": [
                    {
                        "filename": name,
                        "size": len(content),
                        "hash": "sha256:" + hashlib.sha256(content).hexdigest(),
                    }
                ],
            }
        )
    )
    (folder / "metadata.json").write_text(
        json.dumps(
            {
                "query": {
                    "dataset": "GLBX.MDP3",
                    "schema": "tbbo",
                    "symbols": ["GC.FUT", "NQ.FUT"],
                    "stype_in": "parent",
                    "start": DAY0 + 6 * HOUR,  # a job may start partway through a day
                    "end": DAY0 + 24 * HOUR,
                }
            }
        )
    )
    (folder / "condition.json").write_text(
        json.dumps([{"date": "2026-09-01", "condition": "degraded"}])
    )
    [f] = catalog.discover((tmp_path,))
    assert (f.start_ns, f.end_ns) == (DAY0 + 6 * HOUR, DAY0 + 24 * HOUR)  # the requested range
    monkeypatch.setattr(catalog, "discover", lambda: [f])
    assert catalog.unconfigured_parents() == []  # GC and NQ both have product specs
    assert (f.date, f.parents, f.condition, f.covered) == (
        D1,
        ("GC.FUT", "NQ.FUT"),
        "degraded",
        True,
    )
    catalog.verify(f)
    (folder / name).write_bytes(b"altered!!!!!!!")
    with pytest.raises(ValueError, match="Checksum"):
        catalog.verify(f)


def test_sessions_follow_the_exchange_calendar():
    def utc(text):
        return int(datetime.fromisoformat(text + "+00:00").timestamp()) * NS

    calendar, warmup, trading = load_sessions(
        PRODUCTS["NQ"], date(2026, 11, 25), date(2026, 11, 27), 1
    )
    assert [s.trade_date.isoformat() for s in trading] == ["2026-11-25", "2026-11-26", "2026-11-27"]
    assert warmup[0].trade_date.isoformat() == "2026-11-24"
    # Sessions open 17:00 CT the evening before; Thanksgiving closes 12:00 CT, the next day
    # 12:15 CT (an early close that is not a whole hour).
    assert trading[0].open == utc("2026-11-24T23:00:00")
    assert trading[1].close == utc("2026-11-26T18:00:00")
    assert trading[2].close == utc("2026-11-27T18:15:00")
    assert calendar.close_after(np.array([utc("2026-11-27T10:00:00")]))[0] == trading[2].close


def test_run_spec_validation():
    good = {"product": "GC", "start": "2026-09-01", "end": "2026-09-02"}
    assert service.RunSpec.parse(good).warmup_sessions == 1
    for bad in [
        {**good, "product": "ZZ"},
        {**good, "contract": "GCZ6-GCG7"},
        {**good, "warmup_sessions": 11},
        {**good, "extra": 1},
        {**good, "end": "2028-01-01"},
    ]:
        with pytest.raises(ValueError):
            service.RunSpec.parse(bad)
    with pytest.raises(ValueError):
        service.validate_run_id("../../etc/passwd")


SAMPLE = Path(__file__).resolve().parents[1] / "examples/mgc-sample.json"


@pytest.mark.skipif(
    not (catalog.ROOT / "data/sample/mgc-aug31-dbn").is_dir(),
    reason="bundled sample day not downloaded",
)
def test_sample_day_end_to_end_is_deterministic():
    spec = json.loads(SAMPLE.read_text())
    first, again = service.backtest(spec, save=False), service.backtest(spec, save=False)
    assert first["id"] == again["id"] and first["trades"] == again["trades"]
    q = first["quality"]["2026-08-31 MGCZ6"]
    assert first["performance"]["seconds_processed"] == 23 * 3600
    assert q["missing_slots"] == 2 * 3600  # the session opens 2 h before the file's UTC day
    assert q["outside_schedule"] == 0 and q["raw_receive_order_violations"] == 0
    assert 0.09 < q["unknown_side_volume"] / q["volume"] < 0.11
    assert first["summary"]["trades"] > 0 and first["candidates"]["rows"] > 0
    names = {f["name"] for f in first["feature_specs"]}
    assert set(first["trades"][0]["features"]) == names


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "RUNS", tmp_path)
    monkeypatch.setattr(server, "describe", lambda: [{"root": "GC"}])
    monkeypatch.setattr(server, "backtest", lambda body: {"id": "x", "echo": body})
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()
    httpd.server_close()


def post(url, body, origin=None, content_type="application/json"):
    headers = {"Content-Type": content_type, **({"Origin": origin} if origin else {})}
    return urlopen(Request(url, data=json.dumps(body).encode(), headers=headers))


def test_api_routes_and_origin_checks(api):
    with urlopen(api + "/api/health") as r:
        assert json.load(r)["status"] == "ok"
    with urlopen(api + "/api/catalog") as r:
        assert json.load(r) == [{"root": "GC"}]
    with urlopen(api + "/api/runs") as r:
        assert json.load(r) == []
    with post(api + "/api/runs", {"product": "GC"}, "http://localhost:4400") as r:
        assert json.load(r)["echo"] == {"product": "GC"}
    for origin, ctype in [
        ("https://example.com", "application/json"),
        ("http://localhost:4400", "text/plain"),
    ]:
        with pytest.raises(HTTPError) as error:
            post(api + "/api/runs", {}, origin, ctype)
        assert error.value.code == 400
        error.value.close()
    for path in ("/api/runs/" + "0" * 24, "/api/nope"):
        with pytest.raises(HTTPError) as error:
            urlopen(api + path)
        assert error.value.code == 404
        error.value.close()
