"""Stored one-second rows: chunking, checkpoints, units, and per-phase parity."""

import numpy as np
import pytest
from helpers import T0, TICK, calendar, wilder_rsi_reference
from strategy_core.bars import MISSING, assignment_times
from strategy_core.engine import MarketChunk, split_by_second
from strategy_core.execution import ExecutionConfig
from strategy_core.features import Unit
from strategy_core.indicators import FEATURES
from strategy_core.market import HOUR, NS, PX, Trades
from strategy_core.pipeline import Pipeline, PipelineRows
from strategy_core.stage_bar_1s import COLUMNS as BASE_COLUMNS
from strategy_core.stage_candle_1m_1s import COLUMNS as CANDLE_COLUMNS
from strategy_core.stage_candle_1m_1s import FEATURE_COLUMNS
from strategy_core.state import from_bytes, same_state, to_bytes
from strategy_core.synthetic import random_trades
from strategy_core.windows import COMPLETE

CONFIG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)


def builder(cal):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay)


def states(p: Pipeline) -> dict[str, dict]:
    return {name: p.export(name) for name in p.stages}


def same_states(a: dict[str, dict], b: dict[str, dict]) -> bool:
    return a.keys() == b.keys() and all(same_state(a[n], b[n]) for n in a)


def join(parts: list[PipelineRows]) -> dict[str, dict[str, np.ndarray]]:
    out = {}
    for table in parts[0].tables:
        out[table] = {
            k: np.concatenate([p.tables[table].values[k] for p in parts])
            for k in parts[0].tables[table].values
        }
        out[table + "_null"] = {
            k: np.concatenate([p.tables[table].nulls[k] for p in parts])
            for k in parts[0].tables[table].nulls
        }
    return out


def assert_same(a, b):
    for table in a:
        assert a[table].keys() == b[table].keys()
        for k, v in a[table].items():
            np.testing.assert_array_equal(v, b[table][k], err_msg=f"{table}.{k}")


def regroup(seconds: list[MarketChunk], sizes: list[int]) -> list[MarketChunk]:
    """Merge consecutive one-second chunks into chunks of the given sizes, cycling."""
    out, i, k = [], 0, 0
    while i < len(seconds):
        group = seconds[i : i + sizes[k % len(sizes)]]
        first, last = group[0], group[-1]
        trades = Trades.concat([g.trades for g in group])
        out.append(MarketChunk(first.contract, first.start, last.end, trades, first.coverage))
        i, k = i + len(group), k + 1
    return out


@pytest.fixture(scope="module")
def session():
    cal = calendar((0, 0.5), (0.6, 1.2))  # two sessions with a 6-minute closure
    t = random_trades(T0, T0 + 4320 * NS, seed=9, rate=2)
    sweeps = np.flatnonzero(t.side > 0)[::40]  # some buyers print above the pre-trade ask
    t.ask[sweeps] -= TICK
    t.bid[sweeps] -= TICK
    cov = np.array([[T0, T0 + 1000 * NS], [T0 + 1100 * NS, T0 + 4320 * NS]], np.int64)
    close = T0 + int(0.5 * HOUR)
    first = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay) < close
    chunks = [  # each session carries the trades assigned to it, as HistoricalSource does
        MarketChunk("X", T0, close, t.take(first), cov),
        MarketChunk("X", close, T0 + int(1.2 * HOUR), t.take(~first), cov),
    ]
    return cal, chunks


def test_any_chunking_gives_identical_rows_and_state(session):
    cal, chunks = session
    b = builder(cal)
    whole = join([b.process(c) for c in chunks])
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    s = builder(cal)
    stepwise = join([s.process(c) for c in regroup(seconds, [1, 7, 59, 300, 1, 1000])])
    assert_same(whole, stepwise)
    assert same_states(states(b), states(s))
    candle = whole["candle_1m_1s"]
    finite = {k: np.isfinite(v).any() for k, v in candle.items() if k in FEATURE_COLUMNS}
    assert all(finite.values()), [k for k, ok in finite.items() if not ok]


def test_checkpoint_restores_exactly(session):
    cal, chunks = session
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    parts = regroup(seconds, [600])
    full = builder(cal)
    uninterrupted = join([full.process(c) for c in parts])
    first = builder(cal)
    head = [first.process(c) for c in parts[:2]]
    saved = {name: from_bytes(to_bytes(state)) for name, state in states(first).items()}
    resumed = builder(cal)
    for name, state in saved.items():  # each stage resumes from its own checkpoint
        resumed.restore(name, state)
    assert same_states(states(resumed), states(first))
    tail = [resumed.process(c) for c in parts[2:]]
    assert_same(join(head + tail), uninterrupted)


def test_features_are_scale_invariant_and_declare_units(session):
    cal, chunks = session

    def run(scale):
        b = builder(cal)
        parts = []
        for c in chunks:
            t = c.trades.scaled(**scale)
            parts.append(b.process(MarketChunk(c.contract, c.start, c.end, t, c.coverage)))
        return join(parts)["candle_1m_1s"]

    base = run({})
    for scale in ({"price_factor": 3}, {"size_factor": 7}):
        other = run(scale)
        for name in FEATURE_COLUMNS:
            np.testing.assert_allclose(
                other[name], base[name], rtol=1e-9, atol=1e-9, equal_nan=True, err_msg=name
            )
    units = {u.value for u in Unit}
    assert all(c.unit in units for c in CANDLE_COLUMNS if c.unit)
    assert {u for _, u, _ in FEATURES} <= units
    assert len({c.name for c in BASE_COLUMNS}) == len(BASE_COLUMNS)
    assert len({c.name for c in CANDLE_COLUMNS}) == len(CANDLE_COLUMNS)


def test_nulls_follow_status_and_validity(session):
    cal, chunks = session
    rows = join([builder(cal).process(c) for c in chunks])
    base, nulls = rows["bar_1s"], rows["bar_1s_null"]
    missing = base["status"] == MISSING
    assert missing.any() and (base["status"] == 1).any()
    assert nulls["volume"][missing].all() and not nulls["volume"][~missing].any()
    assert nulls["close"][base["status"] != 2].all()
    assert (nulls["spread_sum"] == (missing | (base["quote_trades"] == 0))).all()
    # session CVD restarts at each session open and is unknown after missing data
    second = base["end_ns"] > T0 + int(0.6 * HOUR)
    first_missing = int(np.flatnonzero(missing)[0])
    assert nulls["session_cvd"][first_missing:][~second[first_missing:]].all()
    s2 = np.flatnonzero(second)
    net = base["buy_volume"][s2] - base["sell_volume"][s2]
    np.testing.assert_array_equal(base["session_cvd"][s2], np.cumsum(net))
    assert not nulls["session_cvd"][s2].any()


def phase_series(candle, phase, n):
    """Rows of one phase where it and its previous n - 1 same-phase candles are complete."""
    rows = np.flatnonzero(candle["status"] == COMPLETE)
    rows = rows[(candle["slot_ordinal"][rows] % 60) == phase]
    return rows


def test_per_phase_indicators_equal_references_on_the_phase_series():
    cal = calendar((0, 2))
    t = random_trades(T0, T0 + 2 * HOUR, seed=21, rate=3)
    cov = np.array([[T0, T0 + 2 * HOUR]], np.int64)
    rows = builder(cal).process(MarketChunk("X", T0, T0 + 2 * HOUR, t, cov))
    c = rows.tables["candle_1m_1s"].values
    phase = 17
    sel = np.flatnonzero((c["slot_ordinal"] % 60) == phase)
    assert (c["status"][sel][1:] == COMPLETE).all()  # every candle of the series is complete
    close, high, low = (c[k][sel] / PX for k in ("close", "high", "low"))
    atr = c["atr_bps"][sel] * close / 1e4
    j = len(sel) - 1  # the last candle of the series, well past every warmup
    # RSI and the midpoint RSI follow the pinned Wilder reference on this series
    ref = wilder_rsi_reference(list(close[1:]), 14)
    assert c["rsi"][sel][j] == pytest.approx(ref[-1])
    # EMA(21) distance in ATRs
    ema = close[1]
    for x in close[2:]:
        ema += 2 / 22 * (x - ema)
    assert c["ema21_atr"][sel][j] == pytest.approx((close[j] - ema) / atr[j])
    # Stochastic %K(14), Bollinger z(20), Donchian(20) over the prior periods
    hh, ll = high[j - 13 : j + 1].max(), low[j - 13 : j + 1].min()
    assert c["stoch_k"][sel][j] == pytest.approx(100 * (close[j] - ll) / (hh - ll))
    window = close[j - 19 : j + 1]
    assert c["bb_z"][sel][j] == pytest.approx((close[j] - window.mean()) / window.std())
    phh, pll = high[j - 20 : j].max(), low[j - 20 : j].min()
    assert c["donchian_pos"][sel][j] == pytest.approx((close[j] - pll) / (phh - pll))
    # Linear regression R squared and the efficiency ratio
    y = close[j - 19 : j + 1]
    fit = np.polyval(np.polyfit(np.arange(20), y, 1), np.arange(20))
    r2 = 1 - np.sum((y - fit) ** 2) / np.sum((y - y.mean()) ** 2)
    assert c["linreg_r2"][sel][j] == pytest.approx(max(r2, 0.0), abs=1e-9)
    er = abs(close[j] - close[j - 10]) / np.abs(np.diff(close[j - 10 : j + 1])).sum()
    assert c["er"][sel][j] == pytest.approx(er)
    # ADX(14): Wilder averages seeded with simple means, compared in exact price units
    h, lo, cl = (c[k][sel][1:].astype(float) for k in ("high", "low", "close"))
    assert c["adx"][sel][j] == pytest.approx(adx_reference(h, lo, cl, 14))


def adx_reference(h, lo, c, n):
    trs, pdms, mdms, dxs = [], [], [], []
    tr = pdm = mdm = adx = 0.0
    for i in range(1, len(c)):
        up, down = h[i] - h[i - 1], lo[i - 1] - lo[i]
        p = up if up > down and up > 0 else 0.0
        m = down if down > up and down > 0 else 0.0
        t = max(h[i], c[i - 1]) - min(lo[i], c[i - 1])
        trs.append(t)
        pdms.append(p)
        mdms.append(m)
        k = len(trs)
        if k <= n:
            tr, pdm, mdm = np.mean(trs), np.mean(pdms), np.mean(mdms)
        else:
            tr, pdm, mdm = (tr * (n - 1) + t) / n, (pdm * (n - 1) + p) / n, (mdm * (n - 1) + m) / n
        if k < n:
            continue
        a, b = 100 * pdm / tr, 100 * mdm / tr
        dxs.append(100 * abs(a - b) / (a + b) if a + b else 0.0)
        adx = np.mean(dxs) if len(dxs) <= n else (adx * (n - 1) + dxs[-1]) / n
    return adx


def test_quiet_windows_after_missing_data_have_no_latest_observation():
    """Regression (PR #63 review): an empty window after missing data has no current trade or
    book, while an empty window after covered quiet seconds keeps the last one with its age."""
    cal = calendar((0, 0.1))  # six open minutes
    t = random_trades(T0, T0 + 30 * NS, seed=2, rate=2)  # trades only in the first 30 s
    end = T0 + 360 * NS

    def build(cov):
        rows = builder(cal).process(MarketChunk("X", T0, end, t, cov))
        c = rows.tables["candle_1m_1s"].values
        return c, c["status"] == 1  # EMPTY windows: covered, no trades

    quiet, empty = build(np.array([[T0, end]], np.int64))
    assert empty.any() and np.isfinite(quiet["trade_age_s"][empty]).all()
    assert np.isfinite(quiet["book_spread_bps"][empty]).all()
    gapped, empty = build(np.array([[T0, T0 + 40 * NS], [T0 + 50 * NS, end]], np.int64))
    assert empty.any()
    for name in ("trade_age_s", "book_age_s", "depth_age_s", "book_spread_bps", "book_imbalance"):
        assert np.isnan(gapped[name][empty]).all(), name
