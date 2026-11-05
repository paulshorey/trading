"""The volatility family (`vol_1m`, `volatility.py`): plain-Python references from the stored
candle rows and the trades, the kernels and the daily scale by hand, any chunking and checkpoints
inside a minute, scale invariance, the engine's view, and the declared warm-up."""

import math

import numpy as np
import pytest
from helpers import T0, calendar
from strategy_core import kernels, warmup
from strategy_core.bars import MISSING, OBSERVED
from strategy_core.engine import MarketChunk, split_by_second
from strategy_core.features import FeatureConfig, Unit
from strategy_core.market import MINUTE, NS, PX
from strategy_core.pipeline import Pipeline, StageFeatures
from strategy_core.stage_bar_1m import MinuteBarStage
from strategy_core.stage_bar_1s import BarStage
from strategy_core.stage_candle_1h_1m import FEATURE_COLUMNS as CANDLE_FEATURES
from strategy_core.stage_candle_1h_1m import HourCandleStage
from strategy_core.stage_stats_1h_1m import FEATURE_COLUMNS as STATS_FEATURES
from strategy_core.stage_vol_1m import (
    AVERAGES,
    COLUMNS,
    FEATURE_COLUMNS,
    SESSION,
    VolMinuteStage,
    usd_per_price,
)
from strategy_core.stages import StageContext
from strategy_core.state import export_state, from_bytes, import_state, to_bytes
from strategy_core.synthetic import random_trades
from strategy_core.volatility import DailyScale, TimeOfDay, garman_klass, parkinson, split_atr
from strategy_core.windows import COMPLETE, EMPTY
from test_hour_stats import CONFIG, second_trades
from test_minutes import join, regroup

S = NS
SMALL = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)


class SmallVol(VolMinuteStage):
    """Short chains, so a few synthetic sessions define every value."""

    SHORT, LONG = 2, 4
    TOD_SESSIONS = 2
    DAY_PERIOD, DAY_RANK = 2, 2


BRANCH = (BarStage, MinuteBarStage, HourCandleStage, SmallVol)


def builder(cal, config=SMALL, stage=SmallVol):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=config,
                    stages=(*BRANCH[:3], stage))  # fmt: skip


def session_chunks(cal, t, cov, contract="X"):
    from strategy_core.bars import assignment_times

    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    return [
        MarketChunk(contract, o, c, t.take((at >= o) & (at < c)), cov)
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True)
    ]


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


def outputs(days, contract="X"):
    cal, t, cov, _ = days
    p = builder(cal)
    return [p.process(c) for c in session_chunks(cal, t, cov, contract)]


def wilder(state: dict, p: int, x: float, n: int) -> float:
    """Plain-Python Wilder average of one phase: the mean of the first n values, then Wilder."""
    seen = state.setdefault(p, [])
    if len(seen) < n:
        seen.append(x)
        state[(p, "avg")] = sum(seen) / n
    else:
        state[(p, "avg")] = (state[(p, "avg")] * (n - 1) + x) / n
    return state[(p, "avg")] if len(seen) >= n else math.nan


def test_values_equal_plain_python_references(days):
    """Every row against references from the stored candle and minute rows and from the trades:
    per-phase Wilder averages of the true range split at P0 and of the adverse excursions (the
    window's drawdown and drawup from its trades), ATR(2) and ATR(4), the extremes' distances and
    ages, the window estimators, the time-of-day normal, and the daily scale from each session's
    trades."""
    cal, t, cov, _ = days
    out = outputs(days, "GCZ6")
    sec, _ = join(out, "bar_1s")
    mins, _ = join(out, "bar_1m")
    hour, _ = join(out, "candle_1h_1m")
    vol, null = join(out, "vol_1m")
    ends = sec["end_ns"]
    slot, price, _, covered = second_trades(cal, t, cov, ends)
    o_sec = sec["slot_ordinal"]
    n = SMALL.atr_period
    status = hour["status"]
    complete = status == COMPLETE
    assert (status == EMPTY).sum() >= 5 and complete.sum() > 500
    for name in FEATURE_COLUMNS:
        gate = np.ones(len(status), bool) if name in SESSION else None
        if gate is None:
            carried = (status == EMPTY) & np.isfinite(vol["atr_price"])
            gate = complete | carried if name in AVERAGES else complete
        assert null[name][~gate].all(), name
        assert (~null[name]).sum() > 30, name
    # carried price: the last minute close, never across missing data
    carry, last = np.full(len(status), np.nan), math.nan
    for r in range(len(status)):
        if mins["status"][r] == MISSING:
            last = math.nan
        elif mins["status"][r] == OBSERVED:
            last = mins["close"][r] / PX
        carry[r] = last
    prev = {}
    atrs = {k: {} for k in ("tr14", "tr2", "tr4", "bull", "bear", "long", "short")}
    iv_sec = np.searchsorted(cal.opens, ends - S, side="right") - 1
    checked = 0
    for r in range(len(status)):
        p = int(hour["slot_ordinal"][r] % 60)
        if complete[r]:
            ohlc = [hour[k][r] / PX for k in ("open", "high", "low", "close")]
        elif status[r] == EMPTY and np.isfinite(carry[r]):
            ohlc = [carry[r]] * 4
        else:
            prev.pop(p, None)
            continue
        op, hi, lo, cl = ohlc
        down_path = up_path = 0.0
        if complete[r]:
            mo = int(hour["slot_ordinal"][r])
            a = np.searchsorted(o_sec, 60 * mo - 3599)
            b = np.searchsorted(o_sec, 60 * mo) + 1
            inside = (slot >= a) & (slot < b)
            px = price[inside].astype(float)
            down_path = np.max(np.maximum.accumulate(px) - px) / PX
            up_path = np.max(px - np.minimum.accumulate(px)) / PX
            first_high = slot[inside][np.argmax(px == px.max())]
            first_low = slot[inside][np.argmax(px == px.min())]
            assert vol["high_age_s"][r] == b - 1 - first_high
            assert vol["low_age_s"][r] == b - 1 - first_low
            i_hi, i_lo = np.argmax(px == px.max()), np.argmax(px == px.min())
            assert vol["extreme_order"][r] == (1 if i_lo < i_hi else -1 if i_hi < i_lo else 0)
        p0 = prev.get(p, op)
        tr = hi - lo if p not in prev else max(hi, p0) - min(lo, p0)
        up, down = max(hi, p0) - p0, p0 - min(lo, p0)
        le, se = max(down_path, p0 - lo), max(up_path, hi - p0)
        prev[p] = cl
        avg = {
            "tr14": wilder(atrs["tr14"], p, tr, n),
            "tr2": wilder(atrs["tr2"], p, tr, SmallVol.SHORT),
            "tr4": wilder(atrs["tr4"], p, tr, SmallVol.LONG),
            "bull": wilder(atrs["bull"], p, 2 * down, n),
            "bear": wilder(atrs["bear"], p, 2 * up, n),
            "long": wilder(atrs["long"], p, le, n),
            "short": wilder(atrs["short"], p, se, n),
        }
        if not np.isfinite(avg["tr14"]):
            continue
        atr_bps = hour["atr_bps"][r]
        assert atr_bps == pytest.approx(avg["tr14"] / cl * 1e4, rel=1e-12)
        assert vol["atr_price"][r] / cl * 1e4 == atr_bps  # the candle's own ATR, to the bit
        assert vol["atr_usd"][r] == pytest.approx(
            vol["atr_price"][r] * 100, rel=1e-12
        )  # GC: $100 per 1.0
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
        assert vol["spread_atr"][r] == pytest.approx(hour["spread_bps"][r] / atr_bps)
        checked += 1
    assert checked > 300
    # the time-of-day normal: the same session minute's ATR in the two previous sessions
    iv = np.searchsorted(cal.opens, hour["end_ns"] - MINUTE, side="right") - 1
    key = (hour["end_ns"] - cal.opens[iv]) // MINUTE - 1
    samples: dict[int, list[float]] = {}
    tod = 0
    for r in range(len(status)):
        atr_bps = hour["atr_bps"][r]
        got = samples.get(int(key[r]), [])
        if np.isfinite(atr_bps) and len(got) >= SmallVol.TOD_SESSIONS:
            want = math.log(atr_bps / (sum(got[-2:]) / 2))
            assert vol["atr_tod_log"][r] == pytest.approx(want, rel=1e-9, abs=1e-12)
            tod += 1
        else:
            assert null["atr_tod_log"][r]
        if np.isfinite(atr_bps):
            samples.setdefault(int(key[r]), []).append(atr_bps)
    assert tod > 300 and key[iv == 6].max() == 59 and key.max() == 89  # the early close: none
    # the daily scale from each session's trades
    sessions = []
    for k in range(len(cal.opens)):
        sel = iv_sec[slot] == k
        whole = covered[iv_sec == k].all()
        p = price[sel]
        sessions.append((whole and len(p) > 0, p.max(), p.min(), p[-1]) if len(p) else (False,))
    ranges, atr_of = [], {}
    history: list[float] = []
    for k, s in enumerate(sessions):
        if len(ranges) >= SmallVol.DAY_PERIOD:
            atr_of[k] = sum(ranges[-2:]) / 2
            if len(history) >= SmallVol.DAY_RANK:
                h2 = np.array(history[-2:])
                pct = (np.sum(h2 < atr_of[k]) + 0.5 * np.sum(h2 == atr_of[k])) / 2
                atr_of[(k, "pct")] = pct
            history.append(atr_of[k])
        if s[0] and k > 0 and sessions[k - 1][0]:
            pc = sessions[k - 1][3]
            ranges.append((max(s[1], pc) - min(s[2], pc)) / s[3] * 1e4)
    assert len(ranges) == 7 and (5, "pct") in atr_of  # sessions 3 and 4 add none
    daily = 0
    for r in range(len(status)):
        k, end = int(iv[r]), int(hour["end_ns"][r])
        want = atr_of.get(k, math.nan)
        assert (np.isnan(want) and null["day_atr_bps"][r]) or vol["day_atr_bps"][r] == want
        pct = atr_of.get((k, "pct"), math.nan)
        assert (np.isnan(pct) and null["day_atr_pct"][r]) or vol["day_atr_pct"][r] == pct
        so_far = (iv_sec == k) & (ends <= end)
        sel = (iv_sec[slot] == k) & (ends[slot] <= end)
        if not (complete[r] and np.isfinite(want) and covered[so_far].all() and sel.any()):
            assert null["day_high_dist"][r] and null["day_range_ratio"][r]
            continue
        close = int(hour["close"][r])
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
    assert daily > 200


def test_split_atr_is_the_atr_split_at_p0():
    """The kernel against `kernels.wilder_atr` on the same inputs, with resets and phases: the
    true range is identical and (bull + bear) / 2 is the ATR to rounding."""
    rng = np.random.default_rng(3)
    m, phases, n = 2000, 4, 5
    close = 100 + np.cumsum(rng.normal(0, 0.3, m))
    open_ = close + rng.normal(0, 0.2, m)
    high = np.maximum(open_, close) + rng.exponential(0.2, m)
    low = np.minimum(open_, close) - rng.exponential(0.2, m)
    valid = rng.random(m) > 0.05
    phase = np.arange(m) % phases
    dd = (high - low) * rng.random(m)
    du = (high - low) * rng.random(m)
    atr = np.empty(m)
    kernels.wilder_atr(high, low, close, valid, phase, n, np.full(phases, np.nan),
                       np.zeros(phases), np.zeros(phases, np.int64), atr)  # fmt: skip
    out = {k: np.empty(m) for k in ("tr", "p0", "bull", "bear", "long", "short", "le", "se")}
    split_atr(
        open_, high, low, close, dd, du, valid, phase, n, np.full(phases, np.nan),
        *(np.zeros(phases) for _ in range(4)), np.zeros(phases, np.int64), out["tr"], out["p0"],
        out["bull"], out["bear"], out["long"], out["short"], out["le"], out["se"],
    )  # fmt: skip
    ok = np.isfinite(atr)
    np.testing.assert_array_equal(ok, np.isfinite(out["bull"]))
    np.testing.assert_allclose((out["bull"][ok] + out["bear"][ok]) / 2, atr[ok], rtol=1e-13)
    assert np.all(out["le"][valid] >= dd[valid]) and np.all(out["se"][valid] >= du[valid])
    assert np.isnan(out["tr"][~valid]).all()
    # after an invalid window, P0 is the window's first trade and the true range its own range
    after = np.flatnonzero(~valid[:-phases]) + phases
    after = after[valid[after]]
    np.testing.assert_array_equal(out["p0"][after], open_[after])
    np.testing.assert_array_equal(out["tr"][after], high[after] - low[after])


def test_daily_scale_by_hand():
    """Six three-minute sessions (fixed-point prices in whole units). True ranges count from the
    previous session's close, only when both sessions are complete; the third session has missing
    data, so neither it nor the fourth adds one. Daily ATR(2), percentile among 2."""
    cal = calendar(*((k, k + 0.05) for k in range(6)))
    rows = [  # per session: (status, high, low, close) of its three minutes
        [(2, 10, 9, 10), (1, 0, 0, 0), (2, 11, 10, 10)],  # high 11, low 9, close 10
        [(2, 12, 10, 12), (2, 12, 11, 11), (2, 13, 11, 13)],  # 13, 10, 13: TR 13 - 10 = 3
        [(2, 13, 12, 12), (0, 0, 0, 0), (2, 12, 12, 12)],  # missing data: incomplete
        [(2, 15, 12, 14), (2, 14, 14, 14), (2, 14, 13, 14)],  # complete, previous incomplete
        [(2, 16, 14, 16), (2, 16, 15, 15), (2, 15, 14, 15)],  # TR 16 - 14 = 2 (close 14)
        [(2, 15, 15, 15), (2, 15, 15, 15), (2, 15, 15, 15)],
    ]
    ends = np.concatenate([cal.slot_ends(int(o), int(c), MINUTE) for o, c in
                           zip(cal.opens, cal.closes, strict=True)])  # fmt: skip
    flat = np.array([x for s in rows for x in s], np.int64)
    status, high, low, close = (flat[:, i] for i in range(4))
    daily = DailyScale(cal, MINUTE, 2, 2)
    whole = daily.update(ends, status, high * PX, low * PX, close * PX)
    parts = DailyScale(cal, MINUTE, 2, 2)  # one row at a time, from checkpoints
    rows_out = []
    for i in range(len(ends)):
        fresh = DailyScale(cal, MINUTE, 2, 2)
        import_state(fresh, from_bytes(to_bytes(export_state(parts))))
        parts = fresh
        rows_out.append(parts.update(ends[i : i + 1], status[i : i + 1], high[i : i + 1] * PX,
                                     low[i : i + 1] * PX, close[i : i + 1] * PX))  # fmt: skip
    for k in whole:
        np.testing.assert_array_equal(np.concatenate([o[k] for o in rows_out]), whole[k], k)
    assert daily.ranges[0] == pytest.approx(3 / 13 * 1e4)
    assert daily.range_count == 2 and daily.ranges[1] == pytest.approx(2 / 15 * 1e4)
    atr = whole["day_atr_bps"].reshape(6, 3)[:, 0]
    assert np.isnan(atr[:5]).all() and atr[5] == pytest.approx((3 / 13 + 2 / 15) / 2 * 1e4)
    ok = whole["ok"].reshape(6, 3)
    assert ok[0].tolist() == [True, True, True] and ok[2].tolist() == [True, False, False]
    assert whole["high"].reshape(6, 3)[1].tolist() == [12 * PX, 12 * PX, 13 * PX]
    prior = whole["prior"].reshape(6, 3)[:, 0]
    assert prior.tolist() == [False, True, True, False, True, True]
    # the percentile: ATRs 1, 1, then 3 against [1, 1] and 2 against [1, 3]
    d = DailyScale(cal, MINUTE, 1, 2)
    d.ranges, d.range_count = np.array([1.0]), 1
    for x, want in ((1.0, math.nan), (1.0, math.nan), (3.0, 1.0), (2.0, 0.5), (3.0, 0.75)):
        d.ranges = np.array([x])
        d._start(0, int(cal.opens[0]) + MINUTE)
        assert (math.isnan(want) and math.isnan(d.day_pct)) or d.day_pct == want


def test_time_of_day_keeps_the_last_samples_per_key():
    tod = TimeOfDay(2)
    key = np.array([0, 1, 0, 0, 1, 0])
    out = tod.update(
        key, np.array([1.0, 5.0, 3.0, 7.0, 9.0, 0.0]), np.array([1, 1, 1, 1, 1, 0], bool)
    )
    np.testing.assert_array_equal(out[:3], np.nan)
    assert out[3] == 2.0 and np.isnan(out[4]) and out[5] == 5.0  # (3 + 7) / 2
    with pytest.raises(ValueError, match="outside one day"):
        tod.update(np.array([1440]), np.zeros(1), np.ones(1, bool))


def test_window_estimators():
    assert parkinson(np.array([110.0]), np.array([100.0]))[0] == pytest.approx(
        math.log(1.1) / (2 * math.sqrt(math.log(2)))
    )
    flat = garman_klass(np.array([100.0]), np.array([110.0]), np.array([100.0]), np.array([110.0]))
    assert flat[0] == pytest.approx(math.sqrt((1.5 - 2 * math.log(2)) * math.log(1.1) ** 2))
    assert usd_per_price("GCZ6") == 100.0 and usd_per_price("SIH6") == 5000.0
    assert usd_per_price("MGCZ6") == 10.0 and math.isnan(usd_per_price("X"))


def test_identical_in_any_chunking_and_from_checkpoints_inside_a_minute(days):
    cal, _, _, chunks = days
    whole = outputs(days)
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    parts = regroup(seconds, [6630])  # every cut falls inside a minute
    first = builder(cal)
    head = [first.process(c) for c in parts[:4]]
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[4:]]
    a, an = join(whole, "vol_1m")
    for name in (*FEATURE_COLUMNS, "atr_price"):  # undefined floats are NaN, as stored NULL
        assert an[name].any() and np.array_equal(np.isnan(a[name]), an[name]), name
    for other in (stepwise, head + tail):
        b, bn = join(other, "vol_1m")
        for k in a:
            np.testing.assert_array_equal(a[k], b[k], err_msg=k)
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{k} NULL")


def test_features_are_scale_invariant_and_declare_units(days):
    cal, t, cov, _ = days

    def run(scale):
        p = builder(cal)
        return join([p.process(c) for c in session_chunks(cal, t.scaled(**scale), cov)],
                    "vol_1m")[0]  # fmt: skip

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
    # the engine reads the three hourly stages under one prefix: no feature name collides
    names = [*CANDLE_FEATURES, *STATS_FEATURES, *FEATURE_COLUMNS]
    assert len(set(names)) == len(names)
    assert not {c.name for c in COLUMNS if not c.unit} & set(FEATURE_COLUMNS)


def test_the_engine_reads_the_stored_volatility_as_of_each_second(days, monkeypatch):
    """`1h@1m.<name>` at a second is the stored `vol_1m` row of the latest completed minute."""
    for name in ("SHORT", "LONG", "TOD_SESSIONS", "DAY_PERIOD", "DAY_RANK"):
        monkeypatch.setattr(VolMinuteStage, name, getattr(SmallVol, name))
    cal, _, _, chunks = days
    engine = StageFeatures(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL)
    frames = [engine.update(c) for c in chunks]
    frame = frames[0].concat(frames)
    names = {s.name for s in engine.specs()}
    assert {f"1h@1m.{n}" for n in FEATURE_COLUMNS} <= names
    assert names == set(frame.features)
    vol, null = join(outputs(days), "vol_1m")
    at = np.searchsorted(frame.end, vol["end_ns"])
    np.testing.assert_array_equal(frame.end[at], vol["end_ns"])
    for n in FEATURE_COLUMNS:
        got = frame.features[f"1h@1m.{n}"][at]
        np.testing.assert_array_equal(np.isnan(got), null[n], err_msg=n)  # NULL is NaN, never 0
        np.testing.assert_array_equal(got[~null[n]], vol[n][~null[n]], err_msg=n)
        assert null[n].any() and (~null[n]).any(), n


def test_the_declared_warmup_follows_the_chains():
    """Production parameters: the daily percentile's 35 sessions (15 for the daily ATR, then 20
    of its values) count as whole days, 37 typical GC sessions, inside the 40-session lead; the
    time-of-day normal needs the hourly ATR(14) (108 periods) and 20 sessions; ATR(50) 392
    periods. Each chain lengthens with its parameter."""
    ctx = StageContext(None, 0, 0, FeatureConfig())
    stage = VolMinuteStage(ctx)
    assert stage.warmup() == 35 * 86_400
    assert warmup.sessions(stage.warmup(), 1, 82_800) == 37 <= 40
    assert warmup.wilder(50) * 3600 < (108 * 3600 + 20 * 86_400) < stage.warmup()

    class Longer(VolMinuteStage):
        LONG = 1000

    assert Longer(ctx).warmup() == warmup.wilder(1000) * 3600 > stage.warmup()


def test_the_declared_warmup_settles_every_value():
    """Built from two session opens, every value agrees (the same NULLs, values within the
    tolerance) once the later start has run the stage's declared warm-up, and something still
    differs at half of it. Short chains (`SmallVol`) on 23-hour sessions, where the daily
    percentile (2 + 1 + 2 sessions) is the longest."""
    cal = calendar(*((24 * d, 24 * d + 23) for d in range(8)))
    stage = SmallVol(StageContext(cal, 0, CONFIG.close_delay, SMALL))
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
        return join(out, "vol_1m")[0]

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
