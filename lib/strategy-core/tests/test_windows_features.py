import numpy as np
import pytest
from helpers import T0, calendar, wilder_rsi_reference
from strategy_core.bars import BaseBars, aggregate
from strategy_core.features import (
    WINDOW_FEATURES,
    FeatureConfig,
    FeaturePipeline,
    FeatureSpec,
    Unit,
    WindowFeatures,
)
from strategy_core.market import HOUR, MINUTE, NS, PX, SECOND
from strategy_core.synthetic import random_trades
from strategy_core.windows import (
    BIAS,
    COMPLETE,
    EMPTY,
    FAST,
    GAP,
    WARMUP,
    RollingWindow,
)

KW = {"feed_latency": 0, "close_delay": 100_000_000}


def second_bars(cal, t, cov, start, end):
    return aggregate(t, cal.slot_ends(start, end, SECOND), SECOND, cov, **KW)[0]


def test_rolling_candles_equal_brute_force_aggregation_and_chunking_is_invisible():
    cal = calendar((0, 0.05), (0.1, 0.2))  # 3 open minutes, 3 closed, 6 open
    t = random_trades(T0, T0 + 720 * NS, seed=1, rate=2)
    cov = np.array([[T0, T0 + 500 * NS], [T0 + 540 * NS, T0 + 720 * NS]], np.int64)
    b = second_bars(cal, t, cov, T0, T0 + 720 * NS)
    batch = RollingWindow(FAST, cal).update(b)
    w = RollingWindow(FAST, cal)
    parts = [w.update(b.take(slice(i, i + 7))) for i in range(0, len(b), 7)]
    for name in ("open", "high", "low", "close", "volume", "vwap", "high_at", "status", "start"):
        joined = np.concatenate([getattr(p, name) for p in parts])
        np.testing.assert_array_equal(joined, getattr(batch, name), err_msg=name)
    for i in range(59, len(b)):
        slots = b.take(slice(i - 59, i + 1))
        obs = slots.status == 2
        if batch.status[i] == COMPLETE:
            # every trade here is on time, so the window holds exactly the trades in its slots
            prices = t.price[np.isin((t.ts_event // SECOND + 1) * SECOND, slots.end)]
            assert batch.high[i] == prices.max() / PX and batch.low[i] == prices.min() / PX
            assert batch.open[i] == slots.open[obs][0] / PX
            assert batch.close[i] == slots.close[obs][-1] / PX
            assert batch.volume[i] == slots.volume.sum()
    assert batch.status[:59].tolist() == [WARMUP] * 59
    assert GAP in batch.status.tolist()
    spans = batch.end - batch.start > FAST.period
    assert spans[batch.status != WARMUP].any()  # candles straddling the 3-minute closure


def test_empty_status_when_no_trades_in_window():
    cal = calendar((0, 0.1))
    t = random_trades(T0, T0 + 30 * NS, seed=2)
    b = second_bars(cal, t, np.array([[T0, T0 + 360 * NS]], np.int64), T0, T0 + 360 * NS)
    c = RollingWindow(FAST, cal).update(b)
    assert c.status[200] == EMPTY and np.isnan(c.close[200])


@pytest.mark.parametrize("phase", [0, 7, 59])
def test_phase_series_equals_standard_hourly_candles_and_reference_rsi(phase):
    """Phase 0 reproduces clock-aligned hourly candles; phase k the same grid shifted k minutes."""
    hours = 30
    cal = calendar((0, hours))
    t = random_trades(T0, T0 + hours * HOUR, seed=5, rate=0.5)
    cov = np.array([[T0, T0 + hours * HOUR]], np.int64)
    minutes = aggregate(t, cal.slot_ends(T0, T0 + hours * HOUR, MINUTE), MINUTE, cov, **KW)[0]
    wf = WindowFeatures(BIAS, cal, FeatureConfig(rsi_period=5))
    candles, f, _ = wf.update(minutes)
    sel = candles.phase == phase
    ends = candles.end[sel]
    hourly = aggregate(t, ends, HOUR, cov, **KW)[0]  # independent hourly candles on that grid
    ok = candles.status[sel] == COMPLETE
    np.testing.assert_array_equal(candles.close[sel][ok], hourly.close[ok] / PX)
    np.testing.assert_array_equal(candles.high[sel][ok], hourly.high[ok] / PX)
    np.testing.assert_array_equal(candles.volume[sel][ok], hourly.volume[ok])
    closes = list(hourly.close[ok] / PX)
    ref = np.array([np.nan if v is None else v for v in wilder_rsi_reference(closes, 5)])
    np.testing.assert_allclose(f["1h@1m.rsi"][sel][ok], ref, equal_nan=True)


def test_features_are_scale_invariant_and_declare_normalized_units():
    cal = calendar((0, 6))
    cfg = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)
    t = random_trades(T0, T0 + 6 * HOUR, seed=7, rate=1)
    cov = np.array([[T0, T0 + 6 * HOUR]], np.int64)

    def run(trades):
        return FeaturePipeline(cal, cfg).update(second_bars(cal, trades, cov, T0, T0 + 6 * HOUR))

    base = run(t)
    for scaled in (t.scaled(price_factor=3), t.scaled(size_factor=7)):
        other = run(scaled)
        for name, values in base.features.items():
            np.testing.assert_allclose(
                other.features[name], values, rtol=1e-9, atol=1e-9, equal_nan=True, err_msg=name
            )
    assert all(np.isfinite(base.features[k]).any() for k in base.features), "all-NaN feature"
    specs = FeaturePipeline(cal).specs()
    assert {s.name for s in specs} == set(base.features)
    assert all(isinstance(s.unit, Unit) for s in specs)
    assert {u.value for _, u, _ in WINDOW_FEATURES} <= {u.value for u in Unit}
    with pytest.raises(TypeError):
        FeatureSpec("price", "usd", "raw price")  # type: ignore[arg-type]
    assert not {"price", "usd", "ticks", "contracts", "volume"} & {u.value for u in Unit}


def test_features_are_causal_and_identical_in_any_chunking():
    cal = calendar((0, 1.5), (2, 4))
    cfg = FeatureConfig(rsi_period=2, atr_period=2, volume_period=2)
    t = random_trades(T0, T0 + 4 * HOUR, seed=11, rate=1)
    cov = np.array([[T0, T0 + 4 * HOUR]], np.int64)
    b = second_bars(cal, t, cov, T0, T0 + 4 * HOUR)
    whole = FeaturePipeline(cal, cfg).update(b)
    p = FeaturePipeline(cal, cfg)
    sizes = [1, 59, 600, 1, 3000, 7]
    parts, i, k = [], 0, 0
    while i < len(b):
        parts.append(p.update(b.take(slice(i, i + sizes[k % len(sizes)]))))
        i += sizes[k % len(sizes)]
        k += 1
    joined = parts[0].concat(parts)
    prefix = FeaturePipeline(cal, cfg).update(b.take(slice(0, len(b) // 2)))
    for name, values in whole.features.items():
        np.testing.assert_array_equal(joined.features[name], values, err_msg=name)
        np.testing.assert_array_equal(prefix.features[name], values[: len(b) // 2], err_msg=name)
    bias_ok = np.isfinite(whole.features["1h@1m.rsi"])
    assert bias_ok.any()
    age = whole.features["1h@1m.age_s"][bias_ok]
    assert age.min() == 0 and age.max() >= 59


def test_slot_ordinals_count_scheduled_slots_only():
    cal = calendar((0, 1), (2, 3))  # one-hour closure between two one-hour sessions
    ends = np.array([T0 + MINUTE, T0 + HOUR, T0 + 2 * HOUR + MINUTE, T0 + 3 * HOUR])
    assert cal.slot_ordinals(ends, MINUTE).tolist() == [1, 60, 61, 120]
    assert cal.slot_ordinals(np.array([T0 + 2 * HOUR + NS]), SECOND).tolist() == [3601]
    assert (cal.slot_ordinals(ends, MINUTE) % 60).tolist() == [1, 0, 1, 0]  # clock minutes
    with pytest.raises(ValueError, match="outside"):
        cal.slot_ordinals(np.array([T0 + HOUR + MINUTE]), MINUTE)  # during the closure
    assert len(BaseBars.empty(SECOND)) == 0


def test_phases_count_trading_time_across_an_early_close():
    """Regression (PR #62 review): after a closure that is not a whole hour (an 18:15 early
    close, reopening at 23:00), the previous same-phase bias candle is exactly 60 rows back,
    adjacent and non-overlapping, never the candle with the same clock minute."""
    cal = calendar((0, 18.25), (23, 40))
    t = random_trades(T0, T0 + 40 * HOUR, seed=1, rate=0.5)
    cov = np.array([[T0, T0 + 40 * HOUR]], np.int64)
    minutes = aggregate(t, cal.slot_ends(T0, T0 + 40 * HOUR, MINUTE), MINUTE, cov, **KW).bars
    wf = WindowFeatures(BIAS, cal, FeatureConfig(rsi_period=5))
    candles, f, _ = wf.update(minutes)
    i = int(np.flatnonzero(candles.end == T0 + 23 * HOUR + MINUTE)[0])
    assert candles.start[i] == T0 + 17 * HOUR + 16 * MINUTE  # 60 rows back, not 60 minutes
    for k in range(60, len(candles)):  # same phase means exactly 60 rows apart
        assert candles.phase[k] == candles.phase[k - 60]
        assert len(set(candles.phase[k - 59 : k + 1])) == 60
    assert candles.start[i] == candles.end[i - 60]  # adjacent periods across the closure
    # RSI follows the chain of candles 60 rows apart, as a standard RSI on that series
    chain = np.arange(i % 60, len(candles), 60)
    ok = candles.status[chain] == COMPLETE
    ref = wilder_rsi_reference(list(candles.close[chain][ok]), 5)
    np.testing.assert_allclose(
        f["1h@1m.rsi"][chain][ok], [np.nan if v is None else v for v in ref], equal_nan=True
    )
