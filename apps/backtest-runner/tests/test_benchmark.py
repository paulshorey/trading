"""The pivot benchmark's rules (docs/project/pivot-label-spec.md) on hand-built series: the
hindsight reference swings, each detector's alarms, the matching, and the walk-forward
comparison; the holdout is refused."""

from datetime import date

import numpy as np
import pytest
from backtest_runner import benchmark
from backtest_runner.benchmark import HIGH, LOW


def series(closes, atr=10.0):
    """Rows that each trade once at `closes` (prices 1000 x exp(bps / 1e4)), all observed."""
    px = 1000.0 * np.exp(np.asarray(closes, float) / 1e4)
    n = len(px)
    return px, px.copy(), np.ones(n, bool), np.zeros(n, bool), np.full(n, atr)


def test_reference_swings_need_the_extreme_of_the_window_and_a_move_on_both_sides():
    # up 30 bps to row 10, down 30 to row 20, up 12 to row 24, down to row 30
    path = [*range(0, 31, 3), *range(27, -1, -3), 3, 6, 9, 12, 9, 6, 3, 1, -1, -3]
    high, low, observed, missing, atr = series(path)
    kinds, rows, eligible = benchmark.reference_swings(high, low, observed, missing, atr, 8, 1.0)
    assert list(zip(kinds, rows, strict=True)) == [(HIGH, 10), (LOW, 20)]
    assert eligible[8:-8].all() and not eligible[:8].any() and not eligible[-8:].any()
    # twice the ATR is 20 bps: the low at row 20 rose only 12 inside its window
    kinds, rows, _ = benchmark.reference_swings(high, low, observed, missing, atr, 8, 2.0)
    assert list(zip(kinds, rows, strict=True)) == [(HIGH, 10)]
    # a missing row inside a window, or no ATR before the row, makes the row ineligible
    gap = missing.copy()
    gap[14] = True
    kinds, rows, eligible = benchmark.reference_swings(high, low, observed, gap, atr, 8, 1.0)
    assert not eligible[6:23].any() and len(rows) == 0
    none = atr.copy()
    none[9] = np.nan
    kinds, rows, eligible = benchmark.reference_swings(high, low, observed, missing, none, 8, 1.0)
    assert not eligible[10] and list(rows) == [20]
    # equal highs: the first one is the swing
    flat = [*range(0, 31, 3), 30, *range(27, -1, -3)]
    kinds, rows, _ = benchmark.reference_swings(*series(flat), 8, 1.0)
    assert (HIGH, 10) in list(zip(kinds, rows, strict=True)) and 11 not in rows


def test_each_detector_says_when_it_knows_and_which_row_it_claims():
    path = [*range(0, 31, 3), *range(27, -1, -3), *range(3, 31, 3)]  # high at 10, low at 20
    high, low, observed, _, atr = series(path)
    valid = np.ones(len(high), bool)
    kinds, known, claimed = benchmark.fractal_alarms(high, low, observed, 4)
    assert list(zip(kinds, known, claimed, strict=True)) == [(HIGH, 14, 10), (LOW, 24, 20)]
    kinds, known, claimed = benchmark.slope_alarms(high, valid, high, low, 6)
    # the slope of the last six rows turns negative three rows after the high
    assert list(zip(kinds, known, claimed, strict=True)) == [(HIGH, 13, 10), (LOW, 23, 20)]
    # with an ATR of 9 bps, 3 bps a row is a third of an ATR: less the 0.05 allowance, four
    # rows reach 1 ATR
    kinds, known, claimed = benchmark.cusum_alarms(high, valid, atr * 0.9, 0.05, 1.0)
    assert list(zip(kinds, known, claimed, strict=True))[:2] == [(LOW, 4, 0), (LOW, 8, 4)]
    assert (HIGH, 14, 10) in list(zip(kinds, known, claimed, strict=True))
    # a row without a price restarts the slope's sign and the sums
    valid[12] = False
    assert HIGH not in benchmark.slope_alarms(high, valid, high, low, 6)[0][:1]


def test_matching_is_one_to_one_by_time_and_claimed_row():
    reference = np.array([100, 200, 300])
    known = np.array([90, 105, 110, 230, 460])
    claimed = np.array([88, 100, 101, 215, 300])
    delay, error, used = benchmark.match(reference, known, claimed, 50, 5)
    # 100: the alarm at 105 (the one at 90 came before it); 200: an alarm in time claims a row
    # 15 away; 300: its alarm comes after the window
    assert list(delay) == [5, -1, -1] and list(error) == [0, 15, -1]
    assert list(used) == [False, True, False, False, False]
    tally = benchmark.Tally()
    eligible = np.ones(500, bool)
    alarms = (np.full(5, HIGH), known, claimed)
    tally.add(np.full(3, HIGH), reference, eligible, alarms, 50, 5)
    report = tally.report(1)
    assert (report["swings"], report["coverage"], report["precision"]) == (3, 0.3333, 0.2)
    assert report["false_alarms_per_hour"] == round(4 / (500 / 3600), 3)  # per eligible hour
    assert (report["delay_rows_median"], report["location_error_rows_p90"]) == (5.0, 13.5)
    # per kind, then pooled: the kinds' tallies add up to the whole, over the same eligible rows
    parts = {k: benchmark.Tally() for k in (HIGH, LOW)}
    for k, t in parts.items():
        t.add(np.full(3, HIGH), reference, eligible, alarms, 50, 5, only=k)
    assert parts[LOW].swings == 0 and parts[HIGH].swings == 3
    pooled = benchmark.Tally.pool(parts.values(), parts[HIGH].rows).report(1)
    assert pooled == report


def frame(rows=24_000, signal=1.5, seed=0):
    """Candidates over January to August 2026 for two products: one informative feature, one
    noise, one mostly NULL, one ATR multiple that is sometimes extreme."""
    rng = np.random.default_rng(seed)
    day = rng.integers((date(2026, 1, 2) - date(2000, 1, 1)).days,
                       (date(2026, 8, 31) - date(2000, 1, 1)).days + 1, rows)  # fmt: skip
    informative = rng.normal(size=rows)
    y = rng.random(rows) < 1 / (1 + np.exp(-signal * informative))
    outcome = np.where(y, 1, np.where(rng.random(rows) < 0.8, 2, 3))
    outcome[:40] = 4
    outcome[40:60] = 5
    sparse = np.where(rng.random(rows) < 0.5, np.nan, 1.0)
    wide = rng.normal(size=rows)
    wide[60:90] = 80.0
    data = np.column_stack([
        rng.integers(0, 2, rows), day, rng.integers(1, 3, rows), outcome,
        (rng.random(rows) < 0.5).astype(float), rng.random(rows) * 0.5,
        informative, rng.normal(size=rows), sparse, wide,
    ]).astype(np.float32)  # fmt: skip
    data[90:100, 7] = np.nan
    names = ["a.signal", "a.noise", "a.sparse", "a.wide_atr"]
    return {"data": data, "names": names, "sessions": {"GC": {}, "SI": {}}}


def test_walk_forward_comparison_counts_what_it_leaves_out_and_finds_a_real_signal():
    report = benchmark.evaluate(frame(), False)
    assert (report["session_end"], report["unknown"]) == (40, 20)
    assert report["extreme_atr"] == 30 and report["null_input"] == 10
    assert report["dropped_features"] == ["a.sparse"] and report["features"] == 3
    assert not report["skipped_folds"]
    result = report["results"]["all"]
    assert set(report["results"]) == {"all", "GC", "SI"}
    assert result["rows"] == result["sessions"] or result["sessions"] <= 246  # two products' days
    for model in ("logistic", "boosted"):
        assert result[model]["roc_auc"] > 0.75 and result[model]["log_loss"] < 0.6
    assert 0.49 < result["prior"]["roc_auc"] < 0.51 or result["prior"]["roc_auc"] == 0.5
    gain = result["log_loss_gain"]["boosted_over_random_walk"]
    assert gain["mean"] > 0.1 and gain["interval_95"][0] > 0.05
    # only provisional candidates, when asked
    assert benchmark.evaluate(frame(), True)["provisional"] < report["candidates"]
    # no signal: no model beats the training rows' reversal rate
    flat = benchmark.evaluate(frame(signal=0.0), False)["results"]["all"]
    assert flat["log_loss_gain"]["boosted_over_prior"]["mean"] < 0.002
    # test rows are scored only by models trained on earlier sessions: May to August
    tested = frame()
    early = tested["data"][:, 1] < (date(2026, 5, 1) - date(2000, 1, 1)).days
    kept = early & (tested["data"][:, 3] <= 3)
    assert report["rows_scored"] < len(tested["data"]) - kept.sum()


def test_input_sets_are_compared_on_the_same_rows_and_an_informative_set_shows_a_gain():
    tested = frame()
    # the informative column reaches the models only with the last set
    tested["sets"] = {
        "base": [1, 2, 3],
        "scales": [1, 2, 3],
        "hour": [1, 2, 3],
        "pair": [0, 1, 2, 3],
    }
    report = benchmark.evaluate(tested, False)
    plain = benchmark.evaluate(frame(), False)
    assert report["rows_scored"] == plain["rows_scored"]  # the population of the largest set
    assert [report["input_sets"][n]["features"] for n in benchmark.CONTEXT_SETS] == [2, 2, 2, 3]
    result = report["results"]["all"]
    assert result["pair"]["boosted"] == plain["results"]["all"]["boosted"]
    for model in ("logistic", "boosted"):
        same = result["hour"]["log_loss_gain_over_base"][model]
        assert same["mean"] == 0 and same["interval_95"] == [0, 0]
        gain = result["pair"]["log_loss_gain_over_base"][model]
        assert gain["mean"] > 0.1 and gain["interval_95"][0] > 0.05
        assert result["base"][model]["roc_auc"] < 0.55 < 0.75 < result["pair"][model]["roc_auc"]


def test_the_holdout_is_refused():
    with pytest.raises(ValueError, match="holdout"):
        benchmark.detectors(["GC"], date(2026, 8, 1), date(2026, 9, 1))
    with pytest.raises(ValueError, match="holdout"):
        benchmark.models(["GC"], date(2026, 8, 1), date(2026, 11, 6))
    benchmark.check_period(benchmark.DEV_START, benchmark.DEV_END)
    assert benchmark.DEV_END < benchmark.HOLDOUT
