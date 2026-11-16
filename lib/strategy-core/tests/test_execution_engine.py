from dataclasses import dataclass, field

import numpy as np
import pytest
from helpers import T0, calendar, coverage, quotes, trades
from strategy_core.engine import Engine, MarketChunk, split_by_second
from strategy_core.execution import (
    CANCELLED,
    FILLED,
    WAIT,
    BookView,
    ExecutionConfig,
    ExecView,
    Simulator,
)
from strategy_core.features import FeatureConfig, FeatureFrame
from strategy_core.labels import (
    CandidateSummary,
    candidate_outcomes,
    iter_candidate_outcomes,
    summarize_candidates,
)
from strategy_core.market import HOUR, NS, PRODUCTS, UNDEF_SIZE, BookEvents, Trades
from strategy_core.strategies import BiasPullback, Bracket, make_strategy
from strategy_core.synthetic import random_book, random_trades, trade_events

GC = PRODUCTS["GC"]
CAL = calendar((0, 1))
CFG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50, cooldown_s=0)
S = NS


BRACKET = Bracket(1.0, 1.0, 60)


def exec_view(t, book, config=CFG, end=T0 + HOUR):
    """Trades and book events by one-second slot, then receive order, as the engine holds them."""

    def by_slot(records):
        at = np.maximum(
            records.ts_event, records.ts_recv + config.feed_latency - config.close_delay
        )
        slot = (at // S + 1) * S
        order = np.argsort(slot, kind="stable")
        return records.take(order), slot[order]

    t, known = by_slot(t)
    return ExecView(t, known + config.close_delay, BookView(*by_slot(book)), end)


def simulate(rows, book, *, direction=1, bracket=BRACKET, config=CFG, signal_s=60, atr=0.5):
    sim = Simulator(GC, config, bracket, CAL)
    view = exec_view(trades(rows), quotes(book), config)
    pos = sim.order(direction, "GCZ6", T0 + signal_s * S, atr, {}, view)
    status, _ = sim.fill(view, pos)
    assert status == FILLED, "entry did not fill"
    _, out = sim.advance(view, 0, pos)
    return pos, out


ARRIVAL = T0 + 60_150_000_000  # the signal second ends at 60 s; 100 ms to decide, 50 ms to travel
ENTRY = (T0 + 60_100_000_000, 2000.0, 2000.1)  # the book the order meets: a long fills at 2000.1


def test_entry_meets_the_book_at_arrival_and_target_needs_a_trade_through():
    book = [
        (T0 + 59 * S, 1999.9, 2000.0),  # the book held at the decision
        ENTRY,  # the last change before the order arrives
        (T0 + 60_200_000_000, 2000.3, 2000.4),  # after the arrival: never seen by the fill
    ]
    rows = [
        (T0 + 61 * S, 2000.6, 1, 1),  # touches the target only
        (T0 + 62 * S, 2000.7, 1, 1),  # trades through it
    ]
    pos, out = simulate(rows, book)
    assert pos.entry_px == 2000_100_000_000 and out["entry_ns"] == str(ARRIVAL)
    assert (out["target_px"], out["stop_px"]) == (2000.6, 1999.6)  # 1 ATR = 5 ticks
    assert out["exit_reason"] == "target" and out["exit_ns"] == str(T0 + 62 * S)
    assert out["pnl_ticks"] == pytest.approx(5)
    assert out["pnl_usd"] == pytest.approx(5 * 10 - 2 * 2.5)
    assert out["entry_delay_ms"] == pytest.approx(150)
    # against the 1999.95 mid held at the decision: half the spread plus the one-tick move
    assert out["decision_spread_ticks"] == pytest.approx(1)
    assert out["entry_slip_ticks"] == pytest.approx(1.5)
    _, touch = simulate(
        rows, book, config=ExecutionConfig(**{**CFG.__dict__, "limit_fill": "touch"})
    )
    assert touch["exit_ns"] == str(T0 + 61 * S)


def test_stop_fills_at_the_book_its_trigger_left():
    trigger = (T0 + 61 * S, 1999.6, 1, -1)
    # the book change of the same match event, received just after the trade
    _, out = simulate([trigger], [ENTRY, (T0 + 61 * S, 1999.5, 1999.7, 5, 5, 2_000)])
    assert out["exit_reason"] == "stop" and out["exit_px"] == pytest.approx(1999.5)
    assert out["exit_ns"] == str(T0 + 61 * S)
    assert out["pnl_ticks"] == pytest.approx(-6) and out["r_multiple"] == pytest.approx(-6 / 5)
    assert out["mae_ticks"] == pytest.approx(-5)  # worst traded price, 1999.6
    # a bid that recovered above the trigger: the stop still sold behind the trigger
    _, out = simulate([trigger], [ENTRY, (T0 + 61 * S, 1999.8, 1999.9, 5, 5, 2_000)])
    assert out["exit_px"] == pytest.approx(1999.6) and out["pnl_ticks"] == pytest.approx(-5)
    # a change that happened after the trigger does not price it
    _, out = simulate([trigger], [ENTRY, (T0 + 61 * S + 1, 1999.0, 1999.1)])
    assert out["exit_px"] == pytest.approx(1999.6)  # the bid was still 2000.0: capped


def test_short_time_exit_and_depth_penalty():
    config = ExecutionConfig(**{**CFG.__dict__, "contracts": 3})
    book = [
        (T0 + 60_100_000_000, 2000.0, 2000.1, 2, 9),  # the bid shows 2 lots
        (T0 + 66 * S, 2000.1, 2000.2, 9, 9),  # before the 5 s timer ends, plus 50 ms
    ]
    rows = [(T0 + 63 * S, 2000.0, 1, 1)]
    _, out = simulate(rows, book, direction=-1, bracket=Bracket(5.0, 5.0, 5), config=config)
    # known at 61.1 s (the fill's second closes), 5 s timer, 50 ms to the exchange
    assert out["exit_reason"] == "time" and out["exit_ns"] == str(T0 + 66_150_000_000)
    assert out["entry_px"] == pytest.approx(1999.9)  # sold 3 at the 2-lot bid: one tick worse
    assert "beyond_displayed_size" in out["flags"]
    assert out["pnl_ticks"] == pytest.approx(-3) and out["pnl_usd"] == pytest.approx(-90 - 15)
    # Regression (PR #63 review): Databento's undefined size shows nothing, never a deep book
    unset = [(*book[0][:3], UNDEF_SIZE, 9), book[1]]
    _, out = simulate(rows, unset, direction=-1, bracket=Bracket(5.0, 5.0, 5), config=config)
    assert out["entry_px"] == pytest.approx(1999.9) and "beyond_displayed_size" in out["flags"]


def test_session_close_forces_exit_and_an_unusable_book_falls_back_to_the_last_trade():
    sim = Simulator(GC, CFG, Bracket(9, 9, 600), CAL)
    rows = [(T0 + 3296 * S, 2000.3, 1, 1)]
    book = [(T0 + 3290 * S, 2000.0, 2000.1), (T0 + 3295 * S, None, 2000.4)]  # the bid vanishes
    view = exec_view(trades(rows), quotes(book))
    pos = sim.order(1, "GCZ6", T0 + 3290 * S, 0.5, {}, view)
    assert sim.fill(view, pos) == (FILLED, T0 + 3291_100_000_000)
    _, out = sim.advance(view, 0, pos)
    assert out["exit_reason"] == "session_close" and "no_book" in out["flags"]
    assert out["exit_ns"] == str(T0 + 3300_050_000_000)  # 300 s before the close, plus 50 ms
    assert out["entry_px"] == pytest.approx(2000.1) and out["exit_px"] == pytest.approx(2000.3)
    # an entry that meets no usable book is cancelled, never filled at a guess
    late = sim.order(1, "GCZ6", T0 + 3296 * S, 0.5, {}, view)
    assert sim.fill(view, late) == (CANCELLED, T0 + 3297_100_000_000)
    # and one that arrives at or after the forced exit is cancelled then
    last = sim.order(1, "GCZ6", T0 + 3300 * S, 0.5, {}, view)
    assert sim.fill(view, last) == (CANCELLED, T0 + 3300 * S)


def test_a_fill_waits_for_its_second_and_ignores_records_released_later():
    """The book at a time is the last event that happened at or before it among those released
    by the close of that time's second, so a late record never rewrites an earlier fill."""
    sim = Simulator(GC, CFG, BRACKET, CAL)
    book = quotes(
        [
            ENTRY,
            # happened before the arrival, but received 2 s later: released with second 63
            (T0 + 60_120_000_000, 2000.5, 2000.6, 5, 5, 2 * S),
        ]
    )
    for end in (T0 + 60 * S, ARRIVAL):  # the arrival's second has not closed yet
        view = exec_view(trades([]), book, end=end)
        pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
        assert sim.fill(view, pos) == (WAIT, 0)
    view = exec_view(trades([]), book, end=T0 + 61 * S)
    pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
    assert sim.fill(view, pos)[0] == FILLED and pos.entry_px == 2000_100_000_000
    # the same second arriving as its own chunk: the earlier book is carried in
    carried = BookView(BookEvents.empty(), np.empty(0, np.int64), view.book.quote(0))
    alone = ExecView(Trades.empty(), np.empty(0, np.int64), carried, T0 + 61 * S)
    again = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, alone)
    assert sim.fill(alone, again)[0] == FILLED and again.entry_px == pos.entry_px


def test_trade_records_in_the_book_are_the_trades():
    t = random_trades(T0, T0 + 600 * S, seed=3)
    book = random_book(t, seed=3)
    assert len(book) > 2 * len(t)
    for name in Trades.FIELDS:
        np.testing.assert_array_equal(getattr(book.trades(), name), getattr(t, name), name)
    assert len(trade_events(Trades.empty())) == 0


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


def session_chunk(cal, t, start, end, book=None):
    if book is None:
        book = random_book(t, seed=5)
    return MarketChunk("GCZ6", start, end, t, coverage(cal), "test", True, book)


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
    book = random_book(t, seed=22, recv_jitter_ns=150_000_000)
    sessions = []
    for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):

        def inside(r, o=o, c=c):
            known = r.ts_recv + config.feed_latency
            return r.take((known >= o + config.close_delay) & (known < c + config.close_delay))

        sessions.append(session_chunk(cal, inside(t), o, c, inside(book)))
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
    assert {t["exit_reason"] for t in whole["trades"]} >= {"target", "stop"}
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


def test_fills_never_match_a_trade_that_happened_before_arrival():
    """Regression (PR #62 review): with an event-time inversion, the running maximum of event
    time must not make an earlier trade look like the first trade at or after arrival."""
    rows = [
        (T0 + 20 * S, 2000.0, 1, 1),  # consumed earlier
        (T0 + 5 * S, 2000.1, 1, 1),  # received later but happened before the arrival
        (T0 + 25 * S, 2000.2, 1, 1),
    ]
    t = trades(rows)
    view = ExecView(t, t.ts_recv, BookView.empty(), T0 + HOUR)
    assert view.first_at_or_after(1, T0 + 15 * S) == 2
    assert view.first_at_or_after(0, T0 + 15 * S) == 0
    assert view.first_at_or_after(0, T0 + 30 * S) == 3


def test_trades_before_the_entry_never_trigger_exits():
    """Regression (PR #62 review): with event-time inversions after the entry, a trade that
    happened earlier must not hit the target or stop or count toward excursions."""
    target_rows = [
        (T0 + 59 * S, 2000.9, 1, 1, 2 * S),  # before the entry, received after it: ignored
        (T0 + 62 * S, 2000.7, 1, 1),
    ]
    _, out = simulate(target_rows, [ENTRY])
    assert out["exit_reason"] == "target" and out["exit_ns"] == str(T0 + 62 * S)
    assert out["mfe_ticks"] == pytest.approx(6)  # 2000.7, not the earlier 2000.9
    stop_rows = [
        (T0 + 59_500_000_000, 1999.0, 1, -1, 1_200_000_000),  # before the entry: ignored
        (T0 + 61 * S, 1999.6, 1, -1),  # triggers the stop at 61 s
    ]
    _, out = simulate(stop_rows, [ENTRY, (T0 + 61 * S, 1999.4, 1999.5, 5, 5, 2_000)])
    assert out["exit_reason"] == "stop" and out["exit_ns"] == str(T0 + 61 * S)
    assert out["exit_px"] == pytest.approx(1999.4) and out["pnl_ticks"] == pytest.approx(-7)
    assert out["mae_ticks"] == pytest.approx(-5) and int(out["exit_ns"]) >= int(out["entry_ns"])


def test_candidates_never_vanish_and_the_summary_averages_slippage():
    """Regression (PR #62 review): unfilled and still-open candidates yield marker rows that
    the summary counts."""
    sim = Simulator(GC, CFG, Bracket(5.0, 5.0, 6000), CAL)
    frame = FeatureFrame(
        np.array([T0 + 60 * S, T0 + 3000 * S], np.int64),
        {"x": np.array([0.0, 1.0])},
        {"atr": np.array([0.5, 0.5])},
    )
    t = trades([(T0 + 61 * S, 2000.1, 1, 1)])
    view = exec_view(t, quotes([ENTRY]), end=T0 + 3000 * S)  # the data ends at 3000 s
    rows = candidate_outcomes(sim, "GCZ6", frame, np.array([1, 1], np.int8), view)
    assert [r["exit_reason"] for r in rows] == ["censored", "unfilled"]
    assert rows[0]["entry_ns"] == str(ARRIVAL) and rows[1]["entry_ns"] is None
    assert summarize_candidates(rows) == {"rows": 0, "unfilled": 1, "censored": 1}
    closed = {"exit_reason": "target", "pnl_usd": 1.0, "r_multiple": 1.0}
    summary = CandidateSummary()
    summary.add([{**closed, "entry_slip_ticks": slip} for slip in (0.5, 1.5, None)])
    assert summary.result()["rows"] == 3
    assert summary.result()["entry_slip_ticks_avg"] == 1.0  # of the rows that have one


def test_abandoned_positions_close_at_the_latest_book_held():
    cal = calendar((0, 1))
    open_ = int(cal.opens[0])
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50)
    strategy = OneShot(bracket=Bracket(50.0, 50.0, 3600))
    engine = Engine(GC, cal, strategy, config, FeatureConfig(rsi_period=3, atr_period=3))
    first = random_trades(open_, open_ + 1200 * S, seed=12, rate=3)
    book = random_book(first, seed=12)
    engine.process(
        MarketChunk("GCZ6", open_, open_ + 1200 * S, first, coverage(cal), "test", True, book)
    )
    assert engine.position is not None
    entry_ns = engine.position.entry_ns
    held = engine.quote
    assert (held.bid, held.ask) == (int(book.bid[-1]), int(book.ask[-1]))
    [trade] = engine.finish()["trades"]
    assert trade["exit_reason"] == "end_of_data" and "abandoned" in trade["flags"]
    assert entry_ns <= int(trade["exit_ns"]) < open_ + 1200 * S
    assert trade["hold_s"] >= 0 and trade["exit_px"] == pytest.approx(held.bid / 1e9)


def test_a_tradable_chunk_without_book_events_cannot_fill():
    cal = calendar((0, 1))
    t = random_trades(T0, T0 + HOUR, seed=4, rate=3)
    engine = Engine(GC, cal, OneShot(), CFG)
    with pytest.raises(ValueError, match="no book events"):
        engine.process(MarketChunk("GCZ6", T0, T0 + HOUR, t, coverage(cal), "test"))
    warm = Engine(GC, cal, OneShot(), CFG)  # a warm-up chunk only builds features
    assert not warm.process(
        MarketChunk("GCZ6", T0, T0 + HOUR, t, coverage(cal), "test", False)
    ).trades
