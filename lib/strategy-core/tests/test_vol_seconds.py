"""The second-resolution volatility family (`vol_1s`): plain-Python references from the stored
second and candle rows and from the trades, the minute stage's daily scale at every minute's last
second, any chunking and checkpoints inside a second's window, scale invariance, the engine's
row-by-row view, and the declared warm-up."""

import math

import numpy as np
import pytest
from helpers import T0, calendar
from strategy_core import warmup
from strategy_core.bars import MISSING, OBSERVED
from strategy_core.engine import split_by_second
from strategy_core.features import FeatureConfig, Unit
from strategy_core.market import MINUTE, NS, PX
from strategy_core.pipeline import Pipeline, StageFeatures
from strategy_core.stage_bar_1m import MinuteBarStage
from strategy_core.stage_bar_1s import BarStage
from strategy_core.stage_candle_1h_1m import HourCandleStage
from strategy_core.stage_candle_1m_1s import FEATURE_COLUMNS as CANDLE_FEATURES
from strategy_core.stage_candle_1m_1s import CandleStage
from strategy_core.stage_vol_1m import FEATURE_COLUMNS as MINUTE_FEATURES
from strategy_core.stage_vol_1s import (
    AVERAGES,
    COLUMNS,
    FEATURE_COLUMNS,
    SESSION,
    VolSecondStage,
    usd_per_price,
    window_rv,
)
from strategy_core.stages import StageContext
from strategy_core.state import from_bytes, to_bytes
from strategy_core.synthetic import random_trades
from strategy_core.windows import COMPLETE, EMPTY
from test_hour_stats import CONFIG, second_trades
from test_minutes import join, regroup
from test_volatility import SMALL, SmallVol, session_chunks, wilder

S = NS


class SmallVolS(VolSecondStage):
    """Short chains, so a few synthetic sessions define every value."""

    SHORT, LONG = 2, 4
    TOD_SESSIONS = 2
    DAY_PERIOD, DAY_RANK = 2, 2


BRANCH = (BarStage, CandleStage, SmallVolS)


def builder(cal, config=SMALL, stages=BRANCH):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=config,
                    stages=stages)  # fmt: skip


@pytest.fixture(scope="module")
def days():
    """Ten 90-minute sessions: the fourth has missing data (no daily true range for it or the
    next), the seventh closes early (its last 30 session minutes add no time-of-day sample), and
    the ninth has no trades for its first 65 minutes (empty windows at a carried price)."""
    hours = [(2 * k, 2 * k + (1.0 if k == 6 else 1.5)) for k in range(10)]
    cal = calendar(*hours)
    end = int(cal.closes[-1])
    t = random_trades(T0, end, seed=31, rate=0.3)
    quiet = int(cal.opens[8])
    t = t.take((t.ts_event < quiet) | (t.ts_event >= quiet + 65 * MINUTE))
    gap = int(cal.opens[3]) + 2000 * S
    cov = np.array([[T0, gap + S // 2], [gap + 40 * S, end]], np.int64)
    return cal, t, cov, session_chunks(cal, t, cov)


def outputs(days, contract="X", stages=BRANCH):
    cal, t, cov, _ = days
    p = builder(cal, stages=stages)
    return [p.process(c) for c in session_chunks(cal, t, cov, contract)]


def test_values_equal_plain_python_references(days):
    """Every second against references from the stored second and candle rows and from the
    trades: per-phase Wilder averages of the true range split at P0 and of the adverse excursions
    (the window's drawdown and drawup from its trades), ATR(2) and ATR(4), the extremes' distances
    and ages, the window estimators, realized volatility from the observed second closes, the
    time-of-day normal from the ATR at each minute's last second, and the daily scale from each
    session's trades."""
    cal, t, cov, _ = days
    out = outputs(days, "SIZ6")
    sec, _ = join(out, "bar_1s")
    cnd, _ = join(out, "candle_1m_1s")
    vol, null = join(out, "vol_1s")
    ends = sec["end_ns"]
    np.testing.assert_array_equal(vol["end_ns"], ends)
    np.testing.assert_array_equal(vol["slot_ordinal"], sec["slot_ordinal"])
    slot, price, _, covered = second_trades(cal, t, cov, ends)
    n = SMALL.atr_period
    status = cnd["status"]
    complete = status == COMPLETE
    assert (status == EMPTY).sum() >= 300 and complete.sum() > 30_000
    for name in FEATURE_COLUMNS:
        gate = np.ones(len(status), bool) if name in SESSION else None
        if gate is None:
            carried = (status == EMPTY) & np.isfinite(vol["atr_price"])
            gate = complete | carried if name in AVERAGES else complete
        assert null[name][~gate].all(), name
        assert (~null[name]).sum() > 300, name
    np.testing.assert_array_equal(null["rv_returns"], ~complete)
    # carried price: the last second close, never across missing data
    carry, last = np.full(len(status), np.nan), math.nan
    for r in range(len(status)):
        if sec["status"][r] == MISSING:
            last = math.nan
        elif sec["status"][r] == OBSERVED:
            last = sec["close"][r] / PX
        carry[r] = last
    first_trade = np.searchsorted(slot, np.arange(len(ends)))  # trades of rows a ... b - 1
    prev: dict[int, float] = {}
    atrs: dict[str, dict] = {k: {} for k in ("tr14", "tr2", "tr4", "bull", "bear", "long", "short")}
    checked = rv_checked = 0
    for r in range(len(status)):
        p = int(cnd["slot_ordinal"][r] % 60)
        if complete[r]:
            ohlc = [cnd[k][r] / PX for k in ("open", "high", "low", "close")]
        elif status[r] == EMPTY and np.isfinite(carry[r]):
            ohlc = [carry[r]] * 4
        else:
            prev.pop(p, None)
            continue
        op, hi, lo, cl = ohlc
        down_path = up_path = 0.0
        if complete[r]:
            a, b = first_trade[max(r - 59, 0)], first_trade[r + 1] if r + 1 < len(ends) else None
            px = price[a:b].astype(float)
            down_path = np.max(np.maximum.accumulate(px) - px) / PX
            up_path = np.max(px - np.minimum.accumulate(px)) / PX
            i_hi, i_lo = np.argmax(px == px.max()), np.argmax(px == px.min())
            assert vol["high_age_s"][r] == r - slot[a + i_hi]
            assert vol["low_age_s"][r] == r - slot[a + i_lo]
            assert vol["extreme_order"][r] == (1 if i_lo < i_hi else -1 if i_hi < i_lo else 0)
            # realized volatility: consecutive observed second closes inside the window
            rows = np.arange(max(r - 59, 0), r + 1)
            closes = sec["close"][rows][sec["status"][rows] == OBSERVED].astype(float)
            rets = [math.log(closes[j] / closes[j - 1]) for j in range(1, len(closes))]
            assert vol["rv_returns"][r] == len(rets)
            if rets:
                rv = math.sqrt(sum(x * x for x in rets)) * 1e4
                assert vol["rv_bps"][r] == pytest.approx(rv, rel=1e-12, abs=1e-12)
                rv_checked += 1
            else:
                assert null["rv_bps"][r] and null["rv_atr"][r]
        p0 = prev.get(p, op)
        tr = hi - lo if p not in prev else max(hi, p0) - min(lo, p0)
        up, down = max(hi, p0) - p0, p0 - min(lo, p0)
        le, se = max(down_path, p0 - lo), max(up_path, hi - p0)
        prev[p] = cl
        avg = {
            "tr14": wilder(atrs["tr14"], p, tr, n),
            "tr2": wilder(atrs["tr2"], p, tr, SmallVolS.SHORT),
            "tr4": wilder(atrs["tr4"], p, tr, SmallVolS.LONG),
            "bull": wilder(atrs["bull"], p, 2 * down, n),
            "bear": wilder(atrs["bear"], p, 2 * up, n),
            "long": wilder(atrs["long"], p, le, n),
            "short": wilder(atrs["short"], p, se, n),
        }
        if not np.isfinite(avg["tr14"]):
            continue
        atr_bps = cnd["atr_bps"][r]
        assert atr_bps == pytest.approx(avg["tr14"] / cl * 1e4, rel=1e-12)
        assert vol["atr_price"][r] / cl * 1e4 == atr_bps  # the candle's own ATR, to the bit
        assert vol["atr_usd"][r] == pytest.approx(
            vol["atr_price"][r] * 5000, rel=1e-12
        )  # SI: $5,000 per 1.0
        for name, key in (
            ("atr5_bps", "tr2"),
            ("atr50_bps", "tr4"),
            ("bull_atr_bps", "bull"),
            ("bear_atr_bps", "bear"),
            ("long_adverse_atr_bps", "long"),
            ("short_adverse_atr_bps", "short"),
        ):
            want = avg[key] / cl * 1e4
            if np.isfinite(want):
                assert vol[name][r] == pytest.approx(want, rel=1e-10), name
            else:
                assert null[name][r], name
        bull, bear = vol["bull_atr_bps"][r], vol["bear_atr_bps"][r]
        assert (bull + bear) / 2 == pytest.approx(atr_bps, rel=1e-13)  # the ATR, split
        assert vol["bull_bear_skew"][r] == pytest.approx((bull - bear) / (bull + bear))
        if np.isfinite(avg["tr4"]):
            want = math.log(atr_bps / (avg["tr4"] / cl * 1e4))
            assert vol["atr_14_50_log"][r] == pytest.approx(want, rel=1e-9, abs=1e-12)
        if np.isfinite(avg["tr2"]):
            want = math.log(avg["tr2"] / cl * 1e4 / atr_bps)
            assert vol["atr_5_14_log"][r] == pytest.approx(want, rel=1e-9, abs=1e-12)
        if not complete[r]:
            continue

        def in_atr(x, atr_bps=atr_bps, cl=cl):
            return x / cl * 1e4 / atr_bps

        assert vol["tr_atr"][r] == pytest.approx(in_atr(tr), rel=1e-10)
        assert vol["long_excursion_atr"][r] == pytest.approx(in_atr(le), rel=1e-10)
        assert vol["short_excursion_atr"][r] == pytest.approx(in_atr(se), rel=1e-10)
        assert vol["high_dist_atr"][r] == pytest.approx(in_atr(hi - cl), rel=1e-10, abs=1e-12)
        assert vol["low_dist_atr"][r] == pytest.approx(in_atr(cl - lo), rel=1e-10, abs=1e-12)
        park = math.log(hi / lo) / (2 * math.sqrt(math.log(2)))
        assert vol["parkinson_bps"][r] == pytest.approx(park * 1e4, rel=1e-10, abs=1e-12)
        gk = 0.5 * math.log(hi / lo) ** 2 - (2 * math.log(2) - 1) * math.log(cl / op) ** 2
        assert vol["gk_bps"][r] == pytest.approx(math.sqrt(gk) * 1e4, rel=1e-10, abs=1e-12)
        assert vol["spread_atr"][r] == pytest.approx(cnd["spread_bps"][r] / atr_bps)
        if np.isfinite(vol["rv_bps"][r]):
            assert vol["rv_atr"][r] == pytest.approx(vol["rv_bps"][r] / atr_bps, rel=1e-15)
        checked += 1
    assert checked > 20_000 and rv_checked > 20_000
    # the time-of-day normal: samples are the ATR at each minute's last second (ordinal 60 m),
    # keyed by the minute's offset from the session's open; every second of a minute compares its
    # own ATR with that minute's samples from the two previous sessions
    iv = np.searchsorted(cal.opens, ends - S, side="right") - 1
    minute_end = -(-ends // MINUTE) * MINUTE
    key = (minute_end - cal.opens[iv]) // MINUTE - 1
    samples: dict[int, list[float]] = {}
    tod = 0
    for r in range(len(status)):
        atr_bps = cnd["atr_bps"][r]
        got = samples.get(int(key[r]), [])
        if np.isfinite(atr_bps) and len(got) >= SmallVolS.TOD_SESSIONS:
            want = math.log(atr_bps / (sum(got[-2:]) / 2))
            assert vol["atr_tod_log"][r] == pytest.approx(want, rel=1e-9, abs=1e-12)
            tod += 1
        else:
            assert null["atr_tod_log"][r]
        if np.isfinite(atr_bps) and sec["slot_ordinal"][r] % 60 == 0:
            samples.setdefault(int(key[r]), []).append(atr_bps)
    assert tod > 10_000 and key[iv == 6].max() == 59 and key.max() == 89  # early close: none
    # the daily scale from each session's trades
    sessions = []
    for k in range(len(cal.opens)):
        sel = iv[slot] == k
        whole = covered[iv == k].all()
        p = price[sel]
        sessions.append((whole and len(p) > 0, p.max(), p.min(), p[-1]) if len(p) else (False,))
    ranges, atr_of = [], {}
    history: list[float] = []
    for k, s in enumerate(sessions):
        if len(ranges) >= SmallVolS.DAY_PERIOD:
            atr_of[k] = sum(ranges[-2:]) / 2
            if len(history) >= SmallVolS.DAY_RANK:
                h2 = np.array(history[-2:])
                pct = (np.sum(h2 < atr_of[k]) + 0.5 * np.sum(h2 == atr_of[k])) / 2
                atr_of[(k, "pct")] = pct
            history.append(atr_of[k])
        if s[0] and k > 0 and sessions[k - 1][0]:
            pc = sessions[k - 1][3]
            ranges.append((max(s[1], pc) - min(s[2], pc)) / s[3] * 1e4)
    assert len(ranges) == 7 and (5, "pct") in atr_of  # sessions 3 and 4 add none
    daily = 0
    for r in range(0, len(status), 7):  # every seventh second: all phases, every minute offset
        k, end = int(iv[r]), int(ends[r])
        want = atr_of.get(k, math.nan)
        assert (np.isnan(want) and null["day_atr_bps"][r]) or vol["day_atr_bps"][r] == want
        pct = atr_of.get((k, "pct"), math.nan)
        assert (np.isnan(pct) and null["day_atr_pct"][r]) or vol["day_atr_pct"][r] == pct
        so_far = (iv == k) & (ends <= end)
        sel = (iv[slot] == k) & (ends[slot] <= end)
        if not (complete[r] and np.isfinite(want) and covered[so_far].all() and sel.any()):
            assert null["day_high_dist"][r] and null["day_range_ratio"][r]
            continue
        close = int(cnd["close"][r])
        high, low = price[sel].max(), price[sel].min()
        assert vol["day_high_dist"][r] == pytest.approx((high - close) / close * 1e4 / want,
                                                        rel=1e-10, abs=1e-12)  # fmt: skip
        assert vol["day_low_dist"][r] == pytest.approx((close - low) / close * 1e4 / want,
                                                       rel=1e-10, abs=1e-12)  # fmt: skip
        if k > 0 and sessions[k - 1][0]:
            pc = sessions[k - 1][3]
            tr = (max(high, pc) - min(low, pc)) / close * 1e4
            assert vol["day_range_ratio"][r] == pytest.approx(tr / want, rel=1e-10)
            daily += 1
        else:
            assert null["day_range_ratio"][r]
    assert daily > 1500


def test_the_daily_scale_equals_the_minute_stage_at_each_minute_end(days):
    """The daily ATR, its percentile, and the session's levels against it are the same at both
    resolutions: `vol_1s` at a minute's last second (ordinal 60 m) equals `vol_1m` at minute m,
    to the bit, NULLs included."""
    stages = (BarStage, MinuteBarStage, CandleStage, HourCandleStage, SmallVol, SmallVolS)
    out = outputs(days, stages=stages)
    sec, sn = join(out, "vol_1s")
    mins, mn = join(out, "vol_1m")
    at = np.searchsorted(sec["end_ns"], mins["end_ns"])
    np.testing.assert_array_equal(sec["end_ns"][at], mins["end_ns"])
    np.testing.assert_array_equal(sec["slot_ordinal"][at], 60 * mins["slot_ordinal"])
    both = (sec["status"][at] == COMPLETE) & (mins["status"] == COMPLETE)
    assert both.sum() > 500
    for name in ("day_atr_bps", "day_atr_pct"):
        np.testing.assert_array_equal(sn[name][at], mn[name], err_msg=name)
        np.testing.assert_array_equal(sec[name][at], mins[name], err_msg=name)
        assert (~mn[name]).sum() > 100, name
    for name in ("day_range_ratio", "day_high_dist", "day_low_dist"):  # the same close
        np.testing.assert_array_equal(sn[name][at][both], mn[name][both], err_msg=name)
        np.testing.assert_array_equal(sec[name][at][both], mins[name][both], err_msg=name)
        assert (~mn[name][both]).sum() > 100, name


def test_window_rv_by_hand():
    """Returns pair consecutive observed closes; none crosses missing data (row 4) or enters a
    window from before it. Windows of four rows, ending at rows 3 ... 7."""
    status = np.array([2, 1, 2, 2, 0, 2, 2, 1], np.int8)
    close = np.array([100, 0, 110, 99, 0, 101, 101, 0], np.int64)
    rv2, count = np.empty(5), np.empty(5, np.int64)
    window_rv(status, close, 3, 4, rv2, count)
    r1, r2 = math.log(110 / 100), math.log(99 / 110)
    assert count.tolist() == [2, 1, 1, 1, 1]
    assert rv2[0] == r1 * r1 + r2 * r2 and rv2[1] == r2 * r2 and rv2[2] == r2 * r2
    assert rv2[3] == 0.0 and rv2[4] == 0.0  # 101 -> 101: a zero return


def test_identical_in_any_chunking_and_from_checkpoints_inside_a_window(days):
    cal, _, _, chunks = days
    whole = outputs(days)
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    parts = regroup(seconds, [6631])  # cuts fall inside minutes and inside every window
    first = builder(cal)
    head = [first.process(c) for c in parts[:4]]
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[4:]]
    a, an = join(whole, "vol_1s")
    for name in (*FEATURE_COLUMNS, "atr_price"):  # undefined floats are NaN, as stored NULL
        assert an[name].any() and np.array_equal(np.isnan(a[name]), an[name]), name
    for other in (stepwise, head + tail):
        b, bn = join(other, "vol_1s")
        for k in a:
            np.testing.assert_array_equal(a[k], b[k], err_msg=k)
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{k} NULL")


def test_features_are_scale_invariant_and_declare_units(days):
    cal, t, cov, _ = days

    def run(scale):
        p = builder(cal)
        return join([p.process(c) for c in session_chunks(cal, t.scaled(**scale), cov)],
                    "vol_1s")[0]  # fmt: skip

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
    # the engine reads both second stages under one prefix: no feature name collides
    names = [*CANDLE_FEATURES, *FEATURE_COLUMNS]
    assert len(set(names)) == len(names)
    assert not {c.name for c in COLUMNS if not c.unit} & set(FEATURE_COLUMNS)
    # ... and both resolutions share their names, plus realized volatility at 1m@1s
    assert set(FEATURE_COLUMNS) - set(MINUTE_FEATURES) == {"rv_bps", "rv_atr"}
    assert set(MINUTE_FEATURES) <= set(FEATURE_COLUMNS)
    assert usd_per_price("SIZ6") == 5000.0 and math.isnan(usd_per_price("X"))


def test_the_engine_reads_the_stored_volatility_row_by_row(days, monkeypatch):
    """`1m@1s.<name>` at a second is the stored `vol_1s` row of that second, NULL as NaN."""
    for name in ("SHORT", "LONG", "TOD_SESSIONS", "DAY_PERIOD", "DAY_RANK"):
        monkeypatch.setattr(VolSecondStage, name, getattr(SmallVolS, name))
    cal, _, _, chunks = days
    engine = StageFeatures(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL)
    frames = [engine.update(c) for c in chunks]
    frame = frames[0].concat(frames)
    names = {s.name for s in engine.specs()}
    assert {f"1m@1s.{n}" for n in FEATURE_COLUMNS} <= names
    assert {f"1m@1s.{n}" for n in CANDLE_FEATURES} <= names
    assert names == set(frame.features)
    vol, null = join(outputs(days), "vol_1s")
    np.testing.assert_array_equal(frame.end, vol["end_ns"])
    for n in FEATURE_COLUMNS:
        got = frame.features[f"1m@1s.{n}"]
        np.testing.assert_array_equal(np.isnan(got), null[n], err_msg=n)  # NULL is NaN, never 0
        np.testing.assert_array_equal(got[~null[n]], vol[n][~null[n]], err_msg=n)
        assert null[n].any() and (~null[n]).any(), n


def test_the_declared_warmup_follows_the_chains():
    """Production parameters: the daily percentile's 35 sessions count as whole days, 37 typical GC
    sessions, inside the 40-session lead, as for `vol_1m`; the `1m@1s` ATR(50) needs 392 minutes
    and the time-of-day normal the ATR(14) (108 minutes) and 20 sessions. Each chain lengthens
    with its parameter."""
    ctx = StageContext(None, 0, 0, FeatureConfig())
    stage = VolSecondStage(ctx)
    assert stage.warmup() == 35 * 86_400
    assert warmup.sessions(stage.warmup(), 1, 82_800) == 37 <= 40
    assert warmup.wilder(50) * 60 < (108 * 60 + 20 * 86_400) < stage.warmup()

    class Longer(VolSecondStage):
        LONG = 10_000

    assert Longer(ctx).warmup() == warmup.wilder(10_000) * 60 > stage.warmup()


def test_the_declared_warmup_settles_every_value():
    """Built from two session opens, every value agrees (the same NULLs, values within the
    tolerance) once the later start has run the stage's declared warm-up, and something still
    differs at half of it. Short chains (`SmallVolS`) on 23-hour sessions, where the daily
    percentile (2 + 1 + 2 sessions) is the longest."""
    cal = calendar(*((24 * d, 24 * d + 23) for d in range(8)))
    stage = SmallVolS(StageContext(cal, 0, CONFIG.close_delay, SMALL))
    assert stage.warmup() == 5 * 86_400
    later = int(cal.opens[1])
    settled = later + stage.warmup() * NS
    end = int(cal.closes[-1])
    assert settled < end
    t = random_trades(T0, end, seed=6, rate=0.2)
    cov = np.array([[T0, end]], np.int64)

    def build(start):
        p = builder(cal)
        out = [p.process(c) for c in session_chunks(cal, t, cov) if c.start >= start]
        return join(out, "vol_1s")[0]

    a, b = build(T0), build(later)

    def worst(after: int) -> float:
        sa, sb = a["end_ns"] > after, b["end_ns"] > after
        np.testing.assert_array_equal(a["end_ns"][sa], b["end_ns"][sb])
        out = 0.0
        for name in FEATURE_COLUMNS:
            x, y = a[name][sa], b[name][sb]
            if not np.array_equal(np.isfinite(x), np.isfinite(y)):
                return math.inf  # defined in one build only
            both = np.isfinite(x)
            if both.any():
                scale = max(np.nanpercentile(x, 99) - np.nanpercentile(x, 1), 1e-12)
                out = max(out, np.max(np.abs(x[both] - y[both])) / scale)
        return out

    assert worst(settled) <= warmup.TOLERANCE
    assert worst(later + stage.warmup() * NS // 2) > warmup.TOLERANCE
    sa = a["end_ns"] > settled
    assert all(np.isfinite(a[n][sa]).any() for n in FEATURE_COLUMNS)
