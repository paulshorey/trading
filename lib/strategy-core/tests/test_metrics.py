"""Per-second TBBO metrics and their rolling windows (docs/project/ingestion.md)."""

import numpy as np
import pytest
from helpers import T0, calendar, coverage, trades
from strategy_core.bars import Aggregation, AggregationReport, BaseBars, aggregate
from strategy_core.market import NS, PX, SECOND
from strategy_core.metrics import FIELDS, FIRST, LAST, MAX, MIN, second_metrics
from strategy_core.synthetic import random_trades
from strategy_core.window_metrics import MetricWindow

KW = {"feed_latency": 0, "close_delay": 100_000_000}
TICK = 0.25

# The handoff's numeric reference second (section 9.1): tick 0.25, three ordered trades.
REFERENCE = [
    # (ts, price, size, side, recv delay, bid, ask, bid size, ask size)
    (T0 + 100_000_000, 100.25, 10, 1, 1000, 100.00, 100.25, 300, 100),
    (T0 + 200_000_000, 100.00, 20, -1, 1000, 100.00, 100.25, 100, 300),
    (T0 + 300_000_000, 100.50, 30, 1, 1000, 100.25, 100.50, 400, 100),
]


def one_second(rows):
    cal = calendar((0, 1))
    ends = cal.slot_ends(T0, T0 + 2 * NS, SECOND)
    t = trades(rows)
    agg = aggregate(t, ends, SECOND, coverage(cal), **KW)
    return agg.bars, second_metrics(t, agg)


def test_handoff_reference_second():
    b, m = one_second(REFERENCE)
    assert [b.open[0], b.high[0], b.low[0], b.close[0]] == [
        round(x * PX) for x in (100.25, 100.50, 100.00, 100.50)
    ]
    assert (b.volume[0], b.buy[0], b.sell[0], b.trades[0]) == (60, 40, 20, 3)
    assert b.pv[0] * PX == pytest.approx(6_017_500_000_000)  # exact price-volume sum
    assert b.pv[0] / b.volume[0] == pytest.approx(100.2916666667)
    # CVD prefixes 0, +10, -10, +20: with a session CVD of 100, OHLC 100, 120, 90, 120
    assert (b.delta_high[0], b.delta_low[0], b.buy[0] - b.sell[0]) == (20, -10, 20)
    assert m["spread_sum"][0] / m["quote_trades"][0] / PX == TICK  # mean spread 1 tick
    assert m["spread_max"][0] / PX == TICK
    mid = [m[k][0] / 2 / PX for k in ("mid2_open", "mid2_high", "mid2_low")]
    mid_close = (m["last_bid"][0] + m["last_ask"][0]) / 2 / PX
    assert [*mid, mid_close] == [100.125, 100.375, 100.125, 100.375]
    # Book score J = 100 B / (B + A): 75, 25, 80 per trade; mean 60, last 80, VW 60.83
    assert 100 * m["imbalance_sum"][0] / m["depth_trades"][0] == pytest.approx(60)
    assert 100 * m["imbalance_last"][0] == pytest.approx(80)
    vw = 100 * m["imbalance_volume_sum"][0] / m["depth_volume"][0]
    assert vw == pytest.approx(60.8333333333)
    bid_mean = m["bid_depth_sum"][0] / 3
    ask_mean = m["ask_depth_sum"][0] / 3
    assert (bid_mean, ask_mean) == pytest.approx((266.6666666667, 166.6666666667))
    assert 100 * bid_mean / (bid_mean + ask_mean) == pytest.approx(61.5384615385)  # not 60
    alignment = m["alignment_sum"][0] / m["known_depth_volume"][0]
    assert alignment == pytest.approx(0.55) and 50 * (1 + alignment) == pytest.approx(77.5)
    # Last weighted midpoint 100.45, tilt +0.3 tick: tilt = spread x imbalance / 2
    last_tilt = 0.25 * (400 - 100) / 500 / 2
    assert mid_close + last_tilt == pytest.approx(100.45)
    assert last_tilt / TICK == pytest.approx(0.3)
    # Effective spread: one tick for each trade and for the volume-weighted mean
    eff = m["eff_spread_sum"][0] / m["known_quote_volume"][0] / PX
    assert eff / TICK == pytest.approx(1.0)


def test_unknown_side_and_unusable_books_keep_volume_but_not_their_statistics():
    rows = [
        *REFERENCE,
        (T0 + 400_000_000, 100.50, 5, 0, 1000, 100.25, 100.50, 400, 100),  # unknown side
        (T0 + 500_000_000, 100.50, 7, 1, 1000, 100.75, 100.50, 1, 1),  # crossed book
        (T0 + 600_000_000, 100.50, 2, -1, 1000, 100.25, 100.50, 0, 0),  # no displayed size
    ]
    b, m = one_second(rows)
    assert (b.volume[0], b.buy[0] - b.sell[0]) == (74, 20 + 7 - 2)
    assert m["quote_volume"][0] == 60 + 5 + 2  # quote-only statistics include unknown side
    assert m["known_quote_volume"][0] == 60 + 2
    assert (m["quote_trades"][0], m["depth_trades"][0]) == (5, 4)
    assert m["depth_volume"][0] == 65 and m["known_depth_volume"][0] == 60
    assert m["spread_max"][0] == round(TICK * PX)  # the crossed book is excluded


def test_path_sweeps_switches_and_sizes():
    rows = [
        (T0 + 10, 10.0, 2, 1, 1000, 9.9, 10.0, 5, 5),
        (T0 + 20, 10.2, 3, 1, 1000, 10.0, 10.1, 5, 5),  # buyer through the ask: a sweep
        (T0 + 30, 10.1, 1, -1, 1000, 10.1, 10.2, 5, 5),
        (T0 + 40, 10.1, 4, 0, 1000, 10.0, 10.1, 5, 5),
        (T0 + 50, 10.0, 1, -1, 1000, 10.05, 10.1, 5, 5),  # seller below the bid
    ]
    _, m = one_second(rows)
    assert m["path_abs"][0] == round(0.2 * PX) + round(0.1 * PX) + 0 + round(0.1 * PX)
    assert (m["upticks"][0], m["downticks"][0]) == (1, 2)
    assert (m["side_pairs"][0], m["side_switches"][0]) == (2, 1)
    assert (m["sweep_buy_volume"][0], m["sweep_sell_volume"][0]) == (3, 1)
    assert (m["size_sq"][0], m["max_size"][0]) == (4 + 9 + 1 + 16 + 1, 4)
    assert (m["buy_trades"][0], m["sell_trades"][0]) == (2, 2)
    assert (m["first_at"][0], m["last_at"][0]) == (T0 + 10, T0 + 50)


def direct(t, kept: np.ndarray, at: np.ndarray, end: int) -> dict[str, np.ndarray]:
    """Metrics of a set of trades aggregated as one slot: the brute-force window."""
    bars = BaseBars.blank(SECOND, np.array([end]), np.array([2], np.int8))
    bars.trades[0] = len(kept)
    agg = Aggregation(bars, AggregationReport(), kept, np.full(len(kept), end), at)
    return second_metrics(t, agg)


def test_window_metrics_equal_direct_aggregation_in_any_chunking():
    cal = calendar((0, 0.05), (0.1, 0.25))  # 3 open minutes, a 3-minute closure, 9 open
    t = random_trades(T0, T0 + 900 * NS, seed=4, rate=1.5)
    cov = np.array([[T0, T0 + 700 * NS], [T0 + 760 * NS, T0 + 900 * NS]], np.int64)
    ends = cal.slot_ends(T0, T0 + 900 * NS, SECOND)
    agg = aggregate(t, ends, SECOND, cov, **KW)
    m = second_metrics(t, agg)
    whole = MetricWindow(60).update(agg.bars, m)
    w, parts = MetricWindow(60), []
    for i in range(0, len(ends), 13):
        part = {k: v[i : i + 13] for k, v in m.items()}
        parts.append(w.update(agg.bars.take(slice(i, i + 13)), part))
    for name, values in whole.items():
        np.testing.assert_array_equal(
            np.concatenate([p[name] for p in parts]), values, err_msg=name
        )

    row_of_trade = np.searchsorted(ends, agg.slot_end)
    within_second = {"side_pairs", "side_switches"}  # these do not bridge seconds
    checked = 0
    for i in range(59, len(ends)):
        sel = (row_of_trade >= i - 59) & (row_of_trade <= i)
        if not sel.any():
            continue
        ref = direct(t, agg.order[sel], agg.at[sel], ends[i])
        for f in FIELDS:
            if f.name in within_second:
                continue
            got, want = whole[f.name][i], ref[f.name][0]
            if f.kind in (MAX, MIN, FIRST, LAST) and f.valid and ref.get(f.valid, [1])[0] == 0:
                continue
            assert got == pytest.approx(want, rel=1e-12, abs=1e-9), (f.name, i)
        signed = np.cumsum(t.side[agg.order[sel]] * t.size[agg.order[sel]])
        assert whole["delta_high"][i] == max(signed.max(), 0)
        assert whole["delta_low"][i] == min(signed.min(), 0)
        checked += 1
    assert checked > 500
    # as-of book: the last valid book at or before each row, carried through quiet seconds
    last_row = np.maximum.accumulate(np.where(m["quote_trades"] > 0, np.arange(len(ends)), -1))
    ok = last_row >= 0
    np.testing.assert_array_equal(whole["book_bid"][ok], m["last_bid"][last_row[ok]])
    np.testing.assert_array_equal(whole["last_trade_at"][ok], m["last_at"][last_row[ok]])
