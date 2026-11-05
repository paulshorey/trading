"""The hourly window statistics (`stats_1h_1m`): direct references from the trades, any chunking
and checkpoints inside a minute, the session levels, scale invariance, the engine's view, and the
declared warm-up."""

import numpy as np
import pytest
from helpers import T0, TICK, calendar, trades
from strategy_core import warmup
from strategy_core.bars import assignment_times
from strategy_core.engine import MarketChunk, split_by_second
from strategy_core.execution import ExecutionConfig
from strategy_core.features import FeatureConfig, Unit
from strategy_core.market import HOUR, MINUTE, NS, PX
from strategy_core.pipeline import Pipeline, StageFeatures
from strategy_core.stage_bar_1m import MinuteBarStage
from strategy_core.stage_bar_1s import BarStage
from strategy_core.stage_candle_1h_1m import FEATURE_COLUMNS as CANDLE_FEATURES
from strategy_core.stage_candle_1h_1m import HourCandleStage
from strategy_core.stage_stats_1h_1m import (
    COLUMNS,
    FEATURE_COLUMNS,
    MIN_RETURNS,
    VR_PERIOD,
    HourStatsStage,
)
from strategy_core.stages import StageContext
from strategy_core.state import from_bytes, to_bytes
from strategy_core.synthetic import random_trades
from strategy_core.windows import COMPLETE
from test_minutes import join, regroup

CONFIG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100)
S = NS
BRANCH = (BarStage, MinuteBarStage, HourCandleStage, HourStatsStage)
SMALL = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)


def builder(cal, config=SMALL):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=config,
                    stages=BRANCH)  # fmt: skip


@pytest.fixture(scope="module")
def world():
    """Four sessions: complete, with missing data inside a minute, complete, and complete again
    after a closure that is not a whole hour; quiet minutes; sweeps."""
    cal = calendar((0, 1.25), (2, 3.5), (4, 5.5), (5.75, 7.5))
    end = T0 + int(7.5 * HOUR)
    t = random_trades(T0, end, seed=23, rate=1.2)
    quiet = T0 + int(4.5 * HOUR)
    t = t.take((t.ts_event < quiet) | (t.ts_event >= quiet + 150 * S))
    sweeps = np.flatnonzero(t.side > 0)[::40]
    t.ask[sweeps] -= TICK
    t.bid[sweeps] -= TICK
    gap = T0 + 2 * HOUR + 1800 * S
    cov = np.array([[T0, gap + S // 2], [gap + 40 * S, end]], np.int64)
    chunks = []
    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
        chunks.append(MarketChunk("X", o, c, t.take((at >= o) & (at < c)), cov))
    return cal, t, cov, chunks


def outputs(world):
    cal, _, _, chunks = world
    p = builder(cal)
    return [p.process(c) for c in chunks]


def second_trades(cal, t, cov, ends):
    """The trades each scheduled second holds, directly: its index in `ends` (seconds in
    order), in receive order, dropping trades outside the schedule or in uncovered seconds."""
    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    slot = np.searchsorted(ends, at, side="right")
    ok = slot < len(ends)
    ok[ok] &= ends[slot[ok]] - S <= at[ok]
    start = ends - S
    covered = np.zeros(len(ends), bool)
    for a, b in cov:
        covered |= (start >= a) & (ends <= b)
    ok[ok] &= covered[slot[ok]]
    index = np.flatnonzero(ok)
    index = index[np.argsort(slot[index], kind="stable")]
    return slot[index], t.price[index], t.size[index], covered


def test_window_statistics_equal_direct_references(world):
    """Every complete window against references computed from the trades: realized volatility
    from the one-second closes, the drawdown, drawup, and extreme positions from the window's
    trade sequence, the session VWAP and the previous session's levels from the session's
    trades; the minute-return statistics and the flow correlation from the minute closes."""
    cal, t, cov, _ = world
    out = outputs(world)
    sec, _ = join(out, "bar_1s")
    mins, _ = join(out, "bar_1m")
    hour, _ = join(out, "candle_1h_1m")
    st, null = join(out, "stats_1h_1m")
    ends = sec["end_ns"]
    slot, price, size, covered = second_trades(cal, t, cov, ends)
    last = np.r_[slot[1:] != slot[:-1], True]  # the last trade of each second, in receive order
    closes = np.zeros(len(ends), np.int64)
    closes[slot[last]] = price[last]
    has = np.zeros(len(ends), bool)
    has[slot] = True
    o_sec = sec["slot_ordinal"]
    complete = st["status"] == COMPLETE
    assert complete.sum() > 200 and (~complete).sum() > 100
    for name in FEATURE_COLUMNS:  # features only for complete windows
        assert null[name][~complete].all(), name
    iv = np.searchsorted(cal.opens, ends - S, side="right") - 1
    checked = {k: 0 for k in ("rv", "path", "returns", "corr", "vwap", "prior")}
    for row in np.flatnonzero(complete):
        mo = int(st["slot_ordinal"][row])
        lo = np.searchsorted(o_sec, 60 * mo - 3599)
        hi = np.searchsorted(o_sec, 60 * mo) + 1
        assert hi - lo == 3600
        atr, close = hour["atr_bps"][row], int(hour["close"][row])
        priced = np.isfinite(atr) and atr > 0  # the ATR is defined
        # realized volatility: consecutive observed one-second closes inside the window
        c = closes[lo:hi][has[lo:hi]].astype(float)
        r = np.diff(np.log(c))
        assert st["rv_returns"][row] == len(r)
        if len(r):
            want = np.sqrt(np.sum(r * r)) * 1e4
            assert st["rv_bps"][row] == pytest.approx(want, rel=1e-10)
            if priced:
                assert st["rv_atr"][row] == pytest.approx(want / atr, rel=1e-10)
            checked["rv"] += 1
        # the path of the window's trades, in assignment then receive order
        inside = (slot >= lo) & (slot < hi)
        p = price[inside]
        assert p[-1] == close
        down = np.max(np.maximum.accumulate(p) - p)
        up = np.max(p - np.minimum.accumulate(p))
        first_high = slot[inside][np.argmax(p == p.max())]
        first_low = slot[inside][np.argmax(p == p.min())]
        assert st["high_pos"][row] == pytest.approx((first_high - lo) / 3599, abs=1e-15)
        assert st["low_pos"][row] == pytest.approx((first_low - lo) / 3599, abs=1e-15)
        if priced:
            assert st["drawdown_atr"][row] == pytest.approx(down / close * 1e4 / atr, rel=1e-10)
            assert st["drawup_atr"][row] == pytest.approx(up / close * 1e4 / atr, rel=1e-10)
            checked["path"] += 1
        # minute returns: closes carried from the window's first observed minute on
        mrow = np.searchsorted(mins["slot_ordinal"], mo)
        window = slice(mrow - 59, mrow + 1)
        observed = mins["status"][window] == 2
        px = np.where(observed, mins["close"][window], 0)
        first = int(np.argmax(observed))
        carried = np.maximum.accumulate(np.where(observed, np.arange(60), -1))[first:]
        px = px[carried].astype(float)
        r = np.diff(np.log(px))
        assert st["minute_returns"][row] == len(r) == 59 - first
        if len(r) >= MIN_RETURNS and r.std() > 0:
            d = r - r.mean()
            assert st["ret_std_bps"][row] == pytest.approx(r.std() * 1e4, rel=1e-10)
            skew = np.mean(d**3) / np.mean(d**2) ** 1.5
            assert st["ret_skew"][row] == pytest.approx(skew, rel=1e-8, abs=1e-9)
            ac = np.sum(d[1:] * d[:-1]) / np.sum(d * d)
            assert st["ret_autocorr"][row] == pytest.approx(ac, rel=1e-8, abs=1e-9)
            q, n = VR_PERIOD, len(r)
            sums = np.convolve(r, np.ones(q), "valid")  # overlapping q-minute returns
            m = q * (n - q + 1) * (1 - q / n)
            vr = (np.sum((sums - q * r.mean()) ** 2) / m) / (np.sum(d * d) / (n - 1))
            assert st["vr_5"][row] == pytest.approx(vr, rel=1e-8)
            moved = r != 0
            assert st["up_minute_ratio"][row] == pytest.approx((r > 0).sum() / moved.sum())
            checked["returns"] += 1
        net = (mins["buy_volume"][window] - mins["sell_volume"][window]).astype(float)
        cvd = np.cumsum(net)[first:]
        if len(px) > MIN_RETURNS and px.std() > 0 and cvd.std() > 0:
            corr = np.corrcoef(px, cvd)[0, 1]
            assert st["cvd_close_corr"][row] == pytest.approx(corr, rel=1e-8, abs=1e-9)
            checked["corr"] += 1
        # the session so far and the previous session, from their trades
        end = int(st["end_ns"][row])
        k = iv[hi - 1]
        seconds = np.flatnonzero((iv == k) & (ends <= end))
        if covered[seconds].all():
            sel = (iv[slot] == k) & (ends[slot] <= end)
            vwap = np.sum(price[sel] / PX * size[sel]) / np.sum(size[sel])
            assert st["session_vwap"][row] == pytest.approx(vwap, rel=1e-12)
            if priced:
                want = (close / PX - vwap) / (close / PX) * 1e4 / atr
                assert st["session_vwap_atr"][row] == pytest.approx(want, rel=1e-9, abs=1e-12)
                checked["vwap"] += 1
        else:
            assert null["session_vwap"][row] and null["session_vwap_atr"][row]
        before = iv == k - 1
        if before.any() and covered[before].all():
            sel = iv[slot] == k - 1
            levels = (price[sel].max(), price[sel].min(), price[sel][-1])
            got = (st["prior_high"][row], st["prior_low"][row], st["prior_close"][row])
            assert got == levels
            for name, level in zip(("high", "low", "close"), levels, strict=True):
                if priced:
                    want = (close - level) / close * 1e4 / atr
                    got = st[f"prior_{name}_atr"][row]
                    assert got == pytest.approx(want, rel=1e-9, abs=1e-12)
            checked["prior"] += priced
        else:
            assert null["prior_high"][row] and null["prior_close_atr"][row]
    assert min(checked.values()) > 50, checked


def test_identical_in_any_chunking_and_from_checkpoints_inside_a_minute(world):
    cal, _, _, chunks = world
    whole = outputs(world)
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    parts = regroup(seconds, [630])  # every cut falls inside a minute
    first = builder(cal)
    head = [first.process(c) for c in parts[:5]]
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[5:]]
    a, an = join(whole, "stats_1h_1m")
    for name in (*FEATURE_COLUMNS, "session_vwap"):  # undefined floats are NaN, as stored NULL
        assert an[name].any() and np.array_equal(np.isnan(a[name]), an[name]), name
    for other in (stepwise, head + tail):
        b, bn = join(other, "stats_1h_1m")
        for k in a:
            np.testing.assert_array_equal(a[k], b[k], err_msg=k)
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{k} NULL")


def test_session_levels_by_hand():
    """Four one-hour sessions. The first: 10.0 x 2, 12.0, 11.0. The second has missing data at
    20 minutes. The previous session counts only when complete, and a session the stage did not
    see from its open is not complete."""
    cal = calendar((0, 1), (2, 3), (4, 5), (6, 7))
    rows = [
        (T0 + 610 * S, 10.0, 2, 1),
        (T0 + 1800 * S, 12.0, 1, 1),
        (T0 + 3540 * S, 11.0, 1, -1),
        (T0 + 2 * HOUR + 600 * S, 13.0, 1, 1),
        (T0 + 4 * HOUR + 300 * S, 14.0, 1, 1),
        (T0 + 6 * HOUR + 300 * S, 15.0, 1, 1),
    ]
    missing = T0 + 2 * HOUR + 1200 * S
    cov = np.array([[T0, missing], [missing + 30 * S, T0 + 7 * HOUR]], np.int64)
    chunk = MarketChunk("X", T0, T0 + 7 * HOUR, trades(rows), cov)
    st = builder(cal).process(chunk).tables["stats_1h_1m"]
    v, null = st.values, st.nulls
    assert len(v["end_ns"]) == 240

    def at(hours, minutes):
        return int(np.flatnonzero(v["end_ns"] == T0 + int(hours * HOUR) + minutes * MINUTE)[0])

    assert null["session_vwap"][: at(0, 10) + 1].all()  # no trade yet
    assert v["session_vwap"][at(0, 11)] == 10.0
    assert v["session_vwap"][at(1, 0)] == pytest.approx((20 + 12 + 11) / 4)
    assert null["prior_high"][: at(1, 0) + 1].all()  # no previous session
    s2 = slice(at(2, 1), at(3, 0) + 1)
    assert (v["prior_high"][s2] == 12 * PX).all() and (v["prior_low"][s2] == 10 * PX).all()
    assert (v["prior_close"][s2] == 11 * PX).all()
    assert v["session_vwap"][at(2, 20)] == 13.0
    assert null["session_vwap"][at(2, 21) : at(3, 0) + 1].all()  # missing data ends it
    assert null["prior_high"][at(4, 1) : at(5, 0) + 1].all()  # the previous one was incomplete
    s4 = slice(at(6, 1), at(7, 0) + 1)
    assert (v["prior_high"][s4] == 14 * PX).all() and (v["prior_close"][s4] == 14 * PX).all()
    assert v["session_vwap"][at(7, 0)] == 15.0
    # a stage started inside the first session never saw its open
    late = MarketChunk("X", T0 + 1200 * S, T0 + 7 * HOUR, trades(rows), cov)
    st = builder(cal).process(late).tables["stats_1h_1m"]
    first, after = st.values["end_ns"] <= T0 + HOUR, st.values["end_ns"] > T0 + 2 * HOUR
    assert st.nulls["session_vwap"][first].all()
    assert st.nulls["prior_high"][after & (st.values["end_ns"] <= T0 + 3 * HOUR)].all()


def test_features_are_scale_invariant_and_declare_units():
    hours = 27
    cal = calendar((0, hours), (hours + 1, 2 * hours + 1))
    end = T0 + (2 * hours + 1) * HOUR
    t = random_trades(T0, end, seed=4, rate=0.3)
    cov = np.array([[T0, end]], np.int64)

    def run(scale):
        p = builder(cal)
        out = []
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
            sel = (t.ts_event >= o) & (t.ts_event < c)
            out.append(p.process(MarketChunk("X", o, c, t.take(sel).scaled(**scale), cov)))
        return join(out, "stats_1h_1m")[0]

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
    assert all(c.unit in units for c in COLUMNS if c.unit)
    assert len({c.name for c in COLUMNS}) == len(COLUMNS)
    # the engine reads both hourly stages under one prefix: their feature names never collide
    assert not set(FEATURE_COLUMNS) & set(CANDLE_FEATURES)


def test_the_engine_reads_the_stored_statistics_as_of_each_second(world):
    """`1h@1m.<name>` at a second is the stored row of the latest completed minute."""
    cal, _, _, chunks = world
    engine = StageFeatures(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL)
    frames = [engine.update(c) for c in chunks]
    frame = frames[0].concat(frames)
    names = {s.name for s in engine.specs()}
    assert {f"1h@1m.{n}" for n in FEATURE_COLUMNS} <= names
    assert names == set(frame.features)
    p = builder(cal)
    st, null = join([p.process(c) for c in chunks], "stats_1h_1m")
    ends = frame.end
    at = np.searchsorted(ends, st["end_ns"])
    np.testing.assert_array_equal(ends[at], st["end_ns"])
    for n in FEATURE_COLUMNS:
        got = frame.features[f"1h@1m.{n}"][at]
        np.testing.assert_array_equal(np.isnan(got), null[n], err_msg=n)  # NULL is NaN, never 0
        np.testing.assert_array_equal(got[~null[n]], st[n][~null[n]], err_msg=n)
        assert null[n].any() and (~null[n]).any(), n
    assert np.isfinite(frame.features["1h@1m.rv_bps"]).sum() > 1000


def test_the_declared_warmup_settles_every_statistic():
    """Built from two session opens, every statistic agrees once the later start has run the
    stage's declared warm-up (the hourly ATR(14): 108 periods), and still differs at half of it.
    The previous session's levels need one whole session, the window's own values one hour."""
    cal = calendar(*((24 * d, 24 * d + 23) for d in range(9)))
    stage = HourStatsStage(StageContext(cal, 0, CONFIG.close_delay, FeatureConfig()))
    assert stage.warmup() == 108 * 3600
    later = int(cal.opens[1])
    settled = later + stage.warmup() * NS
    end = int(cal.closes[-1])
    assert settled < end
    t = random_trades(T0, end, seed=6, rate=0.3)
    cov = np.array([[T0, end]], np.int64)

    def build(start):
        p = builder(cal, FeatureConfig())
        out = []
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
            if o < start:
                continue
            sel = (t.ts_event >= o) & (t.ts_event < c)
            out.append(p.process(MarketChunk("X", o, c, t.take(sel), cov)))
        return join(out, "stats_1h_1m")[0]

    a, b = build(T0), build(later)

    def worst(after: int, names=FEATURE_COLUMNS) -> float:
        sa, sb = a["end_ns"] > after, b["end_ns"] > after
        np.testing.assert_array_equal(a["end_ns"][sa], b["end_ns"][sb])
        out = 0.0
        for name in names:
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
    # values without the ATR are exact after one hour; the previous session's after a session
    window = [n for n in FEATURE_COLUMNS if not n.endswith("_atr")]
    sa, sb = a["end_ns"] > int(cal.opens[2]), b["end_ns"] > int(cal.opens[2])
    np.testing.assert_array_equal(a["prior_close"][sa], b["prior_close"][sb])
    assert worst(later + HOUR, window) == 0.0
