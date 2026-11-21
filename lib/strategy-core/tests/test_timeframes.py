"""A timeframe is a parameter: the stages of `1h@1m` built for `10m@10s` (`timeframes.MIDDLE`).

These tests build the middle timeframe's stages beside the minute branch and check them against
it and against any chunking.
"""

import numpy as np
import pytest
from strategy_core.engine import split_by_second
from strategy_core.pipeline import StageFeatures
from strategy_core.stage_bar_1s import BarStage
from strategy_core.stage_step_bar import MinuteBarStage, step_bar
from strategy_core.stage_step_candle import step_candle
from strategy_core.stage_step_pivot import MIDDLE_SCALES
from strategy_core.stage_step_pivot import SCALES as SLOW_SCALES
from strategy_core.stage_step_stats import step_stats
from strategy_core.stage_step_vol import step_vol
from strategy_core.timeframes import MIDDLE, SLOW, Timeframe
from strategy_core.windows import COMPLETE
from test_minutes import CONFIG, builder, join, regroup
from test_minutes import sessions as sessions  # the fixture: two sessions with gaps

MIDDLE_STAGES = (
    step_bar(MIDDLE),
    step_candle(MIDDLE),
    step_stats(MIDDLE),
    step_vol(MIDDLE),
    *MIDDLE_SCALES,
)
BRANCH = (BarStage, MinuteBarStage, *MIDDLE_STAGES)  # in tier order
OBSERVED, MISSING = 2, 0


def test_a_step_divides_a_minute():
    assert (MIDDLE.seconds, MIDDLE.per_minute, MIDDLE.window_seconds) == (10, 6, 600)
    assert (SLOW.seconds, SLOW.per_minute, SLOW.window_seconds) == (60, 1, 3600)
    for seconds in (1, 8, 7, 120):  # one second is the base case; 8 would straddle sessions
        with pytest.raises(ValueError):
            Timeframe("x", seconds, "x", "x", "x")


def test_stage_names_follow_the_timeframe():
    names = [s.NAME for s in MIDDLE_STAGES]
    assert names == [
        "bar_10s", "candle_10m_10s", "stats_10m_10s", "vol_10s",
        "pivot_10s:mid_atr_0p5", "pivot_10s:mid_atr_1", "pivot_10s:mid_atr_2",
    ]  # fmt: skip
    assert [s.NAME for s in SLOW_SCALES] == [
        "pivot_1m:slow_atr_0p5", "pivot_1m:slow_atr_1", "pivot_1m:slow_atr_2",
    ]  # fmt: skip
    assert {s.RESOLUTION for s in MIDDLE_STAGES} == {"10s"}
    assert MIDDLE_STAGES[3].INPUTS == ("bar_10s", "candle_10m_10s")


def test_six_ten_second_rows_are_one_minute(sessions):
    """Step rows nest: a minute's sums, extremes, and close equal those of its six rows, a
    minute is missing exactly when one of them is, and index counters divide."""
    cal, chunks = sessions
    p = builder(cal, BRANCH)
    out = [p.process(c) for c in chunks]
    ten, _ = join(out, "bar_10s")
    one, _ = join(out, "bar_1m")
    assert len(ten["slot_ordinal"]) == 6 * len(one["slot_ordinal"])
    np.testing.assert_array_equal(ten["slot_ordinal"][5::6], 6 * one["slot_ordinal"])
    np.testing.assert_array_equal(ten["end_ns"][5::6], one["end_ns"])
    np.testing.assert_array_equal(np.diff(ten["slot_ordinal"]), 1)  # across the closure too
    status = ten["status"].reshape(-1, 6)
    np.testing.assert_array_equal((status == MISSING).any(axis=1), one["status"] == MISSING)
    known = one["status"] != MISSING
    for name in ("volume", "buy_volume", "sell_volume", "trades", "observed_seconds"):
        np.testing.assert_array_equal(ten[name].reshape(-1, 6).sum(axis=1)[known], one[name][known])
    traded = one["status"] == OBSERVED
    obs = status == OBSERVED
    high = np.where(obs, ten["high"].reshape(-1, 6), np.iinfo(np.int64).min).max(axis=1)
    low = np.where(obs, ten["low"].reshape(-1, 6), np.iinfo(np.int64).max).min(axis=1)
    np.testing.assert_array_equal(high[traded], one["high"][traded])
    np.testing.assert_array_equal(low[traded], one["low"][traded])
    last = 5 - np.argmax(obs[:, ::-1], axis=1)  # the last row with trades in each minute
    close = ten["close"].reshape(-1, 6)[np.arange(len(last)), last]
    np.testing.assert_array_equal(close[traded], one["close"][traded])


def test_the_middle_timeframe_is_the_same_in_any_chunking(sessions):
    """Whole sessions and uneven groups of seconds give identical rows for every stage of the
    middle timeframe, NULL for NULL and bit for bit."""
    cal, chunks = sessions
    p = builder(cal, BRANCH)
    whole = [p.process(c) for c in chunks]
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal, BRANCH)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    for stage in MIDDLE_STAGES:
        a, an = join(whole, stage.NAME)
        b, bn = join(stepwise, stage.NAME)
        assert len(a["slot_ordinal"]) > 0
        for k in a:
            np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{stage.NAME}.{k} nulls")
            keep = ~an[k]
            np.testing.assert_array_equal(a[k][keep], b[k][keep], err_msg=f"{stage.NAME}.{k}")


def test_middle_windows_hold_sixty_rows_of_ten_seconds(sessions):
    cal, chunks = sessions
    p = builder(cal, BRANCH)
    out = [p.process(c) for c in chunks]
    candle, nulls = join(out, "candle_10m_10s")
    base, _ = join(out, "bar_10s")
    complete = candle["status"] == COMPLETE
    assert complete.sum() > 100
    # a complete window that spans no closure starts 600 s before it ends
    span = (candle["end_ns"] - candle["start_ns"])[complete]
    assert span.min() == 600 * 10**9 and span.max() > 600 * 10**9  # some span the closure
    # its seconds with trades are those of its 60 step rows
    rolled = np.convolve(base["observed_seconds"], np.ones(60, np.int64))[: len(complete)]
    np.testing.assert_array_equal(candle["observed"][complete], rolled[complete])
    ratio = candle["active_ratio"][complete & ~nulls["active_ratio"]]
    np.testing.assert_allclose(ratio, rolled[complete & ~nulls["active_ratio"]] / 600)
    # the swing scales publish one row per step row
    for scale in MIDDLE_SCALES:
        rows, _ = join(out, scale.NAME)
        np.testing.assert_array_equal(rows["slot_ordinal"], base["slot_ordinal"])


def test_the_engine_reads_the_latest_completed_ten_second_row(sessions):
    """Every second carries the features of the middle and slow rows completed at or before it,
    with their ages: 0 to 9 seconds for `10m@10s` inside a session, 0 to 59 for `1h@1m`."""
    cal, chunks = sessions
    engine = StageFeatures(cal, feed_latency=0, close_delay=CONFIG.close_delay)
    frames = [engine.update(c) for c in chunks]
    end = np.concatenate([f.end for f in frames])
    get = lambda name: np.concatenate([f.features[name] for f in frames])  # noqa: E731
    p = builder(cal)
    out = [p.process(c) for c in chunks]
    names = [s.name for s in engine.specs()]
    assert len(names) == len(set(names))
    for timeframe, table, seconds in (
        ("10m@10s", "candle_10m_10s", 10),
        ("1h@1m", "candle_1h_1m", 60),
    ):
        rows, nulls = join(out, table)
        age = get(f"{timeframe}.age_s")
        at = np.searchsorted(rows["end_ns"], end, side="right") - 1
        known = at >= 0
        assert not np.isnan(age[known]).any() and np.isnan(age[~known]).all()
        np.testing.assert_array_equal(age[known], (end[known] - rows["end_ns"][at[known]]) / 10**9)
        first = chunks[0]
        inside = known & (end <= first.end)  # within the first session no closure adds to an age
        assert age[inside].max() == seconds - 1 and age[inside].min() == 0
        for name in ("rsi", "atr_bps", "active_ratio"):
            want = np.where(nulls[name], np.nan, rows[name])[at[known]]
            np.testing.assert_array_equal(get(f"{timeframe}.{name}")[known], want)
    assert f"10m@10s.{MIDDLE_SCALES[1].VARIANT}.progress" in names
    assert engine.sources()["10m@10s.age_s"] == "candle_10m_10s"
