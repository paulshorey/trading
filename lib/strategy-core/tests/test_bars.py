import numpy as np
import pytest
from helpers import T0, calendar, coverage, trades
from strategy_core.bars import MISSING, NO_TRADES, OBSERVED, BaseBars, Rollup, aggregate
from strategy_core.market import MINUTE, NS, SECOND, SessionCalendar
from strategy_core.synthetic import random_trades

CAL = calendar((0, 1))
ENDS = CAL.slot_ends(T0, T0 + 4 * NS, SECOND)


def bars_for(rows, cov=None, **kw):
    kw = {"feed_latency": 0, "close_delay": 100_000_000, **kw}
    agg = aggregate(trades(rows), ENDS, SECOND, coverage(CAL) if cov is None else cov, **kw)
    return agg.bars, agg.report


def test_trade_on_boundary_belongs_to_later_slot_and_empty_slots_are_kept():
    b, report = bars_for([(T0 + 200, 10.0, 2, 1), (T0 + NS, 10.5, 3, -1)])
    assert b.end.tolist() == [T0 + NS * k for k in range(1, 5)]
    assert b.status.tolist() == [OBSERVED, OBSERVED, NO_TRADES, NO_TRADES]
    assert b.volume.tolist() == [2, 3, 0, 0]
    assert (b.buy.tolist(), b.sell.tolist()) == ([2, 0, 0, 0], [0, 3, 0, 0])
    assert report.trades == 2 and report.outside_schedule == 0


def test_ohlc_extreme_times_side_volume_and_running_delta():
    rows = [
        (T0 + 100, 10.0, 2, 1),
        (T0 + 200, 10.3, 1, -1),
        (T0 + 300, 9.8, 4, -1),
        (T0 + 400, 10.3, 1, 0),
        (T0 + 500, 10.1, 3, 1),
    ]
    b, report = bars_for(rows)
    assert b.open[0] == 10_000_000_000 and b.close[0] == 10_100_000_000
    assert (b.high[0], b.low[0]) == (10_300_000_000, 9_800_000_000)
    assert (b.high_at[0], b.low_at[0]) == (T0 + 200, T0 + 300)  # ties resolve to the earliest
    assert (b.volume[0], b.buy[0], b.sell[0], b.trades[0]) == (11, 5, 5, 5)
    # running buy - sell: 2, 1, -3, -3, 0 -> extremes from the slot start (0) are 2 and -3
    assert (b.delta_high[0], b.delta_low[0]) == (2, -3)
    assert report.unknown_side_volume == 1
    assert b.pv[0] == pytest.approx(10.0 * 2 + 10.3 + 9.8 * 4 + 10.3 + 10.1 * 3)


def test_duplicate_timestamps_are_separate_trades():
    b, report = bars_for([(T0 + 100, 10.0, 1, 1), (T0 + 100, 10.1, 1, 1), (T0 + 100, 10.0, 1, 1)])
    assert (b.trades[0], b.volume[0], report.trades) == (3, 3, 3)


def test_late_trade_joins_the_slot_open_when_it_arrived():
    # Event time 0.5 s, but received 1.2 s later: slot 1 closed at 1.1 s, so it lands in slot 2.
    b, report = bars_for([(T0 + NS // 2, 10.0, 1, 1, 1_200_000_000)])
    assert b.status.tolist()[:2] == [NO_TRADES, OBSERVED]
    assert report.late_trades == 1


def test_missing_coverage_is_not_a_closure_and_closed_time_has_no_slots():
    cov = np.array([[T0, T0 + 2 * NS]], np.int64)
    b, report = bars_for([(T0 + 3 * NS + 5, 10.0, 1, 1)], cov=cov)
    assert b.status.tolist() == [NO_TRADES, NO_TRADES, MISSING, MISSING]
    assert report.in_missing_slots == 1 and report.missing_slots == 2
    cal = calendar((0, 1 / 60), (2 / 60, 3 / 60))  # open one minute, closed one, open one
    ends = cal.slot_ends(T0, T0 + 3 * MINUTE, MINUTE)
    assert ends.tolist() == [T0 + MINUTE, T0 + 3 * MINUTE]


def test_rollup_matches_direct_minute_aggregation_in_any_chunking():
    cal = calendar((0, 0.5), (1, 1.5))
    t = random_trades(T0, T0 + 2 * 3600 * NS, seed=3, rate=4)
    cov = np.array([[T0, T0 + 20 * MINUTE], [T0 + 25 * MINUTE, T0 + 2 * 3600 * NS]], np.int64)
    kw = {"feed_latency": 0, "close_delay": 100_000_000}
    seconds = aggregate(t, cal.slot_ends(T0, T0 + 7200 * NS, SECOND), SECOND, cov, **kw).bars
    direct = aggregate(t, cal.slot_ends(T0, T0 + 7200 * NS, MINUTE), MINUTE, cov, **kw).bars
    batch = Rollup(SECOND, MINUTE).update(seconds)
    roll = Rollup(SECOND, MINUTE)
    stepwise = BaseBars.concat(
        MINUTE, [roll.update(seconds.take(slice(i, i + 1))) for i in range(len(seconds))]
    )
    for name in BaseBars.ARRAYS:
        a, b, c = getattr(direct, name), getattr(batch, name), getattr(stepwise, name)
        if name == "pv":
            np.testing.assert_allclose(b, a)
            np.testing.assert_allclose(c, a)
        else:
            np.testing.assert_array_equal(b, a, err_msg=name)
            np.testing.assert_array_equal(c, a, err_msg=name)
    assert (batch.status == MISSING).sum() == 5


def test_calendar_validation_and_close_lookup():
    with pytest.raises(ValueError):
        SessionCalendar("bad", np.array([T0 + 5], np.int64), np.array([T0 + MINUTE], np.int64))
    cal = calendar((0, 1), (2, 3))
    closes = cal.close_after(np.array([T0 + 1, T0 + 3600 * NS, T0 + 7200 * NS + 1]))
    assert closes.tolist() == [T0 + 3600 * NS, T0 + 3600 * NS, T0 + 3 * 3600 * NS]
