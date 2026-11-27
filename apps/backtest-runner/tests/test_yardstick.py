import json
from datetime import date

import numpy as np
import pytest
from backtest_runner import dataset, yardstick
from scipy.stats import spearmanr
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
    swing_scales = sum(table in dataset.SWING_TABLES for table, _ in needed)
    assert (
        query.count(".high_age_s IS NOT NULL")
        == query.count(".low_age_s IS NOT NULL")
        == swing_scales
    )
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
    assert yardstick.group_of("1h@1m.slow_rsi_mean_atr_3.structure") == "series"
    assert yardstick.group_of("10m@10s.mid_cvd_atr_1.progress") == "series"
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
    for fit in (yardstick.fit_trees, yardstick.fit_ridge):  # each takes x, y, and the dates
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
        assert pooled["interval_95"][0] < pooled["value"] < pooled["interval_95"][1]
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
    # ordinal, row end, the slow ATR in price units, swing readiness, two features
    found = [
        (60 * k, T0 + s * NS, atr, True, 1.5, None)
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
    # A later reset loses one confirmed side. Earlier decisions survive and the cold
    # decision remains countable, with its features and no target.
    reset = [*found[:1], (*found[1][:3], False, *found[1][4:]), *found[2:]]
    after = dataset.session_rows(product, cal, view, cover, reset, False)
    assert after["why"].tolist() == [0, dataset.COLD_SWINGS, *out["why"][2:]]
    assert after["y"][0] == out["y"][0] and np.isnan(after["y"][1])
    np.testing.assert_array_equal(after["x"], out["x"])
    flagged = dataset.session_rows(product, cal, view, cover, found, True)
    assert flagged["why"].tolist()[:2] == [dataset.FLAGGED] * 2 and np.isnan(flagged["y"]).all()


def test_the_model_decides_only_on_rows_it_could_have_been_fitted_on():
    """Regression (PR #103 review): training leaves out a row where a swing scale has no
    confirmed high or low yet, but the policy opened on a +1 R forecast there. Such a row now
    opens nothing and closes nothing; the artifact names the features that decide it."""
    from backtest_runner import policy

    slow = "1h@1m.slow_rsi_mean_atr_1"
    names = ["1m@1s.rsi", f"{slow}.high_age_s", f"{slow}.low_age_s",
             "1m@1s.fast_atr_1.low_age_s", "1m@1s.session_elapsed_s"]  # fmt: skip
    assert dataset.readiness(names) == names[1:4]
    f = {
        policy.FORECAST: np.array([1.0, 1.0, -1.0, -1.0]),
        "exec.spread_r": np.full(4, 0.06),
        "exec.commission_r": np.full(4, 0.01),
        names[1]: np.array([60.0, np.nan, 60.0, 60.0]),  # no confirmed RSI high in row 1
        names[2]: np.array([60.0, 60.0, 60.0, 60.0]),
        names[3]: np.array([5.0, 5.0, 5.0, np.nan]),  # no confirmed price low in row 3
    }
    for close in policy.CLOSES:
        model = policy.ModelPolicy("unused.joblib", close=close, gate=(), ready=tuple(names[1:4]))
        assert model.signals(f).tolist() == [1, 0, -1, 0]
        long_exit, short_exit = model.closes(f)
        assert not long_exit[[1, 3]].any() and not short_exit[[1, 3]].any()
    turn = policy.ModelPolicy("unused.joblib", close="turn", gate=(), ready=tuple(names[1:4]))
    assert turn.closes(f)[0].tolist() == [False, False, True, False]
    # an artifact carries the list; one written before it did has it derived from its names
    with_list = policy.ModelPolicy("x", gate=(), loaded={"names": names, "ready": names[1:2]})
    derived = policy.ModelPolicy("x", gate=(), loaded={"names": names})
    assert with_list.signals(f).tolist() == [1, 0, -1, -1]
    assert derived.signals(f).tolist() == [1, 0, -1, 0]


def test_a_saved_model_is_checked_against_the_engine_before_it_is_replayed(tmp_path):
    """Regression (PR #103 review): run 11's models read the RSI scales first built, which
    have other names now, and replay failed on a KeyError inside a worker. A model is checked
    before anything starts, and is never given a renamed scale in place of the one it read."""
    import joblib
    from backtest_runner import policy
    from strategy_core.pipeline import StageFeatures

    names = list(StageFeatures.sources())[:40]
    folder = tmp_path / "run-7"
    folder.mkdir()
    current = folder / "2026-05.joblib"
    joblib.dump({"names": names, "ready": names[:2]}, current)
    assert policy.incompatible(current) is None
    retired = folder / "2026-06.joblib"
    old = ["1m@1s.fast_rsi_atr_0p5.ext", "1m@1s.fast_rsi_atr_0p5.progress", "1h@1m.gone.x"]
    joblib.dump({"names": [*names, *old]}, retired)
    why = policy.incompatible(retired)
    assert "run-7/2026-06.joblib reads 3 features" in why and "from 2 scales or stages" in why
    assert "1h@1m.gone" in why and policy.REPLAY_NOTE in why  # no commit recorded: where to look
    # a fit leaves out a column without a training value: only the columns it reads count, as
    # in the forecast itself. A retired name among the unused ones does not stop the replay ...
    unused = folder / "2026-07.joblib"
    joblib.dump({"names": [*names, *old], "columns": list(range(40)), "ready": names[:2]}, unused)
    assert policy.incompatible(unused) is None
    assert policy.used(joblib.load(unused)) == names
    # ... and one among those it reads does
    joblib.dump({"names": [*names, *old], "columns": [0, 40], "ready": []}, unused)
    assert "reads 1 features" in policy.incompatible(unused)
    joblib.dump(
        {"names": names, "ready": old[:1], "source": {"commit": "abc123", "dirty": True}}, retired
    )
    why = policy.incompatible(retired)  # a feature needed only to decide counts too
    assert "reads 1 features" in why and "commit abc123 with uncommitted changes" in why
    revision = yardstick.source_revision()
    assert set(revision) == {"commit", "dirty"} and len(revision["commit"]) == 40


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
    gated = policy.ModelPolicy("unused.joblib", ready=(), gate=("slow",))
    free = policy.ModelPolicy("unused.joblib", ready=(), gate=())
    # beyond the cost of 0.04 R: a buy, a sell; inside it: nothing; a spread over a quarter of
    # R, or no usable book: nothing. The slow trend is down in the first two rows: no long
    assert free.signals(f).tolist() == [1, -1, 0, 0, 0, 0, 0]
    assert gated.signals(f).tolist() == [0, -1, 0, 0, 0, 0, 0]
    cheap = policy.ModelPolicy("unused.joblib", ready=(), threshold=0.25, gate=())
    assert cheap.signals(f).tolist() == [1, -1, 1, -1, 0, 0, 0]
    hold, turn, opposite = (
        policy.ModelPolicy("unused.joblib", ready=(), close=c, gate=("slow",)).closes(f)
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
        policy.ModelPolicy("unused.joblib", ready=(), close="flip")


def test_a_cell_report_counts_dates_without_a_trade_and_pairs_products():
    from backtest_runner import policy

    key = ("hold", "cross", True, "base")
    may = (date(2026, 5, 4) - BASE).days

    def part(product, r, day):
        cell = {
            "summary": {"signal_rows": 9, "cancelled_orders": 0, "expired_orders": 1,
                        "orders_with_unknown_outcome": 1, "sessions_at_daily_limit": 0,
                        "exit_reasons": {"stop": len(r)}},
            "day": np.array(day), "side": np.array([1, -1][: len(r)], np.int8),
            "r": np.array(r), "stop_ticks": np.full(len(r), 300.0),
            "flagged_exit": np.arange(len(r)) == 1,  # the second trade's exit met no book
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
    # the unknown are counted, and the result is also given with the unpriced exit charged 1 R:
    # it was GC's sell, so only that side and that product are lower
    assert out["orders_with_unknown_outcome"] == 2 and out["exits_priced_without_a_book"] == 1
    worst = out["with_unpriced_exits_charged_1r"]
    assert worst["all"]["net_r"] == pytest.approx(out["all"]["net_r"] - 1, abs=1e-3)
    assert worst["sells"]["net_r"] == pytest.approx(out["sells"]["net_r"] - 1, abs=1e-3)
    assert worst["GC"]["net_r"] == pytest.approx(out["GC"]["net_r"] - 1, abs=1e-3)
    assert worst["buys"] == out["buys"] and worst["SI"] == out["SI"]
    assert out["by_month"]["2026-05"]["trades"] == 3 and out["by_month"]["2026-06"]["trades"] == 0
    # micro: $2.50 a round trip on a stop of $300 (MGC) or $1,500 (SIL); $500 buys one MGC, no SIL
    assert out["micro_costs"]["net_r"] == pytest.approx(-2 * 2.5 / 300 - 1 - 2.5 / 1500, abs=1e-3)
    assert out["account_100k_whole_micro_contracts"]["trades_too_large_for_the_risk"] == 1
    assert out["daily"].tolist() == pytest.approx([-2 * gc, 0.0, -1 - si])


def test_skill_is_not_fooled_by_a_forecast_that_fades_each_sessions_move():
    """Within one session the move to the close falls as the price so far rises, for any
    path. A correlation taken date by date rewards a forecast of "minus the move so far" on a
    random walk; the pooled one, which decides, does not."""
    rng = np.random.default_rng(3)
    n_days, per = 80, 200
    day = np.repeat(days(date(2026, 5, 4), n_days), per)
    steps = rng.normal(size=(n_days, per + 1))
    path = np.cumsum(steps, axis=1)
    so_far = path[:, :per].ravel()
    y = np.clip((path[:, [per]] - path[:, :per]).ravel() / 30, -1, 1)  # the move to the close
    product = np.zeros(len(day), np.int8)
    found = yardstick.skill(-so_far, y, day, product, ["GC"])
    assert found["within_date_rank_correlation_biased"]["mean"] > 0.5  # looks like skill
    lo, hi = found["rank_correlation"]["interval_95"]
    assert lo < 0 < hi  # and is none
    assert found["squared_error_ratio_to_flat"] > 1


def test_training_dates_are_cut_into_blocks_with_a_date_left_out_on_each_side():
    day = np.repeat(days(date(2026, 1, 5), 8), 2)
    cut = yardstick.blocks(day, 4)
    first = (date(2026, 1, 5) - BASE).days
    assert [np.unique(day[inside] - first).tolist() for _, inside in cut] == [
        [0, 1], [2, 3], [4, 5], [6, 7],
    ]  # fmt: skip
    # the second block is fitted on the others, without the dates next to it
    train, inside = cut[1]
    assert np.unique(day[train] - first).tolist() == [0, 5, 6, 7]
    assert not (train & inside).any()
    assert np.unique(day[cut[0][0]] - first).tolist() == [3, 4, 5, 6, 7]


def test_shrinking_stops_a_forecast_claiming_what_it_does_not_know():
    """Each session has its own level in the target, and one feature that names the session.
    Trees learn the sessions they saw and forecast boldly; outside them the forecast is
    worthless, and the slope found on held-out blocks takes it to nearly nothing."""
    rng = np.random.default_rng(5)
    n_days, per = 120, 150
    day = np.repeat(days(date(2026, 1, 5), n_days), per)
    level = np.repeat(rng.choice([-0.8, 0.8], n_days), per)  # the session's outcome
    tag = np.repeat(rng.normal(size=n_days), per)  # constant through a session
    x = np.column_stack([tag, rng.normal(size=len(day))]).astype(np.float32)
    y = np.clip(level + rng.normal(0, 0.3, len(day)), -1, 1)
    train = day < day.min() + 90
    bold = yardstick.fit_trees(x[train], y[train], day[train])
    careful = yardstick.shrink(yardstick.fit_trees, every=True)(x[train], y[train], day[train])
    assert set(careful.slopes) == set(yardstick.CALIBRATIONS) and all(
        0 <= v < 0.2 for v in careful.slopes.values()
    )
    test_x, test_y = x[~train], y[~train]
    assert np.abs(bold.predict(test_x)).mean() > 0.3  # sure of itself
    assert ((bold.predict(test_x) - test_y) ** 2).mean() > (test_y**2).mean()  # and wrong
    assert 0 <= careful.slope < 0.2
    assert ((careful.predict(test_x) - test_y) ** 2).mean() < 1.05 * (test_y**2).mean()
    np.testing.assert_allclose(careful.predict(test_x), careful.slope * careful.raw(test_x))
    # leaves as large as ten trade dates cannot hold one session
    coarse = yardstick.fit_coarse(x[train], y[train], day[train])
    assert np.abs(coarse.predict(test_x)).mean() < np.abs(bold.predict(test_x)).mean()
    # a forecast that does hold keeps most of its size
    signal = np.clip(0.5 * x[:, 1] + rng.normal(0, 0.3, len(day)), -1, 1)
    kept = yardstick.shrink(yardstick.fit_trees)(x[train], signal[train], day[train])
    assert kept.slope > 0.8


def test_a_stored_dataset_is_named_by_everything_that_determines_its_rows(monkeypatch):
    """PR #99 review: a corrected target, a changed source file, or another set of sessions
    built by the same builders must not read the old file."""
    inputs = {
        "builders": [["bar_1s:0", "aaa"]],
        "sessions": {"GC": [["2026-03-02", "GCJ6", ["f1", "f2"]]]},
    }
    args = (["GC"], date(2026, 1, 2), date(2026, 8, 31), ["1m@1s.rsi"])
    key = dataset.cache_key(*args, inputs)
    assert key == dataset.cache_key(*args, json.loads(json.dumps(inputs)))  # stable
    changed = [
        {**inputs, "builders": [["bar_1s:0", "bbb"]]},  # the stored rows were rebuilt
        {**inputs, "sessions": {"GC": [["2026-03-02", "GCJ6", ["f1", "f3"]]]}},  # a file
        {**inputs, "sessions": {"GC": [["2026-03-02", "GCM6", ["f1", "f2"]]]}},  # the contract
        {**inputs, "sessions": {"GC": [*inputs["sessions"]["GC"], ["2026-03-03", "GCJ6", []]]}},
    ]
    assert len({key, *(dataset.cache_key(*args, c) for c in changed)}) == 5
    assert dataset.cache_key(["GC"], *args[1:3], ["1m@1s.atr_bps"], inputs) != key
    assert dataset.cache_key(["SI"], *args[1:], inputs) != key
    for module, name in ((targets, "VERSION"), (dataset, "VERSION"), (dataset, "R_ATR")):
        monkeypatch.setattr(module, name, getattr(module, name) + 1)
        assert dataset.cache_key(*args, inputs) != key, (module.__name__, name)
        monkeypatch.undo()
    assert dataset.cache_key(*args, inputs) == key


def test_the_calibration_forecasts_a_block_from_earlier_dates_only():
    """PR #100 review: a slope fitted on forecasts that used later dates could not have been
    made on its own dates."""
    day = np.repeat(days(date(2026, 1, 5), 20), 3)
    first = (date(2026, 1, 5) - BASE).days
    cut = yardstick.blocks(day, 4, forward=True)
    spans = [
        (np.unique(day[train] - first).tolist(), np.unique(day[inside] - first).tolist())
        for train, inside in cut
    ]
    # the first block has no history; each later one is fitted on the dates before it, less one
    assert spans == [
        ([0, 1, 2, 3], [5, 6, 7, 8, 9]),
        ([0, 1, 2, 3, 4, 5, 6, 7, 8], [10, 11, 12, 13, 14]),
        ([*range(14)], [15, 16, 17, 18, 19]),
    ]
    rng = np.random.default_rng(0)
    x = rng.normal(size=(len(day), 2)).astype(np.float32)
    y = np.clip(0.5 * x[:, 0] + rng.normal(0, 0.2, len(day)), -1, 1)

    class Recorder:
        def __init__(self):
            self.seen = []

        def __call__(self, x, y, d):
            self.seen.append((int(d.min() - first), int(d.max() - first)))
            return yardstick.fit_ridge(x, y, d)

    record = Recorder()
    forward = yardstick.held_out(record, x, y, day, forward=True)
    assert record.seen == [(0, 3), (0, 8), (0, 13)]
    assert np.isnan(forward[day - first < 5]).all() and np.isfinite(forward[day - first >= 5]).all()
    both = yardstick.held_out(yardstick.fit_ridge, x, y, day, forward=False)
    assert np.isfinite(both).all()  # the first variant also forecast the first block, from later


def test_the_slope_weighs_each_trade_date_once_or_each_row_once():
    """PR #100 review: the score averages over trade dates, so the slope that serves it does
    too. A date with many rows pulls the row-weighted slope toward itself."""
    day = np.r_[np.full(10, 1), np.full(90, 2)]
    forecast = np.ones(100)
    y = np.r_[np.full(10, 0.8), np.full(90, 0.2)]  # the forecast holds on the short date
    assert yardstick.slope_of(forecast, y, day, by_date=True) == pytest.approx(0.5)
    assert yardstick.slope_of(forecast, y, day, by_date=False) == pytest.approx(0.26)
    assert yardstick.slope_of(-forecast, y, day, by_date=True) == 0.0  # never below zero
    assert yardstick.slope_of(np.full(100, np.nan), y, day, by_date=True) == 0.0


def test_an_added_input_is_judged_by_the_paired_difference_in_skill():
    """Two forecasts of one target on the same dates: the difference of their pooled rank
    correlations, with an interval from resampling the dates both were scored on."""
    rng = np.random.default_rng(3)
    day = np.repeat(np.arange(60), 200)
    signal = rng.normal(size=len(day))
    shared = np.repeat(rng.normal(size=60), 200)  # what every row of a date has in common
    y = signal + shared + rng.normal(size=len(day))
    better, worse = signal + 0.5 * rng.normal(size=len(day)), signal + 3 * rng.normal(size=len(day))
    found = yardstick.paired_difference(better, worse, y, day)
    alone = [yardstick.pooled_correlation(f, y, day)["value"] for f in (better, worse)]
    assert found["trade_dates"] == 60
    assert found["value"] == pytest.approx(alone[0] - alone[1], abs=2e-5)
    assert 0 < found["interval_95"][0] < found["value"] < found["interval_95"][1]
    # pairing cancels what the dates share: the interval is narrower than either forecast's own
    own = yardstick.pooled_correlation(better, y, day)["interval_95"]
    assert found["interval_95"][1] - found["interval_95"][0] < own[1] - own[0]
    same = yardstick.paired_difference(better, better, y, day)
    assert same["value"] == 0 and same["interval_95"] == [0, 0]
    # rows only one of them scored are left out
    partial = np.where(day < 30, np.nan, worse)
    assert yardstick.paired_difference(better, partial, y, day)["trade_dates"] == 30


def test_bootstrap_reranks_the_pooled_rows_in_each_date_draw(monkeypatch):
    # Unequal date sizes, ties in the targets and forecasts, draws with missing/repeated dates.
    rng = np.random.default_rng(11)
    day = np.repeat([2, 4, 8, 9], [6, 9, 12, 13])
    y = rng.choice([-1.0, 0.0, 1.0], size=len(day))
    a, b = rng.integers(6, size=(2, len(day)))
    monkeypatch.setattr(yardstick, "RESAMPLES", 40)
    draws = np.random.default_rng(yardstick.SEED).choice(np.unique(day), size=(40, 4))
    pooled, paired = [], []
    for draw in draws:
        rows = np.concatenate([np.flatnonzero(day == d) for d in draw])
        first = spearmanr(a[rows], y[rows]).statistic
        pooled.append(first)
        paired.append(first - spearmanr(b[rows], y[rows]).statistic)
    assert yardstick.pooled_correlation(a, y, day)["interval_95"] == pytest.approx(
        np.percentile(pooled, [2.5, 97.5]), abs=5e-6
    )
    assert yardstick.paired_difference(a, b, y, day)["interval_95"] == pytest.approx(
        np.percentile(paired, [2.5, 97.5]), abs=5e-6
    )
