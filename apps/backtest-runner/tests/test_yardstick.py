from datetime import date

import numpy as np
import pytest
from backtest_runner import dataset, yardstick
from strategy_core import targets
from strategy_core.engine import MarketChunk, session_view
from strategy_core.market import HOUR, NS, PRODUCTS, PX, SessionCalendar
from strategy_core.pipeline import STAGES, StageFeatures
from strategy_core.synthetic import random_book, random_trades

T0 = 1_767_571_200 * NS  # 2026-01-05 00:00 UTC
BASE = date(2000, 1, 1)


def days(first: date, count: int) -> np.ndarray:
    return (first - BASE).days + np.arange(count)


def test_the_dataset_reads_the_engines_features_by_its_names_and_in_its_order():
    ids = {s.NAME: k + 1 for k, s in enumerate(STAGES) if hasattr(s, "VARIANT")}
    names, query, needed = dataset.plan(ids)
    cal = SessionCalendar("t", np.array([0], np.int64), np.array([HOUR], np.int64))
    engine = StageFeatures(cal, feed_latency=0, close_delay=0)
    assert names == [spec.name for spec in engine.specs()]
    assert len(names) == len(set(names)) > 700
    # the rows are the seconds that end a minute, where every slower row ends at the same instant
    assert "% 60 = 0" in query.replace("%%", "%") and query.count("LEFT JOIN") == len(needed) - 1
    assert ".slot_ordinal / 10 " in query and ".slot_ordinal / 60 " in query
    assert ("vol_1m", 0) in needed and ("pivot_1m", ids["pivot_1m:slow_atr_3"]) in needed
    assert set(yardstick.GATE) <= set(names)


def test_every_feature_belongs_to_one_kind_of_input():
    names = list(StageFeatures.sources())
    kinds = [yardstick.group_of(n) for n in names]
    assert set(kinds) == set(yardstick.GROUPS)
    assert yardstick.group_of("1m@1s.rsi") == "price"
    assert yardstick.group_of("1m@1s.delta_ratio") == "flow"
    assert yardstick.group_of("10m@10s.imbalance_vw") == "book"
    assert yardstick.group_of("1h@1m.atr5_bps") == "volatility"
    assert yardstick.group_of("1h@1m.slow_atr_3.structure") == "swings"
    assert yardstick.group_of("1m@1s.session_elapsed_s") == "session"
    assert yardstick.group_of("1h@1m.age_s") == "session"


def test_a_month_is_scored_by_a_model_fitted_before_its_last_earlier_session():
    day = np.repeat(days(date(2026, 3, 30), 70), 3)  # March 30 to June 7
    found = yardstick.folds(day)
    assert [m for m, _, _ in found] == [5, 6]  # April is training only; July has no rows
    _, train, test = found[0]
    may = (date(2026, 5, 1) - BASE).days
    assert day[test].min() == may and day[test].max() == may + 30
    assert day[train].max() == may - 2  # April 30, the last session before May, is left out
    assert not (train & test).any()
    # with nothing before May, May is not scored and June is scored from May
    assert [m for m, _, _ in yardstick.folds(day[day >= may])] == [6]


def data(rows_a_day=120, seed=0):
    """Two products, January 5 to June 30: the target follows the first feature, the second is
    noise, the third has no value before May, and the last is always missing."""
    rng = np.random.default_rng(seed)
    day = np.repeat(days(date(2026, 1, 5), 177), rows_a_day)
    day = np.r_[day, day]
    n = len(day)
    product = np.repeat([0, 1], n // 2).astype(np.int8)
    x = rng.normal(size=(n, 4)).astype(np.float32)
    x[day < (date(2026, 5, 1) - BASE).days, 2] = np.nan
    x[:, 3] = np.nan
    y = np.clip(0.3 * x[:, 0] + rng.normal(0, 0.6, n), -1, 1)
    return x, y, day, product


def test_the_walk_forward_forecast_finds_a_real_signal_and_only_scores_test_months():
    x, y, day, product = data()
    usable = np.ones(len(y), bool)
    usable[::7] = False
    for fit in (yardstick.fit_trees, yardstick.fit_ridge):
        forecast, models = yardstick.walk_forward(x, y, day, usable, fit, keep=True)
        scored = np.isfinite(forecast)
        may = (date(2026, 5, 1) - BASE).days
        assert (day[scored] >= may).all() and not scored[~usable].any()
        assert scored[usable & (day >= may)].all()
        assert sorted(models) == [5, 6]
        assert models[5]["columns"].tolist() == [0, 1]  # no value in training: left out
        assert models[6]["columns"].tolist() == [0, 1, 2]
        found = yardstick.skill(forecast, y, day, product, ["GC", "SI"])
        pooled = found["rank_correlation"]
        assert pooled["trade_dates"] == 61 and pooled["interval_95"][0] > 0.2
        assert set(found["by_product"]) == {"GC", "SI"} and set(found["by_month"]) == {
            "2026-05", "2026-06",
        }  # fmt: skip
        assert found["squared_error_ratio_to_flat"] < 0.9
        assert found["squared_error_minus_flat"]["interval_95"][1] < 0
    # a forecast of noise has no skill, and an interval that says so
    noise = np.where(scored, np.random.default_rng(1).normal(size=len(y)), np.nan)
    lo, hi = yardstick.skill(noise, y, day, product, ["GC", "SI"])["rank_correlation"][
        "interval_95"
    ]
    assert lo < 0 < hi
    assert yardstick.skill(np.full(len(y), np.nan), y, day, product, ["GC"])["rows"] == 0


def test_openings_take_the_side_forecast_beyond_the_cost_and_respect_the_gate():
    day = np.repeat(days(date(2026, 5, 4), 4), 5)
    product = np.zeros(20, np.int8)
    forecast = np.tile([0.5, -0.5, 0.06, -0.06, np.nan], 4)
    y = np.tile([1.0, -1.0, 1.0, 1.0, 1.0], 4)
    cost = np.full(20, 0.1)
    long_ok = np.ones(20, bool)
    long_ok[:5] = False  # the first date's longs are against a trend
    out = yardstick.openings(forecast, y, cost, day, product, ["GC"], long_ok, np.ones(20, bool))
    assert out["rows"] == 16
    rule = out["ungated"]["1x_cost"]
    assert (rule["all"]["rows"], rule["buys"]["rows"], rule["sells"]["rows"]) == (8, 4, 4)
    assert rule["all"]["net_r_per_row"]["mean"] == pytest.approx(0.9)  # 1 R less the cost
    assert out["gated"]["1x_cost"]["buys"]["rows"] == 3 and out["gated"]["rows_long_allowed"] == 12
    # half the cost lets the weak forecasts in: a sell that was wrong loses 1 R and the cost
    loose = out["ungated"]["0.5x_cost"]
    assert loose["all"]["rows"] == 16 and loose["sells"]["net_r_per_row"]["mean"] == pytest.approx(
        (0.9 - 1.1) / 2
    )
    assert out["ungated"]["4x_cost"]["all"]["rows"] == 8


def test_a_session_gives_eligibility_cost_and_targets_for_each_row():
    product = PRODUCTS["GC"]
    cal = SessionCalendar("test", np.array([T0], np.int64), np.array([T0 + 6 * HOUR], np.int64))
    t = random_trades(T0, T0 + 6 * HOUR, seed=3, rate=2)
    cover = np.array([[T0, T0 + 6 * HOUR]])
    chunk = MarketChunk("GCZ6", T0, T0 + 6 * HOUR, t, cover, "s", True, random_book(t, seed=5))
    view = session_view(chunk, cal, dataset.EXECUTION)
    seconds = [600, 900, 1200, 6 * 3600 - 3000, 1500]
    # ordinal, row end, the slow ATR in price units, two features
    found = [
        (60 * k, T0 + s * NS, atr, 1.5, None)
        for k, (s, atr) in enumerate(zip(seconds, [2.0, 2.0, None, 2.0, 0.01], strict=True))
    ]
    out = dataset.session_rows(product, cal, view, cover, found, False)
    # no ATR; under an hour before the forced exit; a stop of 0.015 is narrower than 4 spreads
    assert out["why"].tolist() == [0, 0, dataset.NO_ATR, dataset.NO_ROOM, dataset.WIDE]
    assert out["x"].dtype == np.float32 and np.isnan(out["x"][:, 1]).all()
    assert np.isfinite(out["y"][:2]).all() and np.isnan(out["y"][2:]).all()
    assert (np.abs(out["y"][:2]) <= 1).all() and (out["state"][:2] == targets.KNOWN).all()
    assert out["moves"].shape == (5, len(dataset.HORIZONS_S)) and np.isfinite(out["moves"][0]).all()
    # the cost of a round trip in R: the spread and both commissions over 1.5 ATRs
    seen = view.book.known(int(found[0][1]))
    commission = 2 * 2.5 / product.tick_value * product.tick_size
    assert out["cost_r"][0] == pytest.approx(
        (seen.ask - seen.bid + commission) / round(1.5 * 2.0 * PX)
    )
    flagged = dataset.session_rows(product, cal, view, cover, found, True)
    assert flagged["why"].tolist()[:2] == [dataset.FLAGGED] * 2 and np.isnan(flagged["y"]).all()


def test_the_holdout_is_refused():
    with pytest.raises(ValueError, match="holdout"):
        yardstick.run(["GC"], date(2026, 8, 1), date(2026, 9, 1))


def test_the_policy_opens_beyond_the_cost_and_closes_by_its_rule():
    from backtest_runner import policy

    f = {
        policy.FORECAST: np.array([0.5, -0.5, 0.02, -0.02, 0.5, 0.5, 0.0]),
        "exec.spread_r": np.array([0.03, 0.03, 0.03, 0.03, 0.4, np.nan, 0.03]),
        "exec.commission_r": np.full(7, 0.01),
        "slow": np.array([-1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    }
    gated = policy.ModelPolicy("unused.joblib", gate=("slow",))
    free = policy.ModelPolicy("unused.joblib", gate=())
    # beyond the cost of 0.04 R: a buy, a sell; inside it: nothing; a spread over a quarter of
    # R, or no usable book: nothing. The slow trend is down in the first two rows: no long
    assert free.signals(f).tolist() == [1, -1, 0, 0, 0, 0, 0]
    assert gated.signals(f).tolist() == [0, -1, 0, 0, 0, 0, 0]
    assert policy.ModelPolicy("unused.joblib", threshold=0.25, gate=()).signals(f).tolist() == [
        1, -1, 1, -1, 0, 0, 0,
    ]  # fmt: skip
    hold, turn, opposite = (
        policy.ModelPolicy("unused.joblib", close=c, gate=("slow",)).closes(f)
        for c in policy.CLOSES
    )
    assert not hold[0].any() and not hold[1].any()
    # turn: a long is closed once the forecast is not above zero, whatever the gate or the book
    assert turn[0].tolist() == [False, True, False, True, False, False, True]
    assert turn[1].tolist() == [True, False, True, False, True, True, True]
    # opposite: only by the forecast that would open the other side
    assert opposite[0].tolist() == [False, True, False, False, False, False, False]
    # (a wide book never blocks closing: 0.5 is beyond even the cost of the 0.4 R spread)
    assert opposite[1].tolist() == [True, False, False, False, True, False, False]
    assert len(policy.CELLS) == 8 and policy.CELLS[0] == ("hold", "cross", True)
    assert (
        policy.BRACKET.max_hold_s is None and policy.BRACKET.target_atr == policy.BRACKET.stop_atr
    )
    with pytest.raises(ValueError, match="close must be"):
        policy.ModelPolicy("unused.joblib", close="flip")


def test_a_cell_report_counts_dates_without_a_trade_and_pairs_products():
    from backtest_runner import policy

    key = ("hold", "cross", True, "base")
    may = (date(2026, 5, 4) - BASE).days

    def part(product, r, day):
        cell = {
            "summary": {"signal_rows": 9, "cancelled_orders": 0, "expired_orders": 1,
                        "sessions_at_daily_limit": 0, "exit_reasons": {"stop": len(r)}},
            "day": np.array(day), "side": np.array([1, -1][: len(r)], np.int8),
            "r": np.array(r), "stop_ticks": np.full(len(r), 300.0),
            "flagged_exit": np.zeros(len(r), bool),
        }  # fmt: skip
        return {"product": product, "month": 5, "days": [may, may + 1, may + 2],
                "flagged_sessions": [], "cells": {key: cell}}  # fmt: skip

    out = policy.cell_report([part("GC", [1.0, -1.0], [may, may]), part("SI", [-1.0], [may + 2])],
                             key, ["GC", "SI"])  # fmt: skip
    assert out["trade_dates"] == 3 and out["all"]["trades"] == 3 and out["expired_orders"] == 2
    # commission: $5 on a stop of 300 ticks at $10 (GC) or $25 (SI)
    gc, si = 5 / 3000, 5 / 7500
    assert out["GC"]["net_r"] == pytest.approx(-2 * gc, abs=1e-3)
    assert out["all"]["net_r_per_trade_date"]["mean"] == pytest.approx(
        (-2 * gc - 1 - si) / 3, abs=1e-4
    )
    assert out["buys"]["trades"] == 2 and out["sells"]["trades"] == 1
    assert out["by_month"]["2026-05"]["trades"] == 3 and out["by_month"]["2026-06"]["trades"] == 0
    # micro: $2.50 a round trip on a stop of $300 (MGC) or $1,500 (SIL); $500 buys one MGC, no SIL
    assert out["micro_costs"]["net_r"] == pytest.approx(-2 * 2.5 / 300 - 1 - 2.5 / 1500, abs=1e-3)
    assert out["account_100k_whole_micro_contracts"]["trades_too_large_for_the_risk"] == 1
    assert out["daily"].tolist() == pytest.approx([-2 * gc, 0.0, -1 - si])
