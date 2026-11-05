"""Stages: the graph, derived warm-ups, and that a declared warm-up is long enough."""

import numpy as np
import pytest
from helpers import T0, calendar
from strategy_core import warmup
from strategy_core.engine import MarketChunk
from strategy_core.features import FeatureConfig
from strategy_core.market import HOUR, NS
from strategy_core.pipeline import STAGES, Pipeline, check_graph
from strategy_core.stage_bar_1m import MinuteBarStage
from strategy_core.stage_bar_1s import BarStage
from strategy_core.stage_candle_1h_1m import HourCandleStage
from strategy_core.stage_candle_1m_1s import FEATURE_COLUMNS, CandleStage
from strategy_core.stage_stats_1h_1m import HourStatsStage
from strategy_core.stages import StageContext
from strategy_core.synthetic import random_trades


def test_warmup_follows_the_parameters():
    # the values in docs/project/feature-pipeline.md#warm-up-is-derived-never-typed
    assert warmup.wilder(14, extra=1) == 109 and warmup.wilder(14) == 108  # RSI, ATR(14)
    assert warmup.ema(50) == 174 and warmup.ema(200) == 692
    assert warmup.wilder(50) == 392
    assert warmup.sessions(692, 3600, 23 * 3600) == 31  # hourly EMA(200): about 30 sessions
    assert warmup.window(20) == 20 and warmup.sessions(0, 60, 82_800) == 0
    # a longer indicator lengthens the stage's warm-up without anyone typing a number
    short = CandleStage(StageContext(None, 0, 0, FeatureConfig(rsi_period=14)))
    long = CandleStage(StageContext(None, 0, 0, FeatureConfig(rsi_period=100)))
    assert long.warmup() > short.warmup() > 0
    assert BarStage(StageContext(None, 0, 0, FeatureConfig())).warmup() == 0
    # hourly ADX(14): 217 same-phase periods of an hour, about 9.4 sessions of 23 hours
    hourly = HourCandleStage(StageContext(None, 0, 0, FeatureConfig())).warmup()
    assert hourly == 217 * 3600 and warmup.sessions(hourly, 1, 82_800) == 10
    # hourly statistics: the hourly ATR(14) that normalizes them, about 4.7 sessions
    stats = HourStatsStage(StageContext(None, 0, 0, FeatureConfig())).warmup()
    assert stats == 108 * 3600 and warmup.sessions(stats, 1, 82_800) == 5
    longer = HourStatsStage(StageContext(None, 0, 0, FeatureConfig(atr_period=50))).warmup()
    assert longer == 392 * 3600


def test_the_graph_reads_only_earlier_stages():
    check_graph()
    assert [s.NAME for s in STAGES] == [
        "bar_1s",
        "bar_1m",
        "candle_1m_1s",
        "candle_1h_1m",
        "stats_1h_1m",
    ]
    # the resolutions are independent branches: no minute stage reads a second-resolution candle
    assert {s.NAME: s.INPUTS for s in STAGES if s.RESOLUTION == "1m"} == {
        "bar_1m": ("bar_1s",),
        "candle_1h_1m": ("bar_1m",),
        "stats_1h_1m": ("bar_1m", "candle_1h_1m"),  # a declared edge within tier 1
    }
    with pytest.raises(ValueError, match="not an earlier stage"):
        check_graph((CandleStage, BarStage))
    with pytest.raises(ValueError, match="not an earlier stage"):  # an edge needs its order
        check_graph((BarStage, MinuteBarStage, HourStatsStage, HourCandleStage))


def test_a_chunk_inside_a_closure_has_no_rows():
    cal = calendar((0, 0.5), (1, 1.5))
    t = random_trades(T0, T0 + int(1.5 * HOUR), seed=1, rate=1)
    cov = np.array([[T0, T0 + int(1.5 * HOUR)]], np.int64)
    p = Pipeline(cal, feed_latency=0, close_delay=100_000_000)
    p.process(MarketChunk("X", T0, T0 + int(0.5 * HOUR), t, cov))
    closed = p.process(MarketChunk("X", T0 + int(0.5 * HOUR), T0 + HOUR, t, cov))
    assert len(closed) == 0


def test_the_declared_warmup_settles_every_candle_feature():
    """Built from two starting points, every candle feature agrees once the later start has run
    the stage's declared warm-up: a check that no indicator's warm-up is missing from it. Like
    contract spans, both builds start at a session open (session features start there)."""
    cal = calendar((0, 1), (1.5, 8))  # a short session, then a long one
    end = T0 + 8 * HOUR
    t = random_trades(T0, end, seed=5, rate=2)
    cov = np.array([[T0, end]], np.int64)
    later = T0 + int(1.5 * HOUR)  # the second session's open
    stage = CandleStage(StageContext(cal, 0, 100_000_000, FeatureConfig()))
    settled = later + stage.warmup() * NS
    assert settled < end

    def build(start):
        p = Pipeline(cal, feed_latency=0, close_delay=100_000_000)
        rows = p.process(MarketChunk("X", start, end, t, cov))
        return rows.tables["candle_1m_1s"].values

    a, b = build(T0), build(later)

    def worst(after: int) -> float:
        """Largest difference between the builds after `after`, relative to each feature's range."""
        sel_a, sel_b = a["end_ns"] > after, b["end_ns"] > after
        np.testing.assert_array_equal(a["end_ns"][sel_a], b["end_ns"][sel_b])
        out = 0.0
        for name in FEATURE_COLUMNS:
            x, y = a[name][sel_a], b[name][sel_b]
            both = np.isfinite(x) & np.isfinite(y)
            if both.any():
                scale = max(np.nanpercentile(x, 99) - np.nanpercentile(x, 1), 1e-12)
                out = max(out, np.max(np.abs(x[both] - y[both])) / scale)
        return out

    sel_a, sel_b = a["end_ns"] > settled, b["end_ns"] > settled
    for name in FEATURE_COLUMNS:  # defined in the same rows once settled
        np.testing.assert_array_equal(
            np.isfinite(a[name][sel_a]), np.isfinite(b[name][sel_b]), err_msg=name
        )
    assert worst(settled) <= warmup.TOLERANCE  # settled within the declared warm-up
    assert worst(later + stage.warmup() * NS // 2) > warmup.TOLERANCE  # and not before it


def test_a_minute_equals_the_window_that_ends_with_it_to_the_bit():
    """One summation order (oldest first) for floating-point sums: combining a minute's seconds
    and summing the rolling window that ends at that minute give identical bits."""
    from strategy_core.bars import Rollup, aggregate
    from strategy_core.market import MINUTE, SECOND
    from strategy_core.windows import FAST, RollingWindow

    cal = calendar((0, 2))
    end = T0 + 2 * HOUR
    t = random_trades(T0, end, seed=8, rate=3)
    cov = np.array([[T0, end]], np.int64)
    ends = cal.slot_ends(T0, end, SECOND)
    seconds = aggregate(t, ends, SECOND, cov, feed_latency=0, close_delay=100_000_000).bars
    minutes = Rollup(SECOND, MINUTE).update(seconds)
    windows = RollingWindow(FAST, cal).update(seconds)
    at = np.searchsorted(windows.end, minutes.end)
    np.testing.assert_array_equal(windows.end[at], minutes.end)
    traded = minutes.volume > 0
    assert traded.sum() > 100
    np.testing.assert_array_equal(
        windows.vwap[at][traded], minutes.pv[traded] / minutes.volume[traded]
    )
