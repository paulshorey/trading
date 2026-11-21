"""Swings (layer 2): the detector on hand-built series (the contract's required examples,
docs/project/pivot-structure-design.md), and the stored stages `pivot_1s` and `pivot_1m` against
a plain-Python directional-change reference from the trades and the stored rows, in any chunking
and from checkpoints, under price and size scaling, across a closure and missing data, and as the
engine reads them."""

import math

import numpy as np
import pytest
from helpers import T0, calendar, trades
from strategy_core import swings, warmup
from strategy_core.bars import MISSING, assignment_times
from strategy_core.engine import MarketChunk, split_by_second
from strategy_core.features import FeatureConfig, Unit
from strategy_core.market import MINUTE, NS, PX
from strategy_core.pipeline import STAGES, Pipeline, StageFeatures
from strategy_core.stage_pivot_1s import COLUMNS, FEATURE_COLUMNS, PivotSecondStage
from strategy_core.stage_pivot_1s import SCALES as FAST
from strategy_core.stage_step_pivot import SCALES as SLOW
from strategy_core.stage_step_pivot import PivotMinuteStage
from strategy_core.stage_step_pivot import scale as slow_scale
from strategy_core.state import from_bytes, to_bytes
from strategy_core.swings import (
    ACTIVE,
    ADDITIVE,
    BREAK_DOWN,
    BREAK_UP,
    HIGH,
    IDLE,
    LOW,
    NONE,
    PRICE,
    RECLAIM_HIGH,
    RECLAIM_LOW,
    SEEKING,
)
from strategy_core.synthetic import random_trades
from test_hour_stats import CONFIG
from test_minutes import join, regroup

S = NS
SMALL = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)
OUT = {c.name: i for c, i in swings.dense_columns()}
EVENT_NAMES = {
    "kind": swings.E_KIND,
    "ord": swings.E_ORD,
    "seq": swings.E_SEQ,
    "seg": swings.E_SEG,
    "ext_ord": swings.E_EXT_ORD,
    "cls": swings.E_CLS,
    "run": swings.E_RUN,
    "leg_rows": swings.E_LEG_ROWS,
    "leg_volume": swings.E_LEG_VOL,
    "leg_buy": swings.E_LEG_BUY,
    "leg_sell": swings.E_LEG_SELL,
    "ref_ord": swings.E_REF_ORD,
    "ref_seq": swings.E_REF_SEQ,
    "age": swings.E_AGE,
    "trend": swings.E_TREND,
}
EVENT_FLOATS = {
    "level": swings.X_LEVEL,
    "theta": swings.X_THETA,
    "over": swings.X_OVER,
    "change": swings.X_CHANGE,
    "leg": swings.X_LEG,
    "depth": swings.X_DEPTH,
}


def play(rows, theta=4.0, atr=1.0, *, mode=ADDITIVE, window=60, step=1, detector=None, first=0):
    """Run a detector over rows of observations: a list per row of values or (value, size,
    side), or None for a row without data coverage. Additive distances by default, so the
    contract's example numbers apply directly. Returns the published rows as {column: array}
    and the events as dictionaries (None where undefined)."""
    n = len(rows)
    value, row, size, side = [], [], [], []
    for j, r in enumerate(rows):
        for o in r or []:
            v, q, d = o if isinstance(o, tuple) else (o, 1, 0)
            value.append(float(v))
            row.append(j)
            size.append(q)
            side.append(d)
    ordinal = first + np.arange(n, dtype=np.int64)
    obs = {
        "value": np.array(value, np.float64),
        "row": np.array(row, np.int64),
        "at": 10 * np.arange(len(value), dtype=np.int64),
        "size": np.array(size, np.int64),
        "side": np.array(side, np.int64),
    }
    spec = {
        "missing": np.array([r is None for r in rows]),
        "theta": np.broadcast_to(np.asarray(theta, np.float64), n).copy(),
        "atr": np.broadcast_to(np.asarray(atr, np.float64), n).copy(),
        "group": ordinal,
        "pub": ordinal,
        "emit": np.ones(n, bool),
    }
    d = detector or swings.Detector(mode, window, step)
    out, ev_i, ev_f = d.advance(obs, spec)
    events = []
    for a, b in zip(ev_i, ev_f, strict=True):
        e = {k: (None if a[i] == NONE else int(a[i])) for k, i in EVENT_NAMES.items()}
        e |= {k: (None if np.isnan(b[i]) else float(b[i])) for k, i in EVENT_FLOATS.items()}
        events.append(e)
    return {name: out[:, i] for name, i in OUT.items()}, events


def kinds(events):
    return [(e["kind"], e["level"], e["ord"]) for e in events]


def pivots(events):
    return [e for e in events if e["kind"] in (HIGH, LOW)]


def test_the_first_reversal_from_either_extreme_sets_the_direction():
    """Plan 3.2: with theta 4, 100 -> 103 -> 97 confirms the high at 103, although price never
    moved 4 from where it started. The first pivot has no class, and trend stays undefined."""
    out, events = play([[100], [103], [97]])
    assert kinds(events) == [(HIGH, 103.0, 2)]
    e = events[0]
    assert (e["ext_ord"], e["cls"], e["run"], e["trend"], e["leg"]) == (1, None, None, None, None)
    assert e["over"] == 1.5  # the crossing overshoots: 6 / 4
    assert out["state"].tolist() == [SEEKING, SEEKING, ACTIVE]
    assert np.isnan(out["dir"][:2]).all() and out["dir"][2] == -1
    # after confirmation the old candidate is gone: the new leg starts at zero progress
    assert (out["ext_px"][2], out["progress"][2], out["ext_age_s"][2]) == (97, 0, 0)
    assert (out["high_dist_atr"][2], out["high_age_s"][2], out["high_conf_age_s"][2]) == (6, 1, 0)
    assert np.isnan(out["high_class"]).all() and np.isnan(out["trend"]).all()
    assert np.isnan(out["low_dist_atr"]).all()  # no confirmed low yet


def test_every_crossing_of_the_trade_path_counts():
    """Plan 3.1: with a high of 100 and theta 4, the trades 99 -> 105 -> 100 confirm the new
    high at 105; a bar's extremes alone (99 -> 105) would never see the decline."""
    _, events = play([[96], [100], [99, 105, 100]])
    assert kinds(events) == [(LOW, 96.0, 1), (HIGH, 105.0, 2)]
    assert [e["seq"] for e in events] == [0, 0]


def test_higher_low_appears_at_its_confirmation_and_trend_needs_both_classes():
    rows = [[110], [100], [105], [112], [102], [103], [107]]
    out, events = play(rows)
    assert kinds(events) == [
        (HIGH, 110.0, 1),
        (LOW, 100.0, 2),
        (BREAK_UP, 110.0, 3),  # 112 trades above the confirmed high
        (RECLAIM_HIGH, 110.0, 4),  # ... and 102 is back below it, before
        (HIGH, 112.0, 4),  # the same trade confirms the new high
        (LOW, 102.0, 6),
    ]
    events = pivots(events)
    assert [e["cls"] for e in events] == [None, None, 1, 1]  # HH, then HL
    assert [e["change"] for e in events] == [None, None, 2.0, 2.0]
    assert [e["trend"] for e in events] == [None, None, None, 1]
    # the higher low is known on its confirmation row (6), not at its extreme (4)
    assert np.isnan(out["low_class"][:6]).all() and out["low_class"][6] == 1
    assert out["low_change_atr"][6] == 2 and out["trend"][6] == 1 and out["trend_age_s"][6] == 0
    assert np.isnan(out["trend"][:6]).all()
    # provisional: the down leg's low (102) is above the confirmed low (100) and has partly
    # reversed (103: 1 of 4); not at the extreme itself, and not once the leg has turned
    assert out["prov_hl"].tolist()[2:] == [0, 0, 0, 1, 0]
    assert np.isnan(out["prov_hl"][:2]).all()  # no confirmed low to compare with
    assert out["progress"][5] == 0.25 and out["cand_change_atr"][5] == 2
    assert out["cand_change_atr"][6] == -5  # the up leg's high so far (107) against 112


def test_a_candidate_that_extends_below_the_low_clears_the_provisional_flag_and_breaches():
    out, events = play([[110], [100], [105], [112], [102], [103], [99]])
    assert out["prov_hl"].tolist()[4:] == [0, 1, 0]  # past rows stay as they were
    assert out["cand_change_atr"][6] == -1
    last = events[-1]
    assert (last["kind"], last["level"], last["depth"]) == (BREAK_DOWN, 100.0, 1.0)
    assert (last["ref_ord"], last["ref_seq"]) == (2, 0)  # the low confirmed on row 2
    assert np.isnan(out["break_down_age_s"][5]) and out["break_down_age_s"][6] == 0
    assert out["low_dist_atr"][6] == -1  # below the level


def test_lower_high_and_down_trend_and_mixed():
    out, events = play([[100], [110], [104], [108], [103], [107], [101]])
    assert kinds(events) == [
        (LOW, 100.0, 1),
        (HIGH, 110.0, 2),
        (LOW, 104.0, 3),  # a higher low
        (BREAK_DOWN, 104.0, 4),  # 103 is below it: judged before the confirmation it causes
        (HIGH, 108.0, 4),  # a lower high: change -2
        (RECLAIM_LOW, 104.0, 5),  # 107 is back above the breached low
        (LOW, 103.0, 5),  # a lower low
        (BREAK_DOWN, 103.0, 6),
        (HIGH, 107.0, 6),
    ]
    assert [e["seq"] for e in events] == [0, 0, 0, 0, 1, 0, 1, 0, 1]
    highs = [e for e in events if e["kind"] == HIGH]
    assert [(e["cls"], e["change"]) for e in highs] == [(None, None), (-1, -2.0), (-1, -1.0)]
    # a breach carries the trend it met; mixed after the lower high, down after the lower low
    assert [e["trend"] for e in events] == [None, None, None, None, 0, 0, -1, -1, -1]
    assert out["trend"].tolist()[4:] == [0, -1, -1]
    assert out["trend_age_s"].tolist()[4:] == [0, 0, 1]


def test_equal_pivots_are_equal_and_never_a_breach():
    out, events = play([[110], [100], [104], [106], [100], [104]])
    assert [e["kind"] for e in events] == [HIGH, LOW, HIGH, LOW]  # touching 100 breaks nothing
    assert (events[-1]["cls"], events[-1]["run"], events[-1]["change"]) == (0, 0, 0.0)
    assert out["low_class"][5] == 0 and out["low_run_ratio"][5] == 0


def test_runs_count_consecutive_classes():
    """Lows HL, HL, EL, LL, LL: runs 1, 2, 0, -1, -2."""
    rows = [[120], [100], [110], [102], [112], [104], [114], [104], [114], [103], [113], [101]]
    out, events = play([*rows, [111]])
    lows = [e for e in events if e["kind"] == LOW]
    assert [e["level"] for e in lows] == [100, 102, 104, 104, 103, 101]
    assert [e["cls"] for e in lows] == [None, 1, 1, 0, -1, -1]
    assert [e["run"] for e in lows] == [None, 1, 2, 0, -1, -2]
    assert out["low_run_ratio"][-1] == -0.4
    # six consecutive higher lows: the event keeps the count, the feature is bounded
    climb = [[120]]
    for k in range(7):
        climb += [[100 + 2 * k], [110 + 2 * k]]
    out, events = play(climb)
    assert [e["run"] for e in events if e["kind"] == LOW] == [None, 1, 2, 3, 4, 5, 6]
    assert out["low_run_ratio"][-1] == 1.0


def test_a_falling_threshold_confirms_nothing_until_a_new_extreme_refreshes_it():
    theta = [4, 4, 1, 1, 1, 1]
    out, events = play([[100], [110], [108], [111], [110.5], [110]], theta=theta)
    assert kinds(events) == [(LOW, 100.0, 1), (HIGH, 111.0, 5)]
    assert out["theta_bps"].tolist()[1:5] == [4, 4, 1, 1]  # frozen with the high at 110
    assert out["progress"].tolist()[1:5] == [0, 0.5, 0, 0.5]


def test_missing_data_ends_the_segment_and_nothing_is_compared_across_it():
    rows = [[100], [104], None, [100], [], [104], [100], [103.5], [104]]
    out, events = play(rows)
    assert out["state"].tolist() == [1, 2, IDLE, 1, 1, 2, 2, 2, 2]
    assert out["segment"].tolist()[3:] == [2] * 6 and np.isnan(out["segment"][2])
    assert np.isnan([out[n][2] for n in OUT if n != "state"]).all()
    assert kinds(events) == [(LOW, 100.0, 1), (LOW, 100.0, 5), (HIGH, 104.0, 6), (LOW, 100.0, 8)]
    assert [e["seg"] for e in events] == [1, 2, 2, 2]
    # the same level after the gap is a first low again, and the next one compares within it
    assert [e["cls"] for e in events] == [None, None, None, 0]
    # an undefined threshold or ATR ends the segment the same way; it is never a zero threshold
    for bad in ({"theta": [4, 4, np.nan, 4]}, {"atr": [1, 1, 0, 1]}, {"theta": [4, 4, 0, 4]}):
        out, events = play([[100], [104], [], [100]], **bad)
        assert out["state"].tolist() == [1, 2, IDLE, 1]
        assert out["segment"].tolist()[3] == 2


def test_quiet_rows_only_age_and_ages_scale_with_the_row_step():
    rows = [[100], [104], [], [], [103]]
    out, events = play(rows, step=60)
    assert len(events) == 1
    assert out["ext_age_s"].tolist()[1:] == [0, 60, 120, 180]
    assert out["low_age_s"].tolist()[1:] == [60, 120, 180, 240]
    assert out["low_conf_age_s"].tolist()[1:] == [0, 60, 120, 180]
    assert out["leg_age_s"].tolist()[1:] == [60, 120, 180, 240]
    for name in ("progress", "ext_dist_atr", "leg_atr", "low_dist_atr", "ext_px"):
        assert out[name][1] == out[name][2] == out[name][3], name
    assert (out["progress"][4], out["ext_dist_atr"][4]) == (0.25, 1)


def test_a_reclaim_within_the_window_records_the_sweep_depth():
    """Breach to 99.8, extend to 99.5, back above 100: depth 0.5, the deepest trade."""
    rows = [[110], [100], [105], [99.8], [99.5], [100], [100.2], [99.9], [100.3]]
    _, events = play(rows, window=3)
    tail = events[2:]
    assert [e["kind"] for e in tail] == [BREAK_DOWN, HIGH, RECLAIM_LOW]
    breach, _, reclaim = tail
    assert breach["ord"] == 3 and breach["depth"] == pytest.approx(0.2)
    assert (reclaim["ord"], reclaim["age"], reclaim["level"]) == (6, 3, 100.0)  # equality is not
    assert reclaim["depth"] == pytest.approx(0.5)
    assert (reclaim["ref_ord"], reclaim["ref_seq"]) == (2, 0)
    # ... once per breached level, and not after the window
    assert [e["kind"] for e in play(rows, window=2)[1][2:]] == [BREAK_DOWN, HIGH]
    # none if a new low confirms first: the level is then history
    late = [[110], [100], [105], [99.8], [95], [99], [101]]
    assert [e["kind"] for e in play(late, window=9)[1][2:]] == [BREAK_DOWN, HIGH, LOW]
    # highs mirror it
    up = [[90], [100], [95], [100.4], [100.6], [99.9]]
    kinds_up = [(e["kind"], e["depth"]) for e in play(up)[1][2:]]
    assert kinds_up[0][0] == BREAK_UP and kinds_up[-1][0] == RECLAIM_HIGH
    assert kinds_up[-1][1] == pytest.approx(0.6)


def test_one_trade_reclaims_the_old_low_and_confirms_the_new_one():
    _, events = play([[110], [100], [105], [99.8], [96.5], [100.5]])
    tail = events[-2:]
    assert [(e["kind"], e["ord"], e["seq"]) for e in tail] == [(RECLAIM_LOW, 5, 0), (LOW, 5, 1)]
    assert tail[0]["depth"] == pytest.approx(3.5) and tail[1]["cls"] == -1  # a lower low


def test_each_trade_belongs_to_exactly_one_leg():
    """The confirming trade comes after the extreme, so it starts the new leg."""
    rows = [[(110, 1, 1)], [(100, 2, -1)], [(105, 4, 1)], [(112, 8, 1)], [(107, 16, -1)]]
    out, events = play(rows)
    events = pivots(events)
    assert [e["kind"] for e in events] == [HIGH, LOW, HIGH]
    assert [e["leg_volume"] for e in events] == [None, 2, 12]
    assert [(e["leg_buy"], e["leg_sell"]) for e in events[1:]] == [(0, 2), (12, 0)]
    assert [e["leg_rows"] for e in events] == [None, 2, 3]  # rows 0 ... 1; rows 1 ... 3
    assert [e["leg"] for e in events] == [None, 10.0, 12.0]
    # the open leg: through its running extreme, and since it
    assert out["leg_delta_ratio"].tolist()[1:] == [-1, 1, 1, -1]
    assert np.isnan(out["reversal_delta_ratio"][[1, 2, 3, 4]]).all()  # nothing since the extreme
    out, _ = play([*rows[:4], [(110, 3, -1)], [(111, 1, 1)]])
    assert out["reversal_delta_ratio"].tolist()[4:] == [-1, -0.5]
    assert out["leg_delta_ratio"].tolist()[4:] == [1, 1]
    assert out["prev_leg_atr"].tolist()[2:] == [10, 10, 10, 10]
    assert out["retrace"].tolist()[2:] == [0.5, 1.2, 1.2, 1.2]
    assert np.isnan(out["prev_leg_atr"][:2]).all()


def test_an_index_series_uses_plain_differences():
    """Contract: RSI 40 -> 55 -> 49 with a threshold of 5 points confirms the high at 55 on the
    49 row (the rise to 55 had confirmed the low at 40)."""
    _, events = play([[40], [55], [49]], theta=5.0, atr=100.0)
    assert kinds(events) == [(LOW, 40.0, 1), (HIGH, 55.0, 2)]
    assert events[1]["over"] == 1.2 and events[1]["leg"] == 0.15  # 15 points / 100


def test_prices_use_log_basis_points_and_must_be_positive():
    px = [round(x * PX) for x in (100.0, 100.2, 100.11, 100.09)]
    out, events = play([[px[0]], [px[1]], [px[2]], [px[3]]], theta=10.0, atr=PX / 10, mode=PRICE)
    # 8.98 bps below the high is not enough, 10.98 is
    assert kinds(events) == [(LOW, float(px[0]), 1), (HIGH, float(px[1]), 3)]
    assert events[1]["over"] == pytest.approx(1e4 * math.log(100.2 / 100.09) / 10)
    assert out["progress"][2] == pytest.approx(1e4 * math.log(100.2 / 100.11) / 10)
    assert out["ext_dist_atr"][2] == pytest.approx(0.9)
    px[1] = round(100.05 * PX)  # 5 bps: no confirmation
    out, events = play([[px[0]], [px[1]], [0], [px[0]], [px[1]]], theta=10.0, mode=PRICE)
    assert out["state"].tolist() == [1, 1, IDLE, 1, 1] and not events


def test_processing_row_by_row_resumes_exactly():
    rng = np.random.default_rng(3)
    walk = 100 + np.cumsum(rng.choice([-1.0, 0.0, 1.0], 4000))
    sizes = rng.integers(0, 5, 1000).tolist()
    rows = [list(walk[4 * i : 4 * i + k]) for i, k in enumerate(sizes)]
    rows[400] = None
    whole, events = play(rows, theta=3.0)
    d = swings.Detector(ADDITIVE, 60, 1)
    parts, some = [], []
    for j, r in enumerate(rows):
        out, ev = play([r], theta=3.0, detector=d, first=j)
        parts.append(out)
        some += ev
    for name in OUT:
        got = np.concatenate([p[name] for p in parts])
        np.testing.assert_array_equal(got, whole[name], err_msg=name)
    assert len(events) > 200 and {e["kind"] for e in events} == {1, 2, 3, 4, 5, 6}
    assert some == events


# The stored stages ---------------------------------------------------------------------------

# Ten short sessions hold few swings of an hourly ATR, so two finer slow scales join the tests.
FINE = (slow_scale(PivotMinuteStage, 0.1), slow_scale(PivotMinuteStage, 0.2))
BRANCH = (*(s for s in STAGES if s.NAME != "stats_1h_1m"), *FINE)


def builder(cal):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL,
                    stages=BRANCH)  # fmt: skip


def session_chunks(cal, t, cov, contract="X"):
    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    return [
        MarketChunk(contract, o, c, t.take((at >= o) & (at < c)), cov)
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True)
    ]


@pytest.fixture(scope="module")
def days():
    """Ten 90-minute sessions two hours apart (so every session follows a closure): the sixth
    has 40 seconds of missing data, the seventh closes after an hour, and the ninth has no trades
    for its first 65 minutes."""
    hours = [(2 * k, 2 * k + (1.0 if k == 6 else 1.5)) for k in range(10)]
    cal = calendar(*hours)
    end = int(cal.closes[-1])
    t = random_trades(T0, end, seed=11, rate=0.6)
    quiet = int(cal.opens[8])
    t = t.take((t.ts_event < quiet) | (t.ts_event >= quiet + 65 * MINUTE))
    gap = int(cal.opens[5]) + 2000 * S
    cov = np.array([[T0, gap + S // 2], [gap + 40 * S, end]], np.int64)
    return cal, t, cov, session_chunks(cal, t, cov)


@pytest.fixture(scope="module")
def whole(days):
    cal, _, _, chunks = days
    p = builder(cal)
    return [p.process(c) for c in chunks]


def events_of(parts, name):
    keys = parts[0].products["events"][name].values
    values = {
        k: np.concatenate([p.products["events"][name].values[k] for p in parts]) for k in keys
    }
    nulls = {
        k: np.concatenate(
            [
                p.products["events"][name].nulls.get(
                    k, np.zeros(len(p.products["events"][name]), bool)
                )
                for p in parts
            ]
        )
        for k in keys
    }
    return values, nulls


def released_trades(days):
    """Every accepted trade in release order with the index of its second row, directly."""
    cal, t, cov, _ = days
    ends = np.concatenate(
        [np.arange(o + S, c + 1, S) for o, c in zip(cal.opens, cal.closes, strict=True)]
    )
    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    slot = np.searchsorted(ends, at, side="right")
    ok = slot < len(ends)
    ok[ok] &= ends[slot[ok]] - S <= at[ok]
    covered = np.zeros(len(ends), bool)
    for a, b in cov:
        covered |= (ends - S >= a) & (ends <= b)
    ok[ok] &= covered[slot[ok]]
    index = np.flatnonzero(ok)
    index = index[np.argsort(slot[index], kind="stable")]
    return ends, covered, t.price[index], slot[index]


def reference_pivots(price, row, ready, theta):
    """Directional change in plain Python: [(kind, extreme row, level, confirmation row)]. An
    extreme is (price, row, the threshold frozen when it was set)."""
    out, active, direction, hi, lo, k = [], False, 0, None, None, 0
    for j in range(len(ready)):
        if not ready[j]:
            active = False
        elif not active:
            active, direction, hi, lo = True, 0, None, None
        while k < len(price) and row[k] == j:
            p = int(price[k])
            k += 1
            if not active:
                continue
            here = (p, j, theta[j])
            if hi is None:
                hi = lo = here
                continue
            if direction >= 0 and p > hi[0]:
                hi = here
            if direction <= 0 and p < lo[0]:
                lo = here
            if direction >= 0 and 1e4 * math.log(hi[0] / p) >= hi[2]:
                out.append((HIGH, hi[1], hi[0], j))
                direction, lo = -1, here
            elif direction <= 0 and 1e4 * math.log(p / lo[0]) >= lo[2]:
                out.append((LOW, lo[1], lo[0], j))
                direction, hi = 1, here
    return out


def nan_null(values, nulls, name):
    return np.where(nulls[name], np.nan, values[name].astype(np.float64))


@pytest.mark.parametrize("stage", FAST, ids=lambda s: s.VARIANT)
def test_fast_pivots_equal_a_plain_python_reference(days, whole, stage):
    """Confirmed highs and lows of each fast scale, from the trades and the stored candle and
    volatility rows of the previous second."""
    ends, covered, price, row = released_trades(days)
    candle, cn = join(whole, "candle_1m_1s")
    vol, vn = join(whole, "vol_1s")
    np.testing.assert_array_equal(candle["end_ns"], ends)
    atr_bps, spread = nan_null(candle, cn, "atr_bps"), nan_null(candle, cn, "book_spread_bps")
    atr = nan_null(vol, vn, "atr_price")
    now = np.where(np.isnan(atr_bps) | np.isnan(spread), np.nan,
                   np.maximum(stage.K * atr_bps, 2.0 * spread))  # fmt: skip
    theta, snapshot = np.r_[np.nan, now[:-1]], np.r_[np.nan, atr[:-1]]
    ready = covered & (theta > 0) & (snapshot > 0)
    want = reference_pivots(price, row, ready, theta)
    ev, en = events_of(whole, stage.NAME)
    pivot = ev["kind"] <= LOW
    first = int(candle["slot_ordinal"][0])
    got = list(
        zip(
            ev["kind"][pivot].tolist(),
            (ev["ext_ordinal"][pivot] - first).tolist(),
            ev["level"][pivot].astype(np.int64).tolist(),
            (ev["slot_ordinal"][pivot] - first).tolist(),
            strict=True,
        )
    )
    assert got == want
    assert len(want) > (150 if stage.K < 2 else 40)
    # events carry their row: its end, its availability, and the trade's time inside it
    np.testing.assert_array_equal(ev["end_ns"], ends[ev["slot_ordinal"] - first])
    np.testing.assert_array_equal(ev["available_ns"], ev["end_ns"] + CONFIG.close_delay)
    assert ((ev["at_ns"] >= ev["end_ns"] - S) & (ev["at_ns"] < ev["end_ns"])).all()
    assert not en["ext_ordinal"][pivot].any() and en["ext_ordinal"][~pivot].all()
    # the threshold and ATR on a pivot are those of the second before its extreme
    at = (ev["ext_ordinal"][pivot] - first).astype(np.int64)
    np.testing.assert_array_equal(ev["theta"][pivot], theta[at])
    np.testing.assert_array_equal(ev["atr"][pivot], snapshot[at] * PX)
    # the published rows follow from the events: the latest confirmed high and low of the segment
    rows_, rn = join(whole, stage.NAME)
    np.testing.assert_array_equal(rows_["end_ns"], ends)
    for kind, name in ((HIGH, "high"), (LOW, "low")):
        mine = np.flatnonzero(ev["kind"] == kind)
        latest = np.searchsorted(ev["slot_ordinal"][mine], rows_["slot_ordinal"], side="right") - 1
        e = mine[np.maximum(latest, 0)]
        known = (latest >= 0) & (ev["segment"][e] == rows_["segment"]) & (rows_["state"] > IDLE)
        np.testing.assert_array_equal(~rn[f"{name}_age_s"], known)
        np.testing.assert_array_equal(
            rows_[f"{name}_age_s"][known], (rows_["slot_ordinal"] - ev["ext_ordinal"][e])[known]
        )
        np.testing.assert_array_equal(
            rows_[f"{name}_conf_age_s"][known],
            (rows_["slot_ordinal"] - ev["slot_ordinal"][e])[known],
        )
        classified = known & ~en["class"][e]
        np.testing.assert_array_equal(~rn[f"{name}_class"], classified)
        np.testing.assert_array_equal(
            rows_[f"{name}_class"][classified], ev["class"][e][classified]
        )
        np.testing.assert_array_equal(
            rows_[f"{name}_change_atr"][classified], ev["change_atr"][e][classified]
        )
    # idle exactly where the inputs are undefined or data is missing; never inferred otherwise
    np.testing.assert_array_equal(rows_["state"] == IDLE, ~ready)
    assert (rows_["state"] == IDLE).sum() > 40 and (rows_["state"] == ACTIVE).mean() > 0.9


@pytest.mark.parametrize("stage", (*FINE, *SLOW), ids=lambda s: s.VARIANT)
def test_slow_pivots_equal_a_plain_python_reference_and_publish_per_minute(days, whole, stage):
    """Slow scales replay the same trades with the hourly threshold of the minute completed
    before each trade's own minute. The spread here comes from the second rows (the candle's
    carried book at the minute's last second), independently of the stage's minute carry."""
    ends, covered, price, row = released_trades(days)
    second, sn = join(whole, "candle_1m_1s")
    candle, cn = join(whole, "candle_1h_1m")
    vol, vn = join(whole, "vol_1m")
    ordinal = second["slot_ordinal"]
    minute = (ordinal + 59) // 60
    first = int(candle["slot_ordinal"][0])
    np.testing.assert_array_equal(candle["slot_ordinal"], minute[ordinal % 60 == 0])
    spread = nan_null(second, sn, "book_spread_bps")[ordinal % 60 == 0]
    atr_bps = nan_null(candle, cn, "atr_bps")
    now = np.where(np.isnan(atr_bps) | np.isnan(spread), np.nan,
                   np.maximum(stage.K * atr_bps, 2.0 * spread))  # fmt: skip
    atr = nan_null(vol, vn, "atr_price")
    before = minute - 1 - first  # the minute completed before each second's own
    theta = np.where(before >= 0, now[np.maximum(before, 0)], np.nan)
    snapshot = np.where(before >= 0, atr[np.maximum(before, 0)], np.nan)
    blocked = np.zeros(len(ends), bool)  # from a missing second to the end of its minute
    for j in np.flatnonzero(~covered):
        blocked |= (minute == minute[j]) & (np.arange(len(ends)) >= j)
    ready = covered & ~blocked & (theta > 0) & (snapshot > 0)
    want = reference_pivots(price, row, ready, theta)
    ev, _ = events_of(whole, stage.NAME)
    pivot = ev["kind"] <= LOW
    got = list(
        zip(
            ev["kind"][pivot].tolist(),
            ev["ext_ordinal"][pivot].tolist(),
            ev["level"][pivot].astype(np.int64).tolist(),
            ev["slot_ordinal"][pivot].tolist(),
            strict=True,
        )
    )
    assert got == [(k, int(minute[a]), level, int(minute[b])) for k, a, level, b in want]
    assert len(want) > {0.1: 60, 0.2: 25, 0.5: 8, 1.0: 3, 2.0: 0}[stage.K]
    # a confirmation inside a minute is published with that minute's row, never earlier
    rows_, rn = join(whole, stage.NAME)
    np.testing.assert_array_equal(rows_["slot_ordinal"], candle["slot_ordinal"])
    np.testing.assert_array_equal(rows_["end_ns"], candle["end_ns"])
    np.testing.assert_array_equal(ev["end_ns"], candle["end_ns"][ev["slot_ordinal"] - first])
    np.testing.assert_array_equal(ev["available_ns"], ev["end_ns"] + CONFIG.close_delay)
    assert (ev["at_ns"] < ev["end_ns"]).all() and (ev["at_ns"] >= ev["end_ns"] - MINUTE).all()
    assert (ev["end_ns"] - ev["at_ns"] > 30 * S).any()  # confirmed well before the minute's end
    high = np.flatnonzero(ev["kind"] == HIGH)
    k = high[len(high) // 2]
    at = int(ev["slot_ordinal"][k]) - first
    assert rows_["high_conf_age_s"][at] == 0 and rows_["high_conf_age_s"][at + 1] == 60
    assert rows_["high_age_s"][at] == 60 * (ev["slot_ordinal"][k] - ev["ext_ordinal"][k])
    assert set(np.unique(rows_["ext_age_s"][~rn["ext_age_s"]] % 60)) == {0}  # minute rows x 60
    # the missing seconds end the segment in their minute, and the hourly window keeps it idle
    gap = int(minute[np.flatnonzero(~covered)[0]]) - first
    assert rows_["state"][gap - 1] == ACTIVE and (rows_["state"][gap : gap + 60] == IDLE).all()
    assert rows_["state"][gap + 61] > IDLE
    assert rows_["segment"][gap + 61] == rows_["segment"][gap - 1] + 1


def test_identical_in_any_chunking_and_from_checkpoints(days, whole):
    cal, _, _, chunks = days
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    parts = regroup(seconds, [6631])  # cuts fall inside minutes
    first = builder(cal)
    head = [first.process(c) for c in parts[:4]]
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[4:]]
    for stage in (*FAST, *SLOW, *FINE):
        a, an = join(whole, stage.NAME)
        ea, ean = events_of(whole, stage.NAME)
        for name in FEATURE_COLUMNS:
            if a[name].dtype.kind == "f":  # undefined floats are NaN, as stored NULL
                assert np.array_equal(np.isnan(a[name]), an[name]), name
        for other in (stepwise, head + tail):
            b, bn = join(other, stage.NAME)
            for k in a:
                np.testing.assert_array_equal(a[k], b[k], err_msg=f"{stage.NAME} {k}")
                np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{stage.NAME} {k} NULL")
            eb, ebn = events_of(other, stage.NAME)
            for k in ea:
                np.testing.assert_array_equal(ea[k], eb[k], err_msg=f"{stage.NAME} event {k}")
                np.testing.assert_array_equal(ean[k], ebn[k], err_msg=f"{stage.NAME} event {k}")
        if stage not in SLOW:  # every kind of event (ten sessions hold few hourly swings)
            assert set(np.unique(ea["kind"])) == {1, 2, 3, 4, 5, 6}, stage.NAME


def test_features_are_scale_invariant_and_declare_units(days, whole):
    cal, t, cov, _ = days

    def run(scale):
        p = builder(cal)
        return [p.process(c) for c in session_chunks(cal, t.scaled(**scale), cov)]

    others = [run({"price_factor": 3}), run({"size_factor": 7})]
    for stage in (*FAST, *FINE, *SLOW):
        base, bn = join(whole, stage.NAME)
        undefined = [n for n in FEATURE_COLUMNS if bn[n].all()]
        assert stage in SLOW or not undefined, (stage.NAME, undefined)
        for other in others:
            values, nulls = join(other, stage.NAME)
            for name in FEATURE_COLUMNS:
                np.testing.assert_array_equal(nulls[name], bn[name], err_msg=name)
                np.testing.assert_allclose(
                    values[name], base[name], rtol=1e-9, atol=1e-9, equal_nan=True, err_msg=name
                )
            events = events_of(other, stage.NAME)[0]
            for name in ("kind", "slot_ordinal", "seq", "ext_ordinal", "class", "run", "trend"):
                np.testing.assert_array_equal(
                    events[name], events_of(whole, stage.NAME)[0][name], err_msg=name
                )
    units = {u.value for u in Unit}
    assert all(c.unit in units for c in COLUMNS if c.unit)
    assert len({c.name for c in COLUMNS}) == len(COLUMNS)
    # raw prices are context: a level never has a unit
    assert not next(c for c in COLUMNS if c.name == "ext_px").unit
    assert PivotMinuteStage.COLUMNS == PivotSecondStage.COLUMNS  # both resolutions share columns


def test_state_and_ages_cross_a_closure_in_rows_not_clock_time():
    """An early close and a reopen hours later: the swing continues, a reopening move confirms,
    and ages count scheduled-open rows. No closure is inferred from the silence."""
    cal = calendar((0, 0.5), (5, 5.5))  # closes at 00:30, reopens at 05:00
    close, reopen = int(cal.closes[0]), int(cal.opens[1])
    rng = np.random.default_rng(1)
    rows = []
    for k in range(1700):  # a steady, two-sided market so the ATR and the book are defined
        rows.append((T0 + k * S + S // 2, 100 + 0.1 * int(rng.integers(-2, 3)), 1, 1))
    rows.append((close - 20 * S + S // 4, 103.0, 2, 1))  # a high 20 seconds before the close
    rows.append((close - 10 * S + S // 4, 102.9, 1, -1))
    rows.append((reopen + 30 * S + S // 4, 95.0, 3, -1))  # the reopening drop confirms it
    for k in range(40, 400):
        rows.append((reopen + k * S + S // 2, 95 + 0.1 * int(rng.integers(-2, 3)), 1, 1))
    rows.sort()
    t = trades(rows)
    cov = np.array([[T0, int(cal.closes[1])]], np.int64)
    p = Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL, stages=BRANCH)
    parts = [p.process(c) for c in session_chunks(cal, t, cov)]
    stage = FAST[1]
    out, null = join(parts, stage.NAME)
    ev, _ = events_of(parts, stage.NAME)
    ordinal, end = out["slot_ordinal"], out["end_ns"]
    assert len(ordinal) == 3600 and (np.diff(ordinal) == 1).all()  # closures have no rows
    high = np.flatnonzero((ev["kind"] == HIGH) & (ev["level"] == round(103.0 * PX)))
    assert len(high) == 1
    e = int(high[0])
    assert ev["ext_at_ns"][e] < close and ev["at_ns"][e] == reopen + 30 * S + S // 4
    at = int(np.flatnonzero(end == reopen + 31 * S)[0])  # the row of the confirming trade
    assert ev["slot_ordinal"][e] == ordinal[at]
    # 20 rows before the close, 31 after the reopen: 50 rows, not the 4.5 hours on the clock
    assert out["high_age_s"][at] == 50 and out["high_conf_age_s"][at] == 0
    assert out["segment"][at] == out["segment"][at - 60] and not null["segment"][at - 31 : at].any()
    assert (out["state"][at - 60 : at + 1] == ACTIVE).all()
    before = at - 31  # the last row before the closure
    assert end[before] == close and end[before + 1] == reopen + S
    assert out["ext_age_s"][before] == 19 and out["ext_age_s"][before + 1] == 20
    assert out["progress"][before] == out["progress"][before + 1] > 0  # nothing happened
    # the leg that ended at the high counts rows too
    low = int(np.flatnonzero((ev["kind"] == LOW) & (np.arange(len(ev["kind"])) < e))[-1])
    assert ev["leg_rows"][e] == ev["ext_ordinal"][e] - ev["ext_ordinal"][low] + 1


def test_the_engine_reads_every_scale_under_its_own_name(days):
    """Fast scales join row by row as `1m@1s.<scale>.<feature>`; slow scales hold the latest
    completed minute as `1h@1m.<scale>.<feature>`: one held state, not a new pulse per second."""
    cal, _, _, chunks = days
    engine = StageFeatures(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL)
    reference = Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL)
    frames, parts = [], []
    for c in chunks[:4]:
        frames.append(engine.update(c))
        parts.append(reference.process(c))
    frame = frames[0].concat(frames)
    names = [s.name for s in engine.specs()]
    assert len(names) == len(set(names)) and set(names) == set(frame.features)
    units = {s.name: s.unit for s in engine.specs()}
    for stage in FAST:
        out, null = join(parts, stage.NAME)
        for n in FEATURE_COLUMNS:
            got = frame.features[f"1m@1s.{stage.VARIANT}.{n}"]
            np.testing.assert_array_equal(np.isnan(got), null[n], err_msg=n)  # NULL is NaN
            np.testing.assert_array_equal(got[~null[n]], out[n][~null[n]], err_msg=n)
        assert units[f"1m@1s.{stage.VARIANT}.progress"] is Unit.RATIO
        assert StageFeatures.sources()[f"1m@1s.{stage.VARIANT}.progress"] == stage.NAME
    for stage in SLOW:
        out, null = join(parts, stage.NAME)
        i = np.searchsorted(out["end_ns"], frame.end, side="right") - 1
        for n in FEATURE_COLUMNS:
            got = frame.features[f"1h@1m.{stage.VARIANT}.{n}"]
            want = np.where((i >= 0) & ~null[n][np.maximum(i, 0)], out[n][np.maximum(i, 0)], np.nan)
            np.testing.assert_array_equal(got, want, err_msg=n)
        held = frame.features[f"1h@1m.{stage.VARIANT}.high_conf_age_s"]
        assert (np.diff(held[np.isfinite(held)]) != 0).sum() < len(held) / 50  # steps per minute


def test_warmup_covers_the_threshold_inputs_and_warm_reports_the_structure(days, whole):
    cal, _, _, chunks = days
    ctx = builder(cal).context
    atr = warmup.wilder(SMALL.atr_period)
    assert FAST[0](ctx).warmup() == atr * 60
    assert SLOW[0](ctx).warmup() == atr * 3600
    assert {s.K for s in FAST} == {s.K for s in SLOW} == {0.5, 1.0, 2.0}
    assert [s.VARIANT for s in (*FAST, *SLOW)] == [
        "fast_atr_0p5", "fast_atr_1", "fast_atr_2", "slow_atr_0p5", "slow_atr_1", "slow_atr_2",
    ]  # fmt: skip
    settings = FAST[1](ctx).settings()
    assert (settings["multiplier"], settings["spread_floor"], settings["reclaim_window_rows"]) == (
        1.0, 2.0, 60,
    )  # fmt: skip
    assert SLOW[1](ctx).settings()["reclaim_window_rows"] == 15
    assert FAST[0](ctx).settings() != FAST[1](ctx).settings()  # a scale's identity is its own
    # warm: every row of the chunk had a confirmed high and low of its segment
    p = builder(cal)
    warm = []
    for c in chunks:
        p.process(c)
        warm.append(p.stages[FAST[0].NAME].warm)
    assert warm == [False, True, True, True, True, False, True, True, True, True]  # 6th: the gap
    missing = join(whole, "bar_1s")[0]["status"] == MISSING
    assert missing.sum() == 40
