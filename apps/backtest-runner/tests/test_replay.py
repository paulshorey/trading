from datetime import date

import numpy as np
import pytest
from backtest_runner import replay
from strategy_core import labels
from strategy_core.engine import MarketChunk, session_view
from strategy_core.execution import Simulator
from strategy_core.market import HOUR, NS, PRODUCTS, SessionCalendar
from strategy_core.synthetic import random_book, random_trades

T0 = 1_767_571_200 * NS  # 2026-01-05 00:00 UTC
STATE = {name: k for k, name in enumerate(replay.STATES)}
FAST, MID = replay.SPECS["fast"], replay.SPECS["mid"]
BASE = date(2000, 1, 1)


def test_the_portfolio_takes_the_next_order_after_the_last_outcome_is_known():
    s = NS
    decision = np.array([10, 20, 30, 40, 50, 60]) * s
    known = np.array([35, 99, 31, 45, 70, 0]) * s  # exits, or when a cancel is learned
    state = np.array([STATE[n] for n in ("closed", "closed", "closed", "entry_no_book",
                                         "exit_no_book", "pending")])  # fmt: skip
    held, cancelled, placed, _ = replay.portfolio(decision, known, state, cooldown=0)
    # 20 and 30 are decided while the first is open; 40 is cancelled; 50 is held; 60 is decided
    # before 50 exits
    assert held.tolist() == [0, 4] and (cancelled, placed) == (1, 3)
    # a cooldown to 55 s passes over 40 and 50; the order at 60 never arrives
    held, cancelled, placed, _ = replay.portfolio(decision, known, state, cooldown=20 * s)
    assert held.tolist() == [0] and (cancelled, placed) == (1, 2)
    assert replay.portfolio(decision[:0], known[:0], state[:0], 0)[1:3] == (0, 0)


def test_a_session_is_replayed_under_every_bracket_with_the_engines_simulator():
    product = PRODUCTS["GC"]
    cal = SessionCalendar("test", np.array([T0], np.int64), np.array([T0 + 6 * HOUR], np.int64))
    t = random_trades(T0, T0 + 6 * HOUR, seed=3, rate=2)
    chunk = MarketChunk(
        "GCZ6", T0, T0 + 6 * HOUR, t, np.array([[T0, T0 + 6 * HOUR]]), "s", True,
        random_book(t, seed=5),
    )  # fmt: skip
    base = replay.EXECUTIONS["base"]
    view = session_view(chunk, cal, base)
    price = float(t.price[0])  # fixed-point, as the stored close
    seconds = np.array([600, 900, 1200, 3 * 3600 - 300, 700])
    end = T0 + seconds * NS
    rows = np.array(
        [
            # variant, end (unused), kind, prov, displacement, fast ATR bps and close, slow
            [7, 0, 1, 1, 0.3, 2.0, price, 20.0, price],
            [7, 0, 2, 0, 0.4, 2.0, price, 20.0, price],
            [8, 0, 1, 1, 0.5, 2.0, price, np.nan, np.nan],  # no completed hour row
            [8, 0, 2, 1, 0.6, 2.0, price, 20.0, price],  # the 3 h hold does not fit before 6 h
            [8, 0, 2, 1, np.nan, 0.0, price, 20.0, price],  # an ATR of zero sizes nothing
        ]
    )
    out = replay.simulate(FAST, product, cal, "GCZ6", chunk, view, end, rows)
    assert out["why"].tolist() == [0, 0, replay.NO_ATR, replay.NO_ROOM, replay.NO_ATR]
    assert out["state:slow:base"][2:].tolist() == [-1, -1, -1]  # never simulated
    for name, (_, bracket) in FAST.brackets.items():
        atr = rows[0, 5 if name == "fast" else 7] / 1e4 * price / 1e9
        assert out[f"stop:{name}"][0] == max(
            round(bracket.stop_atr * atr * 1e9 / product.tick_size), 1
        )
        for mode, config in replay.EXECUTIONS.items():
            sim = Simulator(product, config, bracket, cal)
            for i, direction in ((0, -1), (1, 1)):  # a candidate high is sold, a low bought
                pos = sim.order(direction, "GCZ6", int(end[i]), atr, {}, view)
                state, trade, known = labels.attempt(sim, view, pos)
                assert replay.STATES[out[f"state:{name}:{mode}"][i]] == state
                assert out[f"known:{name}:{mode}"][i] == known
                if trade is not None:
                    assert out[f"ticks:{name}:{mode}"][i] == trade["pnl_ticks"]
                    assert (
                        abs(pos.entry_px - pos.stop_px)
                        == out[f"stop:{name}"][i] * product.tick_size
                    )
    # a session whose data stops before an exit makes that trade unknown
    cut = MarketChunk(
        "GCZ6", T0, T0 + 6 * HOUR, t, np.array([[T0, T0 + 1000 * NS]]), "s", True, chunk.book
    )
    out = replay.simulate(FAST, product, cal, "GCZ6", cut, view, end, rows)
    assert replay.STATES[out["state:slow:base"][0]] == "uncovered"


def frame(seed=0, days=140, per_day=60):
    """Synthetic candidates of two products from 2026-01-05 on: under the slow bracket the
    result in R rises with displacement (negative below 0.5, positive above); under the fast
    bracket it is noise around a loss."""
    rng = np.random.default_rng(seed)
    first = (date(2026, 1, 5) - BASE).days
    parts, calendars = [], []
    for k in range(2):
        calendars.append(list(range(first, first + days)))
        for day in calendars[k]:
            n = per_day
            disp = rng.uniform(0, 1, n)
            end = (day * 86_400 + np.sort(rng.choice(60_000, n, replace=False)) + 1) * NS
            part = {
                "variant": np.full(n, 3, np.int16),
                "end": end.astype(np.int64),
                "kind": rng.integers(1, 3, n).astype(np.int8),
                "prov": (rng.random(n) < 0.5).astype(np.int8),
                "disp": disp,
                "why": np.where(rng.random(n) < 0.1, replay.NO_ROOM, replay.ELIGIBLE).astype(
                    np.int8
                ),
                "day": np.full(n, day, np.int32),
            }
            part["disp"][0] = np.nan
            side = np.where(part["kind"] == 1, -1, 1)
            for scale in replay.SLOW_SCALES:
                for rule in replay.RULES:
                    # the first scale's leg knows the result's sign; every other signal is noise
                    part[f"slow:{scale}:{rule}"] = rng.integers(-1, 2, n).astype(np.int8)
            told = np.where(disp > 0.5, side, -side)
            part[f"slow:{replay.SLOW_SCALES[0]}:leg"] = np.where(
                rng.random(n) < 0.2, 0, told
            ).astype(np.int8)
            for name in FAST.brackets:
                stop = np.full(n, 40.0 if name == "slow" else 5.0)
                part[f"stop:{name}"] = stop
                for mode in replay.EXECUTIONS:
                    edge = 2.0 * (disp - 0.5) if name == "slow" else -0.2
                    r = np.nan_to_num(edge) + rng.normal(0, 0.5, n) - (mode == "stressed") * 0.05
                    state = np.full(n, STATE["closed"], np.int8)
                    state[1], state[2], state[3] = (
                        STATE["late"], STATE["entry_no_book"], STATE["exit_no_book"],
                    )  # fmt: skip
                    state[part["why"] != replay.ELIGIBLE] = -1
                    part[f"state:{name}:{mode}"] = state
                    part[f"ticks:{name}:{mode}"] = np.where(
                        np.isin(state, replay.TRADES), r * stop, np.nan
                    )
                    part[f"known:{name}:{mode}"] = end + 3_600 * NS
                    part[f"spread:{name}:{mode}"] = np.full(n, 1.0)
                    part[f"slip:{name}:{mode}"] = np.full(n, 0.5)
                    part[f"reason:{name}:{mode}"] = np.where(
                        np.isin(state, replay.TRADES), 3, 0
                    ).astype(np.int8)
            parts.append((k, part))
    return replay.Frame(["GC", "SI"], parts, calendars)


def test_the_two_values_of_a_candidate_are_kept_apart():
    f = frame()
    m = f.money("slow", "base")
    state = f.a["state:slow:base"]
    closed = state == STATE["closed"]
    assert np.isfinite(m["r"][closed]).all() and np.isnan(m["r"][~closed]).all()
    assert (m["value_r"][state == STATE["late"]] == 0).all()  # known: no trade
    unknown = np.isin(state, [STATE["entry_no_book"], STATE["exit_no_book"]])
    assert np.isnan(m["value_r"][unknown]).all() and np.isnan(m["value_usd"][unknown]).all()
    assert np.isfinite(m["ledger_usd"][state == STATE["exit_no_book"]]).all()  # the portfolio's
    # commission is dollars: $5 a round trip against a 40-tick stop at $10 (GC) or $25 (SI)
    gc = closed & (f.a["product"] == 0)
    assert m["cost_r"][gc] == pytest.approx(5 / 400) and m["risk_usd"][
        ~gc & closed
    ] == pytest.approx(1000)
    assert m["usd"][gc] == pytest.approx(m["r"][gc] * 400 - 5)


def test_the_displacement_rule_is_fitted_before_each_month_and_compared_on_the_same_candidates():
    f = frame()
    out = replay.report(f, FAST, 3, False)
    assert (
        out["candidates"] == 2 * 140 * 60
        and out["eligible"] + sum(out["ineligible"].values()) == out["candidates"]
    )
    slow = out["brackets"]["slow"]
    fits = slow["displacement_rule_fits"]
    # one fit a month and product; the data ends in May, so the later months score nothing
    assert [x["month"] for x in fits[:3]] == ["2026-05", "2026-05", "2026-06"] and len(fits) == 8
    assert all(x["slope_r_per_theta"] == pytest.approx(2.0, abs=0.15) for x in fits)
    test = slow["base"]["test_months"]
    everyone, rule = (test["per_candidate"][p]["all"] for p in ("take_all", "displacement_rule"))
    # the rule takes about the upper half, and no candidate without a displacement
    assert 0.4 < rule["candidates"] / everyone["candidates"] < 0.6
    assert rule["avg_r_before_commission"] > 0.4 > abs(everyone["avg_r_before_commission"])
    assert everyone["states"]["late"] > 0 and everyone["states"]["entry_no_book"] > 0
    assert everyone["avg_decision_spread_r"] == 1 / 40 and everyone["avg_entry_slip_r"] == 0.5 / 40
    assert (
        everyone["value_of_attempting"]["known"] == everyone["trades"] + everyone["states"]["late"]
    )
    books = test["portfolio"]
    for p in books.values():
        assert p["orders"] == p["fills"] + p["cancelled"]
        assert p["skipped_while_occupied"] == p["candidates_taken"] - p["orders"]
        assert p["net_usd_flagged_charged"] <= p["net_usd"]
        assert sum(x["fills"] for x in p["by_product"].values()) == p["fills"]
        assert sum(x["net_usd"] for x in p["by_month"].values()) == pytest.approx(
            p["net_usd"], abs=0.1
        )
    assert books["displacement_rule"]["net_usd"] > books["take_all"]["net_usd"]
    gain = test["displacement_rule_minus_take_all_daily_net_usd"]
    assert gain["fallback"]["interval_95"][0] > 0 and gain["charged"]["interval_95"][0] > 0
    # the stressed replay keeps the choices made at base costs
    stressed = slow["stressed"]["test_months"]["per_candidate"]["displacement_rule"]["all"]
    assert stressed["candidates"] == rule["candidates"]
    assert stressed["avg_r_before_commission"] < rule["avg_r_before_commission"]
    # the fast bracket has no edge to find: whatever the fit, taking candidates loses
    fast = out["brackets"]["fast"]["base"]["test_months"]["per_candidate"]["take_all"]["all"]
    assert fast["avg_r_net"] < fast["avg_r_before_commission"] < 0
    assert replay.report(f, FAST, 3, True)["candidates"] < out["candidates"]


def test_a_month_without_enough_history_is_not_scored():
    f = frame(days=5)  # under 500 known values a product
    out = replay.report(f, FAST, 3, False)["brackets"]["slow"]
    assert all("skipped" in x for x in out["displacement_rule_fits"])
    assert out["base"]["test_months"]["per_candidate"] == {"take_all": {}, "displacement_rule": {}}
    assert out["base"]["test_months"]["portfolio"]["take_all"]["fills"] == 0


def test_the_holdout_is_refused():
    with pytest.raises(ValueError, match="holdout"):
        replay.run(["GC"], date(2026, 8, 1), date(2026, 9, 1))


def test_an_interval_of_no_values_is_undefined_not_zero():
    rng = np.random.default_rng(0)
    assert replay.interval(np.zeros(0), rng) == [None, None]
    assert replay.interval(np.array([1.0, 1.0]), rng) == [1.0, 1.0]


def test_a_mean_without_finite_values_is_none():
    assert replay.finite_mean(np.array([np.nan, np.nan]), 4) is None
    assert replay.finite_mean(np.array([1.0, np.nan, 2.0]), 4) == 1.5


def test_the_slow_direction_is_read_at_the_latest_completed_minute():
    minute = np.array([10, 11, 12, 14])  # minute 13 has no row
    minute_end = (minute * 60 + 1000) * NS
    values = np.array(
        [  # state, dir, trend, high_conf_age_s, low_conf_age_s
            [2, 1, 1, 9000, 3500],  # an up leg from a low confirmed 3,500 s before
            [2, -1, 0, 3600, 100],  # a down leg from a high confirmed 3,600 s before
            [1, np.nan, np.nan, np.nan, np.nan],  # a segment without a direction yet
            [2, -1, -1, np.nan, 50],  # a down leg whose high's confirmation age is unknown
        ]
    )
    ordinal = np.array([600, 659, 660, 661, 720, 780, 840, 900, 599])
    end = (ordinal + 1000) * NS
    out = replay.slow_direction(ordinal, end, minute, minute_end, values)
    # 600..659 read minute 10; 660 and 661 read minute 11; 780 has no row; 599 is before any
    assert out["leg"].tolist() == [1, 1, -1, -1, 0, 0, -1, 0, 0]
    assert out["trend"].tolist() == [1, 1, 0, 0, 0, 0, -1, 0, 0]
    # 3,500 s at the minute's end is fresh there and 59 s later; 3,600 s is fresh only at the end
    assert out["fresh"].tolist() == [1, 1, -1, 0, 0, 0, 0, 0, 0]
    # rows after a closure are as old as their row count says, never the clock time between
    reopened = end + np.where(ordinal > 600, 5 * 3600 * NS, 0)
    again = replay.slow_direction(ordinal, reopened, minute, minute_end, values)
    assert all(again[rule].tolist() == out[rule].tolist() for rule in replay.RULES)
    late = replay.slow_direction(ordinal[:1], end[:1] + replay.MINUTE_REACH_NS, minute, minute_end,
                                 values)  # fmt: skip
    assert late["leg"].tolist() == [0]  # a minute row older than the reach is not read
    none = replay.slow_direction(ordinal, end, minute[:0], minute_end[:0], values[:0])
    assert all(not v.any() and len(v) == len(ordinal) for v in none.values())


def test_agreement_splits_the_same_candidates_and_never_fits():
    f = frame()
    out = replay.report(f, FAST, 3, False)["brackets"]
    assert "agreement" not in out["fast"]["base"]
    first, other = replay.SLOW_SCALES[0], replay.SLOW_SCALES[1]
    for mode in replay.EXECUTIONS:
        split = out["slow"][mode]["agreement"]
        assert set(split) == set(replay.SLOW_SCALES) and set(split[first]) == set(replay.RULES)
        told = split[first]["leg"]
        for period in ("development_period", "before_test_months", "test_months"):
            good, bad = told["with"][period]["all"], told["against"][period]["all"]
            assert good["avg_r_before_commission"] > 0.4 and bad["avg_r_before_commission"] < -0.4
            assert good["value_of_attempting"]["mean_net_usd_interval_95"][0] > 0
        # the periods partition the development period
        whole = told["with"]["development_period"]["all"]["candidates"]
        assert whole == sum(
            told["with"][p]["all"]["candidates"] for p in ("before_test_months", "test_months")
        )
        book = told["with"]["test_months_portfolio"]
        assert book["candidates_taken"] == told["with"]["test_months"]["all"]["candidates"]
        assert book["net_usd"] > 0 > told["against"]["test_months_portfolio"]["net_usd"]
        noise = split[other]["leg"]["with"]["development_period"]["all"]
        assert abs(noise["avg_r_before_commission"]) < 0.1
    # with, against and neither cover every eligible candidate
    base = out["slow"]["base"]["agreement"][first]["leg"]
    eligible = replay.report(f, FAST, 3, False)["eligible"]
    taken = sum(base[k]["development_period"]["all"]["candidates"] for k in ("with", "against"))
    assert 0.7 * eligible < taken < 0.9 * eligible


def test_the_daily_loss_cap_refuses_orders_that_could_pass_it_and_stops_the_session():
    s = NS
    decision = np.array([10, 20, 30, 40, 50, 60]) * s
    known = decision + 5 * s
    state = np.full(6, STATE["closed"])
    day = np.array([1, 1, 1, 1, 2, 2])
    usd = np.array([-200.0, -200.0, 500.0, -50.0, -10.0, 30.0])
    risk = np.array([150.0, 150.0, 150.0, 150.0, 500.0, 150.0])
    held, cancelled, placed, cap = replay.portfolio(decision, known, state, 0, day, usd, risk, 400)
    # 200 lost and 150 at risk is inside 400; at 400 lost the date is over; on the next date a
    # stop of 500 alone is outside the cap, and the order after it is taken
    assert held.tolist() == [0, 1, 5] and (cancelled, placed) == (0, 3)
    assert cap == {"refused_orders": 3, "sessions_bound": 2}
    free = replay.portfolio(decision, known, state, 0, day, usd, risk, None)
    assert free[0].tolist() == [0, 1, 2, 3, 4, 5] and free[3]["refused_orders"] == 0
    # a winning date is never bound: losses are the date's net result when it is negative
    wins = replay.portfolio(decision, known, state, 0, day, np.abs(usd), risk, 400)
    assert wins[0].tolist() == [0, 1, 2, 3, 5]
    f = frame()
    m = f.money("slow", "base")
    rows = f.a["why"] == replay.ELIGIBLE
    dates = np.unique(f.a["day"])
    capped, free = (f.ledger(rows, m, "base", dates, cap) for cap in (1_500.0, None))
    assert free["loss_cap"] is None and capped["loss_cap"]["refused_orders"] > 0
    assert capped["fills"] < free["fills"]
    assert capped["skipped_while_occupied"] == (
        capped["candidates_taken"] - capped["orders"] - capped["loss_cap"]["refused_orders"]
    )
    assert sum(x["fills"] for x in capped["by_side"].values()) == capped["fills"]
    assert capped["daily"]["fallback"].min() > -1_500 - 1_000 - 5  # the cap, one stop, commission


def test_micro_costs_are_the_same_ticks_at_the_micro_contracts_value_and_commission():
    f = frame()
    full, micro = f.money("slow", "base"), f.money("slow", "base", "micro")
    closed = full["closed"]
    assert (micro["state"] == full["state"]).all()
    assert micro["r"][closed] == pytest.approx(full["r"][closed])  # R is before commission
    gc = closed & (f.a["product"] == 0)
    assert micro["risk_usd"][gc] == pytest.approx(40) and micro["risk_usd"][
        closed & ~gc
    ] == pytest.approx(200)
    assert micro["usd"][gc] == pytest.approx(micro["r"][gc] * 40 - 2.5)
    assert (micro["cost_r"][closed] > full["cost_r"][closed]).all()  # a larger share of risk


def test_buys_and_sells_are_reported_apart_for_every_product():
    f = frame()
    m = f.money("slow", "base")
    stats = f.candidate_stats(f.a["why"] == replay.ELIGIBLE, m)
    assert set(stats) == {a + b for a in ("all", "GC", "SI") for b in ("", ":buys", ":sells")}
    for name in ("all", "GC", "SI"):
        assert stats[name]["candidates"] == sum(
            stats[f"{name}:{side}"]["candidates"] for side in ("buys", "sells")
        )
    # an order that expired unfilled is known and worth zero, like one that arrived too late
    state = f.a["state:slow:base"].copy()
    f.a["state:slow:base"][state == STATE["late"]] = STATE["expired"]
    again = f.money("slow", "base")
    assert (again["value_usd"][state == STATE["late"]] == 0).all()
    assert (again["known"] == m["known"]).all()


def test_the_middle_replay_adds_a_limit_entry_and_trades_only_a_market_it_can_trust():
    product = PRODUCTS["GC"]
    cal = SessionCalendar("test", np.array([T0], np.int64), np.array([T0 + 6 * HOUR], np.int64))
    t = random_trades(T0, T0 + 6 * HOUR, seed=3, rate=2)
    chunk = MarketChunk(
        "GCZ6", T0, T0 + 6 * HOUR, t, np.array([[T0, T0 + 6 * HOUR]]), "s", True,
        random_book(t, seed=5),
    )  # fmt: skip
    view = session_view(chunk, cal, replay.EXECUTIONS["base"])
    assert [c[0] for c in MID.cells] == ["slow", "slow+limit"] and MID.hold_s == 10_860
    price = float(t.price[0])
    seconds = np.array([600, 900, 1200, 700, 3 * 3600 - 300])
    end = T0 + seconds * NS
    rows = np.array(
        [
            # variant, end (unused), kind, prov, displacement, own ATR bps and close, slow
            [7, 0, 1, 1, 0.3, 2.0, price, 20.0, price],
            [7, 0, 2, 0, 0.4, 2.0, price, 20.0, price],
            [8, 0, 2, 1, 0.5, np.nan, np.nan, 20.0, price],  # its own ATR sizes nothing here
            [8, 0, 2, 1, 0.6, 2.0, price, 1e-6, price],  # a stop of one tick: the spread is wide
            [8, 0, 2, 1, 0.6, 2.0, price, 20.0, price],  # the 3 h hold does not fit before 6 h
        ]
    )
    # each candidate's extreme: a high above the market and a low below it
    at = [int(np.searchsorted(t.ts_event, e)) for e in end]
    level = np.array([int(t.price[a]) for a in at]) + np.array([3, -3, -3, -3, -3]) * 100_000_000
    out = replay.simulate(MID, product, cal, "GCZ6", chunk, view, end, rows, level)
    assert out["why"].tolist() == [0, 0, 0, replay.WIDE, replay.NO_ROOM]
    assert (out["stop:slow"] == out["stop:slow+limit"]).all()
    bracket = MID.brackets["slow"][1]
    atr = 20.0 / 1e4 * price / 1e9
    force_exit = T0 + 6 * HOUR - replay.EXECUTIONS["base"].flat_before_close
    for mode, config in replay.EXECUTIONS.items():
        sim = Simulator(product, config, bracket, cal)
        for i, direction in ((0, -1), (1, 1), (2, 1)):
            pos = sim.order(direction, "GCZ6", int(end[i]), atr, {}, view)
            expire = min(pos.arrival_ns + 2_400 * NS, force_exit - 10_860 * NS)
            state, trade, known = labels.attempt_limit(sim, view, pos, int(level[i]), expire)
            assert replay.STATES[out[f"state:slow+limit:{mode}"][i]] == state
            assert out[f"known:slow+limit:{mode}"][i] == known
            if trade is not None:
                assert out[f"ticks:slow+limit:{mode}"][i] == trade["pnl_ticks"]
                assert pos.entry_px == level[i] or pos.entry_ns == pos.arrival_ns
            market = sim.order(direction, "GCZ6", int(end[i]), atr, {}, view)
            assert (
                replay.STATES[out[f"state:slow:{mode}"][i]] == labels.attempt(sim, view, market)[0]
            )
    states = {replay.STATES[k] for k in out["state:slow+limit:base"][:3]}
    assert states <= {"closed", "expired"} and "closed" in states
    # a limit so far away that nothing reaches it expires: known, no trade
    far = level + np.array([1, -1, -1, -1, -1]) * 10**13
    out = replay.simulate(MID, product, cal, "GCZ6", chunk, view, end, rows, far)
    assert [replay.STATES[k] for k in out["state:slow+limit:base"][:3]] == ["expired"] * 3
    assert (out["known:slow+limit:base"][:3] > end[:3] + 2_400 * NS).all()
    # coverage that ends while an order rests makes it unknown, filled or not
    cut = MarketChunk(
        "GCZ6", T0, T0 + 6 * HOUR, t, np.array([[T0, T0 + 1000 * NS]]), "s", True, chunk.book
    )
    out = replay.simulate(MID, product, cal, "GCZ6", cut, view, end, rows, far)
    assert [replay.STATES[k] for k in out["state:slow+limit:base"][:3]] == ["uncovered"] * 3
    # a flagged session trades nothing; a session without a book at the decision neither
    out = replay.simulate(MID, product, cal, "GCZ6", chunk, view, end, rows, level, flagged=True)
    assert out["why"].tolist() == [replay.FLAGGED] * 4 + [replay.NO_ROOM]
    empty = MarketChunk(
        "GCZ6", T0, T0 + 6 * HOUR, t, chunk.coverage, "s", True, chunk.book.take(np.arange(0))
    )
    blind = session_view(empty, cal, replay.EXECUTIONS["base"])
    out = replay.simulate(MID, product, cal, "GCZ6", empty, blind, end, rows, level)
    assert out["why"].tolist() == [replay.NO_BOOK] * 4 + [replay.NO_ROOM]
    # the fast replay keeps its eligibility: only the ATRs and the room
    out = replay.simulate(FAST, product, cal, "GCZ6", chunk, view, end, rows, flagged=True)
    assert out["why"].tolist() == [0, 0, replay.NO_ATR, 0, replay.NO_ROOM]


def test_the_candidate_query_reads_the_latest_completed_minute_of_its_timeframe():
    assert "pivot_label_1s" in replay.query(FAST) and "l.slot_ordinal / 60 " in replay.query(FAST)
    mid = replay.query(MID)
    assert "pivot_label_10s" in mid and "candle_10m_10s" in mid and "l.slot_ordinal / 6 " in mid
    with pytest.raises(ValueError, match="Unknown replay"):
        replay.run(["GC"], timeframe="slow")
    with pytest.raises(ValueError, match="Unknown mid label"):
        replay.run(["GC"], names=["fast_atr_1_q25"], timeframe="mid")
