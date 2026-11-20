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
BASE = date(2000, 1, 1)


def test_the_portfolio_takes_the_next_order_after_the_last_outcome_is_known():
    s = NS
    decision = np.array([10, 20, 30, 40, 50, 60]) * s
    known = np.array([35, 99, 31, 45, 70, 0]) * s  # exits, or when a cancel is learned
    state = np.array([STATE[n] for n in ("closed", "closed", "closed", "entry_no_book",
                                         "exit_no_book", "pending")])  # fmt: skip
    held, cancelled, placed = replay.portfolio(decision, known, state, cooldown=0)
    # 20 and 30 are decided while the first is open; 40 is cancelled; 50 is held; 60 is decided
    # before 50 exits
    assert held.tolist() == [0, 4] and (cancelled, placed) == (1, 3)
    # a cooldown to 55 s passes over 40 and 50; the order at 60 never arrives
    held, cancelled, placed = replay.portfolio(decision, known, state, cooldown=20 * s)
    assert held.tolist() == [0] and (cancelled, placed) == (1, 2)
    assert replay.portfolio(decision[:0], known[:0], state[:0], 0)[1:] == (0, 0)


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
    out = replay.simulate(product, cal, "GCZ6", chunk, view, end, rows)
    assert out["why"].tolist() == [0, 0, replay.NO_ATR, replay.NO_ROOM, replay.NO_ATR]
    assert out["state:slow:base"][2:].tolist() == [-1, -1, -1]  # never simulated
    for name, (_, bracket) in replay.BRACKETS.items():
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
    out = replay.simulate(product, cal, "GCZ6", cut, view, end, rows)
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
            for name in replay.BRACKETS:
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
    out = replay.report(f, 3, False)
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
    assert replay.report(f, 3, True)["candidates"] < out["candidates"]


def test_a_month_without_enough_history_is_not_scored():
    f = frame(days=5)  # under 500 known values a product
    out = replay.report(f, 3, False)["brackets"]["slow"]
    assert all("skipped" in x for x in out["displacement_rule_fits"])
    assert out["base"]["test_months"]["per_candidate"] == {"take_all": {}, "displacement_rule": {}}
    assert out["base"]["test_months"]["portfolio"]["take_all"]["fills"] == 0


def test_the_holdout_is_refused():
    with pytest.raises(ValueError, match="holdout"):
        replay.run(["GC"], date(2026, 8, 1), date(2026, 9, 1))
