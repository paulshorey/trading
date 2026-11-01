from dataclasses import dataclass, field

import numpy as np
import pytest
from helpers import T0, calendar, coverage, trades
from strategy_core.engine import Engine, MarketChunk, split_by_second
from strategy_core.execution import ExecutionConfig, ExecView, Simulator
from strategy_core.features import FeatureConfig, FeatureFrame
from strategy_core.labels import (
    CandidateSummary,
    candidate_outcomes,
    iter_candidate_outcomes,
    summarize_candidates,
)
from strategy_core.market import HOUR, NS, PRODUCTS, UNDEF_PRICE, Trades
from strategy_core.strategies import BiasPullback, Bracket, make_strategy
from strategy_core.synthetic import random_trades

GC = PRODUCTS["GC"]
CAL = calendar((0, 1))
CFG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50, cooldown_s=0)
S = NS


BRACKET = Bracket(1.0, 1.0, 60)


def simulate(rows, *, direction=1, bracket=BRACKET, config=CFG, signal_s=60, atr=0.5):
    sim = Simulator(GC, config, bracket, CAL)
    t = trades(rows)
    view = ExecView(t, t.ts_recv)
    pos = sim.order(direction, "GCZ6", T0 + signal_s * S, atr, {})
    k = sim.fill(view, 0, pos)
    assert 0 <= k < view.n, "entry did not fill"
    j, out = k + 1, None
    while out is None and j < view.n:
        j, out = sim.advance(view, j, pos)
    return pos, out


def test_entry_meets_the_book_after_latency_and_target_needs_a_trade_through():
    rows = [
        (T0 + 60_100_000_000, 2000.0, 1, 1),  # before the order arrives (60.15 s)
        (T0 + 60_200_000_000, 2000.0, 1, -1, 1000, 2000.0, 2000.1),  # fills at its ask
        (T0 + 61 * S, 2000.6, 1, 1),  # touches the target only
        (T0 + 62 * S, 2000.7, 1, 1),  # trades through it
    ]
    pos, out = simulate(rows)
    assert pos.entry_px == 2000_100_000_000 and out["entry_ns"] == str(T0 + 60_200_000_000)
    assert (out["target_px"], out["stop_px"]) == (2000.6, 1999.6)  # 1 ATR = 5 ticks
    assert out["exit_reason"] == "target" and out["exit_ns"] == str(T0 + 62 * S)
    assert out["pnl_ticks"] == pytest.approx(5)
    assert out["pnl_usd"] == pytest.approx(5 * 10 - 2 * 2.5)
    assert out["entry_delay_ms"] == pytest.approx(200)
    _, touch = simulate(rows, config=ExecutionConfig(**{**CFG.__dict__, "limit_fill": "touch"}))
    assert touch["exit_ns"] == str(T0 + 61 * S)


def test_stop_fills_at_the_next_trades_book():
    rows = [
        (T0 + 60_200_000_000, 2000.0, 1, 1, 1000, 2000.0, 2000.1),
        (T0 + 61 * S, 1999.6, 1, -1),  # triggers the stop
        (T0 + 62 * S, 1999.5, 1, -1, 1000, 1999.4, 1999.5),  # fills at this bid
    ]
    _, out = simulate(rows)
    assert out["exit_reason"] == "stop" and out["exit_px"] == pytest.approx(1999.4)
    assert out["pnl_ticks"] == pytest.approx(-7) and out["r_multiple"] == pytest.approx(-7 / 5)
    assert out["mae_ticks"] == pytest.approx(-6)  # worst traded price, 1999.5
    bounce = [*rows[:2], (T0 + 64 * S, 1999.9, 1, 1, 1000, 1999.8, 1999.9)]
    _, out = simulate(bounce)  # the next book recovered, but the stop sold behind the trigger
    assert out["exit_px"] == pytest.approx(1999.6) and out["pnl_ticks"] == pytest.approx(-5)


def test_short_time_exit_and_depth_penalty():
    config = ExecutionConfig(**{**CFG.__dict__, "contracts": 3})
    rows = [
        (T0 + 60_200_000_000, 2000.0, 1, -1, 1000, 2000.0, 2000.1, 2, 9),  # bid shows 2 lots
        (T0 + 63 * S, 2000.0, 1, 1),
        (T0 + 66 * S, 2000.2, 1, 1, 1000, 2000.1, 2000.2, 9, 9),  # after the 5 s timer + 50 ms
    ]
    _, out = simulate(rows, direction=-1, bracket=Bracket(5.0, 5.0, 5), config=config)
    assert out["exit_reason"] == "time"
    assert out["entry_px"] == pytest.approx(1999.9)  # sold 3 at the 2-lot bid: one tick worse
    assert "beyond_displayed_size" in out["flags"]
    assert out["pnl_ticks"] == pytest.approx(-3) and out["pnl_usd"] == pytest.approx(-90 - 15)


def test_session_close_forces_exit_and_missing_book_falls_back_to_trade_price():
    t = trades([(T0 + 3290_200_000_000, 2000.0, 1, 1), (T0 + 3300_100_000_000, 2000.3, 1, 1)])
    t.bid[0] = UNDEF_PRICE  # no bid before the entry trade
    sim = Simulator(GC, CFG, Bracket(9, 9, 600), CAL)
    view = ExecView(t, t.ts_recv)
    pos = sim.order(1, "GCZ6", T0 + 3290 * S, 0.5, {})
    k = sim.fill(view, 0, pos)
    _, out = sim.advance(view, k + 1, pos)
    assert out["exit_reason"] == "session_close" and "no_book" in out["flags"]
    assert out["entry_px"] == pytest.approx(2000.0)


@dataclass(frozen=True)
class OneShot:
    """Signals once, at the first row with a fast ATR, to compare engine and labels."""

    direction: int = 1
    bracket: Bracket = field(default_factory=lambda: Bracket(1.0, 1.0, 120))
    name: str = "one_shot"
    fired: list = field(default_factory=list)

    def required(self):
        return ("1m@1s.atr_bps",)

    def signals(self, f):
        out = np.zeros(len(f["1m@1s.atr_bps"]), np.int8)
        ok = np.flatnonzero(np.isfinite(f["1m@1s.atr_bps"]))
        if len(ok) and not self.fired:
            out[ok[0]] = self.direction
            self.fired.append(True)
        return out

    def params(self):
        return {}


def session_chunk(cal, t, start, end):
    return MarketChunk("GCZ6", start, end, t, coverage(cal), "test")


def run(cal, strategy, chunks, config, features):
    engine = Engine(GC, cal, strategy, config, features)
    frames = [engine.process(c).frame for c in chunks]
    return engine.finish(), FeatureFrame.concat(frames)


@pytest.mark.parametrize("use_bias", [False, True])
def test_whole_session_and_second_by_second_runs_are_identical(use_bias):
    cal = calendar((0, 2.5), (3, 6))
    features = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)
    config = ExecutionConfig(
        feed_latency_ms=3,
        close_delay_ms=80,
        order_latency_ms=40,
        cooldown_s=5,
        flat_before_close_s=120,
    )
    t = random_trades(T0, T0 + 6 * HOUR, seed=21, rate=1.5, recv_jitter_ns=150_000_000)
    params = {
        "use_bias": use_bias,
        "trigger_rsi": 40.0,
        "trigger_delta": -1.0,
        "bias_ret_atr": 0.0,
        "bias_rsi": 0.0,
        "max_bias_age_s": 4000.0,
        "bracket": {"target_atr": 1.0, "stop_atr": 1.0, "max_hold_s": 120},
    }
    sessions = []
    for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
        known = t.ts_recv + config.feed_latency
        sel = (known >= o + config.close_delay) & (known < c + config.close_delay)
        sessions.append(session_chunk(cal, t.take(sel), o, c))
    whole, whole_frame = run(
        cal, make_strategy("bias_pullback", params), sessions, config, features
    )
    seconds = [s for chunk in sessions for s in split_by_second(chunk, cal, config)]
    stepwise, step_frame = run(
        cal, make_strategy("bias_pullback", params), seconds, config, features
    )
    for name, values in whole_frame.features.items():
        np.testing.assert_array_equal(step_frame.features[name], values, err_msg=name)
    assert whole["trades"] == stepwise["trades"]
    assert whole["summary"] == stepwise["summary"]
    assert whole["quality"] == stepwise["quality"]
    assert whole["summary"]["trades"] >= 5, whole["summary"]
    assert whole["quality"]["test"]["late_trades"] > 0  # the jitter exercises late arrivals


def test_labels_match_the_engine_for_the_same_decision():
    cal = calendar((0, 1))
    t = random_trades(T0, T0 + HOUR, seed=4, rate=3)
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50)
    chunk = session_chunk(cal, t, int(cal.opens[0]), int(cal.closes[0]))
    strategy = OneShot()
    engine = Engine(GC, cal, strategy, config)
    result = engine.process(chunk)
    traded = engine.finish()["trades"]
    sim = Simulator(GC, config, strategy.bracket, cal)
    rows = candidate_outcomes(sim, "GCZ6", result.frame, result.signals, result.view)
    assert len(traded) == len(rows) == 1
    assert rows[0] == traded[0]


def test_strategy_validation_and_unknown_names():
    with pytest.raises(ValueError):
        make_strategy("nope")
    with pytest.raises(ValueError):
        BiasPullback(trigger_rsi=70)
    with pytest.raises(ValueError):
        Bracket(max_hold_s=0)
    with pytest.raises(ValueError):
        ExecutionConfig(close_delay_ms=1500)
    assert isinstance(Trades.empty(), Trades)


def test_streamed_candidate_summary_equals_the_full_list():
    cal = calendar((0, 1))
    t = random_trades(T0, T0 + HOUR, seed=9, rate=3)
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50)
    strategy = make_strategy(
        "bias_pullback", {"use_bias": False, "trigger_rsi": 45.0, "trigger_delta": -1.0}
    )
    engine = Engine(GC, cal, strategy, config, FeatureConfig(rsi_period=3, atr_period=3))
    result = engine.process(session_chunk(cal, t, int(cal.opens[0]), int(cal.closes[0])))
    sim = Simulator(GC, config, strategy.bracket, cal)
    rows = candidate_outcomes(sim, "GCZ6", result.frame, result.signals, result.view)
    streamed = CandidateSummary()
    streamed.add(iter_candidate_outcomes(sim, "GCZ6", result.frame, result.signals, result.view))
    assert len(rows) > 50
    assert streamed.result() == summarize_candidates(rows)
    assert streamed.result()["rows"] == len(rows)
