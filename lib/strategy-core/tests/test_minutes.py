"""Minute rows (`bar_1m`) and the rolling `1h@1m` candle (`candle_1h_1m`): exact merges of the
second rows, closures and missing data, checkpoints inside a minute, scale invariance, and the
declared warm-up."""

import math

import numpy as np
import pytest
from helpers import T0, TICK, calendar, trades
from strategy_core import warmup
from strategy_core.bars import MISSING, NO_TRADES, OBSERVED, assignment_times
from strategy_core.engine import MarketChunk, split_by_second
from strategy_core.execution import ExecutionConfig
from strategy_core.features import FeatureConfig, Unit
from strategy_core.market import HOUR, MINUTE, NS, PX, Trades
from strategy_core.metrics import FIELDS
from strategy_core.pipeline import Pipeline
from strategy_core.stage_bar_1m import COLUMNS as MINUTE_COLUMNS
from strategy_core.stage_bar_1m import MinuteBarStage
from strategy_core.stage_bar_1s import RENAME, BarStage
from strategy_core.stage_candle_1h_1m import COLUMNS as HOUR_COLUMNS
from strategy_core.stage_candle_1h_1m import FEATURE_COLUMNS, HourCandleStage
from strategy_core.stages import StageContext
from strategy_core.state import from_bytes, to_bytes
from strategy_core.synthetic import random_trades
from strategy_core.window_metrics import MetricWindow
from strategy_core.windows import COMPLETE, EMPTY, GAP, WARMUP

CONFIG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
S = NS
MINUTE_BRANCH = (BarStage, MinuteBarStage, HourCandleStage)


def builder(cal, stages=None, config=None):
    kw = {"stages": stages} if stages else {}
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=config, **kw)


def join(parts, table):
    keys = parts[0].tables[table].values
    values = {k: np.concatenate([p.tables[table].values[k] for p in parts]) for k in keys}
    nulls = {
        k: np.concatenate([p.tables[table].nulls.get(k, np.zeros(len(p.tables[table]), bool))
                           for p in parts])
        for k in keys
    }  # fmt: skip
    return values, nulls


def regroup(seconds: list[MarketChunk], sizes: list[int]) -> list[MarketChunk]:
    out, i, k = [], 0, 0
    while i < len(seconds):
        group = seconds[i : i + sizes[k % len(sizes)]]
        t = Trades.concat([g.trades for g in group])
        out.append(MarketChunk("X", group[0].start, group[-1].end, t, group[0].coverage))
        i, k = i + len(group), k + 1
    return out


def test_a_hand_checked_minute():
    """Three minutes: four trades in the first, none in the second, missing data in the third."""
    cal = calendar((0, 0.05))
    rows = [
        (T0 + int(0.2 * S), 100.0, 2, 1),
        (T0 + int(0.5 * S), 100.3, 1, -1),
        (T0 + int(10.1 * S), 99.8, 3, -1),
        (T0 + int(30.5 * S), 100.1, 1, 1),
        (T0 + 170 * S, 101.0, 1, 1),
    ]
    cov = np.array([[T0, T0 + 150 * S], [T0 + 160 * S, T0 + 180 * S]], np.int64)
    out = builder(cal).process(MarketChunk("X", T0, T0 + 180 * S, trades(rows), cov))
    m, null = out.tables["bar_1m"].values, out.tables["bar_1m"].nulls
    assert m["slot_ordinal"].tolist() == [1, 2, 3]
    assert m["end_ns"].tolist() == [T0 + MINUTE, T0 + 2 * MINUTE, T0 + 3 * MINUTE]
    assert m["status"].tolist() == [OBSERVED, NO_TRADES, MISSING]

    def px(x):
        return round(x * PX)

    first = {k: v[0] for k, v in m.items()}
    assert [first[k] for k in ("open", "high", "low", "close")] == [
        px(100.0), px(100.3), px(99.8), px(100.1)
    ]  # fmt: skip
    assert (first["high_at_ns"], first["low_at_ns"]) == (T0 + int(0.5 * S), T0 + int(10.1 * S))
    flow = ("volume", "buy_volume", "sell_volume", "trades")
    assert [first[k] for k in flow] == [7, 3, 4, 4]
    assert first["pv"] == pytest.approx(699.8)
    assert (first["delta_high"], first["delta_low"], first["session_cvd"]) == (2, -2, -1)
    assert first["observed_seconds"] == 3 and first["max_size"] == 3
    # the price path within the first second plus the bridges between observed seconds
    assert first["path_abs"] == px(0.3) + px(0.5) + px(0.3)
    assert (first["upticks"], first["downticks"]) == (2, 1)
    assert (first["side_pairs"], first["side_switches"]) == (3, 2)
    assert (first["drawdown"], first["drawup"], first["extreme_order"]) == (px(0.5), px(0.3), -1)
    assert (first["first_side"], first["last_side"]) == (1, 1)
    # one-second returns: closes 100.3, 99.8, 100.1 of the three observed seconds
    assert first["first_close"] == px(100.3)
    assert first["ret_count"] == 2
    want = math.log(99.8 / 100.3) ** 2 + math.log(100.1 / 99.8) ** 2
    assert first["ret2_sum"] == pytest.approx(want, rel=1e-12)
    # a minute without trades: zero activity, no prices, session CVD carried
    assert (m["volume"][1], m["observed_seconds"][1], m["ret_count"][1], m["ret2_sum"][1]) == (
        0, 0, 0, 0.0
    )  # fmt: skip
    assert null["open"][1] and null["first_close"][1] and null["max_size"][1]
    assert not null["volume"][1] and not null["session_cvd"][1] and m["session_cvd"][1] == -1
    # a minute with a missing second stores only its keys and status
    stored = {c.name for c in MINUTE_COLUMNS if not null.get(c.name, np.zeros(3, bool))[2]}
    assert stored == {"slot_ordinal", "end_ns", "status"}
    # the hourly candle needs 60 minutes; a window with missing data is a gap
    h = out.tables["candle_1h_1m"].values
    assert h["status"].tolist() == [WARMUP] * 3
    assert h["observed"].tolist() == [3, 3, 3]


@pytest.fixture(scope="module")
def sessions():
    """Two sessions with a closure, missing coverage inside a minute, minutes without trades,
    and sweeps."""
    cal = calendar((0, 1.25), (6, 8.5))
    t = random_trades(T0, T0 + int(8.5 * HOUR), seed=17, rate=1.5)
    quiet = T0 + int(6.5 * HOUR)
    t = t.take((t.ts_event < quiet) | (t.ts_event >= quiet + 180 * S))  # minutes without trades
    sweeps = np.flatnonzero(t.side > 0)[::40]
    t.ask[sweeps] -= TICK
    t.bid[sweeps] -= TICK
    cov = np.array([[T0, T0 + 1000 * S + S // 2], [T0 + 1130 * S, T0 + int(8.5 * HOUR)]], np.int64)
    close = T0 + int(1.25 * HOUR)
    first = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay) < close
    chunks = [
        MarketChunk("X", T0, close, t.take(first), cov),
        MarketChunk("X", close, T0 + int(8.5 * HOUR), t.take(~first), cov),
    ]
    return cal, chunks


def test_minutes_equal_the_window_that_ends_with_them_in_any_chunking(sessions):
    """Every field of a minute equals `MetricWindow(60)` (the `1m@1s` window's metrics) and the
    `1m@1s` candle at the second ordinal 60m, and session CVD the second row there; any chunking
    gives the same minute and hour rows."""
    cal, chunks = sessions
    p = builder(cal)
    whole = [p.process(c) for c in chunks]
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    for table in ("bar_1m", "candle_1h_1m"):
        a, an = join(whole, table)
        b, bn = join(stepwise, table)
        for k in a:
            np.testing.assert_array_equal(a[k], b[k], err_msg=f"{table}.{k}")
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{table}.{k} NULL")

    m, null = join(whole, "bar_1m")
    sec, sec_null = join(whole, "bar_1s")
    candle, _ = join(whole, "candle_1m_1s")
    bars = [w.products["bars"] for w in whole]
    window = MetricWindow(60)
    win = [window.update(b, w.products["metrics"]) for b, w in zip(bars, whole, strict=True)]
    win = {k: np.concatenate([w[k] for w in win]) for k in win[0]}
    at = np.searchsorted(sec["slot_ordinal"], 60 * m["slot_ordinal"])
    np.testing.assert_array_equal(sec["slot_ordinal"][at], 60 * m["slot_ordinal"])
    ok = m["status"] != MISSING
    assert (~ok).sum() == 3 and (m["status"] == NO_TRADES).sum() >= 2
    for f in FIELDS:
        name = RENAME.get(f.name, f.name)
        np.testing.assert_array_equal(m[name][ok], win[f.name][at][ok], err_msg=f.name)
    np.testing.assert_array_equal(m["observed_seconds"][ok], win["observed"][at][ok])
    np.testing.assert_array_equal(m["session_cvd"][ok], sec["session_cvd"][at][ok])
    np.testing.assert_array_equal(null["session_cvd"], sec_null["session_cvd"][at] | ~ok)
    # the fields both store equal the 1m@1s candle that ends with the minute
    pairs = {k: k for k in ("open", "high", "low", "close", "high_at_ns", "low_at_ns")}
    pairs |= {k: k for k in ("volume", "buy_volume", "sell_volume", "trades")}
    pairs |= {"delta_high": "delta_high", "delta_low": "delta_low", "observed_seconds": "observed"}
    for mine, theirs in pairs.items():
        np.testing.assert_array_equal(m[mine][ok], candle[theirs][at][ok], err_msg=mine)
    traded = ok & (m["volume"] > 0)
    np.testing.assert_array_equal(m["pv"][traded] / m["volume"][traded], candle["vwap"][at][traded])
    want_status = np.where(m["status"] == OBSERVED, COMPLETE, EMPTY)
    np.testing.assert_array_equal(candle["status"][at][ok], want_status[ok])


def test_minute_ordinals_continue_across_an_early_close(sessions):
    """After an early close (1:15) and a reopen (6:00), the 6:01 hourly candle covers 0:16-1:15
    and 6:00-6:01, and its previous same-phase candle is exactly 60 rows earlier."""
    cal, chunks = sessions
    p = builder(cal)
    out = [p.process(c) for c in chunks]
    m, _ = join(out, "bar_1m")
    h, _ = join(out, "candle_1h_1m")
    assert len(m["end_ns"]) == 75 + 150
    np.testing.assert_array_equal(np.diff(m["slot_ordinal"]), 1)  # closures add no rows
    reopen = int(np.flatnonzero(m["end_ns"] == T0 + 6 * HOUR + MINUTE)[0])
    assert m["slot_ordinal"][reopen] == m["slot_ordinal"][reopen - 1] + 1
    assert h["start_ns"][reopen] == T0 + 16 * MINUTE
    assert h["end_ns"][reopen - 60] == T0 + 16 * MINUTE
    assert h["slot_ordinal"][reopen] % 60 == h["slot_ordinal"][reopen - 60] % 60
    assert (h["status"] == GAP).any() and (h["status"] == COMPLETE).any()


def test_checkpoints_restore_a_half_finished_minute(sessions):
    cal, chunks = sessions
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    parts = regroup(seconds, [630])  # every cut falls inside a minute
    full = builder(cal)
    uninterrupted = [full.process(c) for c in parts]
    first = builder(cal)
    head = [first.process(c) for c in parts[:3]]
    assert len(first.stages["bar_1m"].pending) == 30
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[3:]]
    for table in ("bar_1m", "candle_1h_1m"):
        a, an = join(uninterrupted, table)
        b, bn = join(head + tail, table)
        for k in a:
            np.testing.assert_array_equal(a[k], b[k], err_msg=f"{table}.{k}")
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{table}.{k}")


def test_hourly_features_are_scale_invariant_and_declare_units():
    hours = 55  # long enough for EMA(50) of hourly periods
    cal = calendar((0, hours))
    t = random_trades(T0, T0 + hours * HOUR, seed=4, rate=0.3)
    sweeps = np.flatnonzero(t.side > 0)[::40]
    t.ask[sweeps] -= TICK
    t.bid[sweeps] -= TICK
    cov = np.array([[T0, T0 + hours * HOUR]], np.int64)
    cfg = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)

    def run(scale):
        chunk = MarketChunk("X", T0, T0 + hours * HOUR, t.scaled(**scale), cov)
        return builder(cal, MINUTE_BRANCH, cfg).process(chunk).tables["candle_1h_1m"].values

    base = run({})
    undefined = [n for n in FEATURE_COLUMNS if not np.isfinite(base[n]).any()]
    assert not undefined, undefined
    for scale in ({"price_factor": 3}, {"size_factor": 7}):
        other = run(scale)
        for name in FEATURE_COLUMNS:
            np.testing.assert_allclose(
                other[name], base[name], rtol=1e-9, atol=1e-9, equal_nan=True, err_msg=name
            )
    units = {u.value for u in Unit}
    assert all(c.unit in units for c in HOUR_COLUMNS if c.unit)
    assert not {"session_ret_bps", "trade_age_s", "book_age_s"} & set(FEATURE_COLUMNS)
    assert len({c.name for c in HOUR_COLUMNS}) == len(HOUR_COLUMNS)
    assert len({c.name for c in MINUTE_COLUMNS}) == len(MINUTE_COLUMNS)
    assert not any(c.unit for c in MINUTE_COLUMNS)  # base rows hold data, not model inputs


def test_the_declared_warmup_settles_every_hourly_feature():
    """Built from two session opens, every hourly feature agrees once the later start has run
    the stage's declared warm-up (217 hourly periods with the default settings: ADX), and still
    differs at half of it. Sessions are processed one at a time, as ingest does."""
    cal = calendar(*((24 * d, 24 * d + 23) for d in range(12)))
    stage = HourCandleStage(StageContext(cal, 0, CONFIG.close_delay, FeatureConfig()))
    assert stage.warmup() == 217 * 3600
    later = int(cal.opens[1])
    settled = later + stage.warmup() * NS
    end = int(cal.closes[-1])
    assert settled < end
    t = random_trades(T0, end, seed=6, rate=0.3)
    cov = np.array([[T0, end]], np.int64)

    def build(start):
        p = builder(cal, MINUTE_BRANCH)
        out = []
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
            if o < start:
                continue
            sel = (t.ts_event >= o) & (t.ts_event < c)
            out.append(p.process(MarketChunk("X", o, c, t.take(sel), cov)))
        return join(out, "candle_1h_1m")[0]

    a, b = build(T0), build(later)

    def worst(after: int) -> float:
        sa, sb = a["end_ns"] > after, b["end_ns"] > after
        np.testing.assert_array_equal(a["end_ns"][sa], b["end_ns"][sb])
        out = 0.0
        for name in FEATURE_COLUMNS:
            x, y = a[name][sa], b[name][sb]
            both = np.isfinite(x) & np.isfinite(y)
            if both.any():
                scale = max(np.nanpercentile(x, 99) - np.nanpercentile(x, 1), 1e-12)
                out = max(out, np.max(np.abs(x[both] - y[both])) / scale)
        return out

    sa, sb = a["end_ns"] > settled, b["end_ns"] > settled
    for name in FEATURE_COLUMNS:
        np.testing.assert_array_equal(np.isfinite(a[name][sa]), np.isfinite(b[name][sb]), name)
    assert worst(settled) <= warmup.TOLERANCE
    assert worst(later + stage.warmup() * NS // 2) > warmup.TOLERANCE
