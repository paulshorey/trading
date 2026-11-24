from dataclasses import dataclass, field

import numpy as np
import pytest
from helpers import T0, TICK, calendar, coverage, quotes, trades
from strategy_core.engine import Engine, MarketChunk, session_view, split_by_second
from strategy_core.execution import (
    CANCELLED,
    EXPIRED,
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
    attempt,
    attempt_limit,
    candidate_outcomes,
    iter_candidate_outcomes,
    summarize_candidates,
)
from strategy_core.market import (
    F_BAD_TS_RECV,
    F_MAYBE_BAD_BOOK,
    HOUR,
    NS,
    PRODUCTS,
    PX,
    UNDEF_PRICE,
    UNDEF_SIZE,
    BookEvents,
    Trades,
)
from strategy_core.strategies import BiasPullback, Bracket, Entry, make_strategy, trend_gate
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


def test_a_trade_record_leaves_the_book_until_a_change_follows():
    """A trade record carries the book before the trade. With no change after it (the trade
    met hidden or implied liquidity), that book stands and the stop sells at it."""
    sim = Simulator(GC, CFG, BRACKET, CAL)
    trigger = trades([(T0 + 61 * S, 1999.6, 9, -1, 1_000, 1999.6, 1999.7, 1, 5)])
    book = BookEvents.concat([quotes([ENTRY]), trade_events(trigger)])
    view = exec_view(trigger, book)
    pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
    assert sim.fill(view, pos)[0] == FILLED
    _, out = sim.advance(view, 0, pos)
    assert out["exit_reason"] == "stop" and out["exit_px"] == pytest.approx(1999.6)
    assert "no_book" not in out["flags"]


def test_a_stop_triggered_by_a_late_trade_fills_at_the_records_released_with_it():
    """Regression (PR #81 review): a trigger released two seconds late used to fill at the
    book of the second it was released in, after two seconds of later movement."""
    trigger = (T0 + 61 * S, 1999.6, 1, -1, 2 * S)  # released with second 63, known at 63.1 s
    fell = (T0 + 61_500_000_000, 1998.0, 1998.1)  # on time, after the trigger
    left = (T0 + 61 * S, 1999.5, 1999.7, 5, 5, 2 * S + 1_000)  # the trigger's own book change
    _, out = simulate([trigger], [ENTRY, fell, left])
    assert out["exit_reason"] == "stop" and out["exit_px"] == pytest.approx(1999.5)
    assert (out["exit_ns"], out["exit_known_ns"]) == (str(T0 + 61 * S), str(T0 + 63_100_000_000))
    # with no record released beside it, the stop fills at the trigger's price and says so
    _, out = simulate([trigger], [ENTRY, fell])
    assert out["exit_px"] == pytest.approx(1999.6) and "no_book" in out["flags"]


def test_the_book_is_the_record_received_last_and_never_takes_effect_early():
    """Each record is the whole top of book after its event, so it includes every record
    received before it (PR #81 review)."""
    # An event-time inversion in one second: the later-received record is stamped earlier.
    view = exec_view(
        trades([]),
        quotes(
            [
                (T0 + 60 * S, 2000.0, 2000.1),
                (T0 + 60_800_000_000, 2000.2, 2000.3),
                (T0 + 60_700_000_000, 2000.4, 2000.5, 5, 5, 101_000_000),  # received at 60.801 s
            ]
        ),
    ).book
    assert view.at(T0 + 60_750_000_000).bid == 2000_000_000_000  # neither had happened
    assert view.at(T0 + 60_800_000_000).bid == 2000_400_000_000  # both had: the newest book
    # A late record released a second before one that was received earlier.
    first = (T0 + 61_050_000_000, 2000.0, 2000.1)  # received at 61.050001 s, second 62
    newer = (T0 + 60 * S, 2000.2, 2000.3, 5, 5, 1_052_000_000)  # received at 61.052 s, second 61
    whole = exec_view(trades([]), quotes([first, newer])).book
    assert whole.known(T0 + 61 * S).bid == 2000_200_000_000
    assert whole.known(T0 + 62 * S).bid == whole.last.bid == 2000_200_000_000
    # the same two seconds as separate chunks
    one = exec_view(trades([]), quotes([newer])).book
    two = BookView(quotes([first]), np.array([T0 + 62 * S]), one.last, 0, one.recv_max)
    assert two.last.bid == 2000_200_000_000 and two.recv_max == one.recv_max


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


CASES = {
    "pullback": ({"use_bias": False}, {}),
    "bias": ({"use_bias": True}, {}),
    # a position is closed by the signal that would open the other side
    "opposite": ({"use_bias": False, "close": "opposite"}, {}),
    # limit entries at the touch, cancelled after 3 seconds, behind the displayed size
    "passive": ({"use_bias": False, "entry": {"kind": "passive", "wait_s": 3.0}}, {}),
    "passive_through": (
        {"use_bias": False, "close": "opposite", "entry": {"kind": "passive", "wait_s": 20.0}},
        {"passive_fill": "through"},
    ),
    # no time limit, the middle timeframe's ATR, the stop moved to the entry price, a gate
    "swing": (
        {
            "use_bias": False,
            "close": "opposite",
            "gate": ["10m@10s.mid_atr_0p5.trend"],
            "entry": {"kind": "market", "cutoff_s": 600},
            "bracket": {
                "target_atr": 1.0,
                "stop_atr": 1.0,
                "max_hold_s": None,
                "atr": "10m@10s",
                "breakeven_atr": 0.3,
            },
        },
        {},
    ),
    # positions sized by risk, and a session stopped by its loss limit
    "risk": (
        {"use_bias": False},
        {"account_usd": 20_000.0, "risk_pct": 1.0, "daily_loss_pct": 1.5},
    ),
}


@pytest.mark.parametrize("case", CASES)
def test_whole_session_and_second_by_second_runs_are_identical(case):
    cal = calendar((0, 2.5), (3, 6))
    features = FeatureConfig(rsi_period=3, atr_period=3, volume_period=3)
    extra, execution = CASES[case]
    config = ExecutionConfig(
        feed_latency_ms=3,
        close_delay_ms=80,
        order_latency_ms=40,
        cooldown_s=5,
        flat_before_close_s=120,
        **execution,
    )
    t = random_trades(T0, T0 + 6 * HOUR, seed=21, rate=1.5, recv_jitter_ns=150_000_000)
    params = {
        "trigger_rsi": 40.0,
        "trigger_delta": -1.0,
        "bias_ret_atr": 0.0,
        "bias_rsi": 0.0,
        "max_bias_age_s": 4000.0,
        "bracket": {"target_atr": 1.0, "stop_atr": 1.0, "max_hold_s": 120},
    } | extra
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
    for name, values in whole_frame.context.items():
        np.testing.assert_array_equal(step_frame.context[name], values, err_msg=name)
    assert whole["trades"] == stepwise["trades"]
    assert whole["summary"] == stepwise["summary"]
    assert whole["quality"] == stepwise["quality"]
    summary, done = whole["summary"], whole["trades"]
    assert summary["trades"] >= 5, summary
    reasons = {t["exit_reason"] for t in done}
    if case in ("pullback", "bias"):
        assert reasons >= {"target", "stop"}
        assert summary["expired_orders"] == summary["unsized_signals"] == 0
        assert whole["quality"]["test"]["late_trades"] > 0  # the jitter exercises late arrivals
    if case == "opposite":
        assert "decision" in reasons
        # a closing decision is made while the position is known, by the opposite signal
        for t in (t for t in done if t["exit_reason"] == "decision"):
            assert int(t["exit_ns"]) - int(t["entry_ns"]) > 0
    if case == "passive":
        assert summary["expired_orders"] > 0  # nothing reached them within 3 seconds
    if case in ("passive", "passive_through"):
        # filled at the touch of the book they met: on average better than the mid-price the
        # engine held when it decided, where a market order pays half the spread
        assert np.mean([t["entry_slip_ticks"] for t in done]) < 0
    if case == "swing":
        assert not reasons & {"time"} and reasons & {"session_close", "decision"}
        assert any("stop_at_entry" in t["flags"] for t in done)
        gate = whole_frame.features["10m@10s.mid_atr_0p5.trend"]
        at = np.searchsorted(whole_frame.end, [int(t["signal_end_ns"]) for t in done])
        assert all(not gate[i] * t["direction"] < 0 for i, t in zip(at, done, strict=True))
        assert np.isfinite(whole_frame.context["atr:10m@10s"]).any()
    if case == "risk":
        assert {t["contracts"] for t in done} - {1} and summary["net_pct"] == pytest.approx(
            100 * summary["net_usd"] / 20_000
        )
        assert summary["sessions_at_daily_limit"] >= 1
        # sized so that the stop risks at most 1% of the account
        for t in done:
            risk = abs(t["entry_px"] - t["stop_px"]) / 0.1 * GC.tick_value * t["contracts"]
            assert risk <= 200 + 1e-6


def test_no_position_is_opened_after_the_daily_loss_limit_until_the_next_session():
    cal = calendar((0, 2.5), (3, 6))
    config = ExecutionConfig(account_usd=20_000.0, risk_pct=1.0, daily_loss_pct=0.01)
    t = random_trades(T0, T0 + 6 * HOUR, seed=21, rate=1.5)
    engine = Engine(GC, cal, make_strategy("bias_pullback", {
        "use_bias": False, "trigger_rsi": 40.0, "trigger_delta": -1.0,
    }), config, FeatureConfig(rsi_period=3, atr_period=3, volume_period=3))  # fmt: skip
    for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True):
        inside = (t.ts_recv >= o) & (t.ts_recv < c)
        engine.process(session_chunk(cal, t.take(inside), o, c))
    out = engine.finish()
    # a limit of $2 is passed by the first losing trade of each session: nothing follows it
    by_session = [
        [x for x in out["trades"] if o < int(x["entry_ns"]) < c]
        for o, c in zip(cal.opens.tolist(), cal.closes.tolist(), strict=True)
    ]
    for held in by_session:
        total = np.cumsum([x["pnl_usd"] for x in held])
        assert len(held) >= 1 and total[-1] <= -2 and (total[:-1] > -2).all()
    assert out["summary"]["sessions_at_daily_limit"] == 2


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


def test_exits_judge_each_trade_by_its_own_event_time():
    """Regression (PR #81 review): a trade stamped after the timed exit, received before a
    stop trigger stamped before it, must not hide the trigger."""
    rows = [
        (T0 + 121_500_000_000, 2000.0, 1, 1),  # after the timed exit arrives at 121.15 s
        (T0 + 121 * S, 1999.6, 1, -1, 600_000_000),  # before it, received 100 ms later
    ]
    _, out = simulate(rows, [ENTRY])
    assert out["exit_reason"] == "stop" and out["exit_ns"] == str(T0 + 121 * S)
    assert out["exit_px"] == pytest.approx(1999.6) and out["mae_ticks"] == pytest.approx(-5)
    # without the trigger the timer ends the trade, and the later trade is not an excursion
    _, out = simulate([(T0 + 121_500_000_000, 1999.0, 1, 1)], [ENTRY])
    assert out["exit_reason"] == "time" and out["mae_ticks"] == pytest.approx(0)


def test_a_book_flagged_as_possibly_wrong_prices_nothing():
    """Regression (PR #81 review): Databento flags records after an unrecoverable gap. An entry
    that meets one is cancelled; the next record without the flag restores the book."""
    sim = Simulator(GC, CFG, BRACKET, CAL)
    book = quotes([ENTRY, (T0 + 61_100_000_000, 2000.2, 2000.3)])
    book.flags[0] = F_MAYBE_BAD_BOOK
    view = exec_view(trades([]), book)
    pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
    assert sim.fill(view, pos) == (CANCELLED, T0 + 61_100_000_000)
    assert pos.decision_bid == UNDEF_PRICE and not view.book.at(ARRIVAL).usable
    again = sim.order(1, "GCZ6", T0 + 61 * S, 0.5, {}, view)
    assert sim.fill(view, again)[0] == FILLED and again.entry_px == 2000_300_000_000


def test_a_book_is_not_carried_across_missing_data():
    """Regression (PR #81 review): with a gap in coverage, a fill inside it or just after it
    must not use the book from before it."""
    book = quotes([ENTRY, (T0 + 122 * S, 2000.4, 2000.5)])
    cover = np.array([[T0 + 120 * S, T0 + HOUR], [T0, T0 + 61 * S]])  # 61 s to 120 s missing
    view = BookView(book, (book.ts_event // S + 1) * S, coverage=cover)
    assert view.at(ARRIVAL).ask == 2000_100_000_000 and view.known(T0 + 61 * S) is not None
    assert view.at(T0 + 90 * S) is None and view.known(T0 + 90 * S) is None  # inside the gap
    assert view.at(T0 + 121 * S) is None  # covered again, but nothing has happened since
    assert view.at(T0 + 123 * S).bid == 2000_400_000_000
    # touching intervals are one stretch: the book carries across a file boundary
    joined = BookView(
        book,
        (book.ts_event // S + 1) * S,
        coverage=np.array([[T0, T0 + 90 * S], [T0 + 90 * S, T0 + HOUR]]),
    )
    assert joined.at(T0 + 121 * S).ask == 2000_100_000_000
    # the engine passes each chunk's coverage: a carried book alone prices nothing after a gap
    sim = Simulator(GC, CFG, BRACKET, CAL)
    alone = BookView.empty(view.quote(0), cover)
    pos = sim.order(
        1,
        "GCZ6",
        T0 + 121 * S,
        0.5,
        {},
        ExecView(Trades.empty(), np.empty(0, np.int64), alone, T0 + 123 * S),
    )
    assert pos.decision_bid == UNDEF_PRICE
    assert (
        sim.fill(ExecView(Trades.empty(), np.empty(0, np.int64), alone, T0 + 123 * S), pos)[0]
        == CANCELLED
    )


def test_a_record_with_an_unreliable_receive_time_is_ordered_by_position():
    """Regression (PR #81 review): Databento flags the receive time of the book it restates at
    the start of a file. Such a record is the newest book where it stands, and its receive
    time never makes a later record look older."""
    book = quotes(
        [
            (T0 + 60 * S, 2000.0, 2000.1),
            (T0 + 60_500_000_000, 2000.2, 2000.3, 5, 5, 3600 * S),  # flagged: received "1 h later"
            (T0 + 60_600_000_000, 2000.4, 2000.5),
        ]
    )
    book.flags[1] = F_BAD_TS_RECV
    view = BookView(book, np.full(3, T0 + 61 * S))
    assert view.quote(1).bid == 2000_200_000_000 and view.quote(1).usable
    assert view.last.bid == 2000_400_000_000 and view.recv_max == int(book.ts_recv[2])


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


def test_an_attempt_says_whether_a_trade_closed_did_not_happen_or_is_unknown():
    """The two values of a candidate depend on it: a trade result exists only for `closed`,
    and the value of attempting is zero only for `late`."""
    sim = Simulator(GC, CFG, Bracket(9, 9, 600), CAL)
    rows = [(T0 + 61 * S, 2000.0, 1, 1), (T0 + 3296 * S, 2000.3, 1, 1)]
    book = [ENTRY, (T0 + 3290 * S, 2000.0, 2000.1), (T0 + 3295 * S, None, 2000.4)]
    view = exec_view(trades(rows), quotes(book))

    def state(signal_s, data=view):
        pos = sim.order(1, "GCZ6", T0 + signal_s * S, 0.5, {}, data)
        return attempt(sim, data, pos)

    closed, trade, known = state(60)  # the 600 s timer ends on a two-sided book
    assert closed == "closed" and trade["exit_reason"] == "time"
    assert known == int(trade["exit_known_ns"])
    fallback, trade, _ = state(3290)  # the forced exit meets a one-sided book
    assert fallback == "exit_no_book" and "no_book" in trade["flags"]
    assert state(3296) == ("entry_no_book", None, T0 + 3297_100_000_000)
    assert state(3300) == ("late", None, T0 + 3300 * S)  # at the forced exit: known, no trade
    short = exec_view(trades(rows[:1]), quotes(book[:1]), end=T0 + 300 * S)  # the data ends
    assert state(60, short) == ("censored", None, 0)
    assert state(300, short) == ("pending", None, 0)


def test_adverse_ticks_charge_every_marketable_order_and_no_resting_limit():
    book = [ENTRY, (T0 + 66 * S, 2000.4, 2000.5)]
    rows = [(T0 + 63 * S, 2000.3, 1, 1)]
    timed = Bracket(5.0, 5.0, 5)
    _, plain = simulate(rows, book, bracket=timed)
    worse = ExecutionConfig(**{**CFG.__dict__, "adverse_ticks": 1})
    _, out = simulate(rows, book, bracket=timed, config=worse)
    assert out["entry_px"] == pytest.approx(plain["entry_px"] + 0.1)  # bought a tick higher
    assert out["exit_px"] == pytest.approx(plain["exit_px"] - 0.1)  # the timed exit sold lower
    assert out["pnl_ticks"] == pytest.approx(plain["pnl_ticks"] - 2)
    rows = [(T0 + 63 * S, 2000.9, 1, 1)]  # through a target 0.5 above either entry
    _, plain = simulate(rows, book)
    _, out = simulate(rows, book, config=worse)
    assert plain["exit_reason"] == out["exit_reason"] == "target"
    assert out["pnl_ticks"] == plain["pnl_ticks"]  # the bracket moves with the entry
    with pytest.raises(ValueError, match="adverse_ticks"):
        ExecutionConfig(adverse_ticks=-1)


def test_a_session_view_is_the_view_the_engine_builds_for_the_session():
    cal = calendar((0, 1))
    t = random_trades(T0, T0 + HOUR, seed=4, rate=3)
    config = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50)
    chunk = session_chunk(cal, t, int(cal.opens[0]), int(cal.closes[0]))
    strategy = OneShot()
    engine = Engine(GC, cal, strategy, config)
    result = engine.process(chunk)
    sim = Simulator(GC, config, strategy.bracket, cal)
    alone = session_view(chunk, cal, config)
    for view in (result.view, alone):
        rows = candidate_outcomes(sim, "GCZ6", result.frame, result.signals, view)
        assert rows == engine.finish()["trades"] and len(rows) == 1


def test_a_resting_limit_entry_fills_at_its_price_when_a_trade_goes_through_it():
    sim = Simulator(GC, CFG, Bracket(1.0, 1.0, 600), CAL)
    rows = [
        (T0 + 60_120_000_000, 1999.5, 1, 1),  # through the price, before the order arrives
        (T0 + 70 * S, 1999.8, 1, 1),  # at the price: no queue position, so no fill
        (T0 + 80 * S, 1999.7, 1, 1),  # through it: filled at the limit price
        (T0 + 90 * S, 2000.4, 1, 1),  # through the target, 0.5 above the fill
    ]
    view = exec_view(trades(rows), quotes([ENTRY]))
    limit = round(1999.8 * PX)

    def state(expire_s, config=CFG, px=limit, direction=1, signal_s=60, atr=0.5, data=view):
        s = Simulator(GC, config, sim.bracket, CAL)
        pos = s.order(direction, "GCZ6", T0 + signal_s * S, atr, {}, data)
        return attempt_limit(s, data, pos, px, T0 + expire_s * S), pos

    (closed, trade, known), pos = state(200)
    assert closed == "closed" and trade["exit_reason"] == "target"
    assert (pos.entry_px, pos.entry_ns, pos.entry_known_ns) == (
        limit, T0 + 80 * S, T0 + 81_100_000_000,
    )  # fmt: skip
    assert trade["pnl_ticks"] == pytest.approx(5) and known == int(trade["exit_known_ns"])
    # never filled before its expiry: known when that second closes, and no trade
    assert state(75)[0] == ("expired", None, T0 + 76_100_000_000)
    assert state(60)[0] == ("expired", None, T0 + 61_100_000_000)  # expired when it arrives
    touch = ExecutionConfig(**{**CFG.__dict__, "limit_fill": "touch"})
    assert state(200, touch)[1].entry_ns == T0 + 70 * S
    # a book already through the price fills on arrival, at the book and never worse
    (closed, trade, _), pos = state(200, px=round(2000.3 * PX))
    assert (pos.entry_px, pos.entry_ns) == (round(2000.1 * PX), ARRIVAL)
    worse = ExecutionConfig(**{**CFG.__dict__, "adverse_ticks": 5})
    assert state(200, worse, px=round(2000.3 * PX))[1].entry_px == round(2000.3 * PX)
    # a sell rests above the market: the trade at 2000.4 goes through 2000.3
    (closed, trade, _), pos = state(200, px=round(2000.3 * PX), direction=-1)
    assert (pos.entry_px, pos.entry_ns) == (round(2000.3 * PX), T0 + 90 * S)
    # the trade that fills the order never triggers its exits: a stop one tick below the price
    (closed, trade, _), pos = state(200, atr=0.01)
    assert pos.stop_px == limit - TICK and trade["exit_reason"] == "target"
    # no usable book when it arrives: unknown; the data ends while it rests: unknown
    short = exec_view(trades(rows[:2]), quotes([ENTRY]), end=T0 + 75 * S)
    assert state(200, data=short)[0] == ("pending", None, 0)
    assert state(74, data=short)[0][0] == "expired"
    none = exec_view(trades(rows), quotes([(T0 + 1 * S, None, 2000.1)]))
    assert state(200, data=none)[0] == ("entry_no_book", None, T0 + 61_100_000_000)
    assert state(200, signal_s=3300)[0] == ("late", None, T0 + 3300 * S)


def test_a_closing_decision_is_a_market_order_that_the_bracket_can_still_beat():
    sim = Simulator(GC, CFG, Bracket(9, 1.0, 600), CAL)
    book = [ENTRY, (T0 + 69 * S, 2000.3, 2000.4), (T0 + 75 * S, 2000.0, 2000.1)]

    def exit_of(rows, decision_s=70):
        view = exec_view(trades(rows), quotes(book))
        pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
        assert sim.fill(view, pos)[0] == FILLED
        sim.close(pos, T0 + decision_s * S + CFG.close_delay)
        return sim.advance(view, 0, pos)[1]

    out = exit_of([(T0 + 61 * S, 2000.2, 1, 1)])
    # decided at 70.1 s, it arrives 50 ms later and sells at the bid it meets
    assert out["exit_reason"] == "decision" and int(out["exit_ns"]) == T0 + 70_150_000_000
    assert out["exit_px"] == pytest.approx(2000.3)
    assert int(out["exit_known_ns"]) == T0 + 71_100_000_000
    # the stop is still at the exchange while the order travels: a trade at 70.12 s fills it
    out = exit_of([(T0 + 70_120_000_000, 1999.6, 1, 1)])
    assert out["exit_reason"] == "stop"
    out = exit_of([(T0 + 70_160_000_000, 1999.6, 1, 1)])  # after it arrived: too late
    assert out["exit_reason"] == "decision"
    # a decision after the timed exit changes nothing
    assert exit_of([(T0 + 61 * S, 2000.2, 1, 1)], decision_s=700)["exit_reason"] == "time"


def test_a_position_without_a_time_limit_is_held_to_the_forced_exit():
    sim = Simulator(GC, CFG, Bracket(9, 9, None), CAL)
    view = exec_view(trades([(T0 + 61 * S, 2000.2, 1, 1)]), quotes([ENTRY]))
    pos = sim.order(-1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
    assert sim.fill(view, pos)[0] == FILLED
    out = sim.advance(view, 0, pos)[1]
    assert out["exit_reason"] == "session_close" and out["hold_s"] == pytest.approx(3239.9)
    with pytest.raises(ValueError, match="max_hold_s"):
        Bracket(max_hold_s=0)
    with pytest.raises(ValueError, match="atr must be"):
        Bracket(atr="5m@5s")


def test_a_passive_entry_joins_the_touch_behind_the_displayed_size():
    entry = Entry("passive", wait_s=5.0)
    rows = [
        (T0 + 61 * S, 2000.0, 3, 2),  # three of the five ahead trade at the bid
        (T0 + 62 * S, 2000.0, 2, 2),  # the other two
        (T0 + 63 * S, 2000.0, 1, 2),  # its own contract
        (T0 + 90 * S, 2000.6, 1, 1),  # through the target 0.5 above
    ]
    view = exec_view(trades(rows), quotes([ENTRY]))

    def entered(config=CFG, data=view, direction=1, contracts=None):
        sim = Simulator(GC, config, BRACKET, CAL, entry)
        pos = sim.order(direction, "GCZ6", T0 + 60 * S, 0.5, {}, data, contracts)
        return sim.enter(data, pos), pos, sim

    (status, known, after), pos, sim = entered()
    assert (status, pos.limit_px, pos.entry_px) == (FILLED, round(2000.0 * PX), round(2000.0 * PX))
    assert (pos.entry_ns, known, after) == (T0 + 63 * S, T0 + 64_100_000_000, 3)
    assert sim.advance(view, after, pos)[1]["exit_reason"] == "target"
    # two contracts need one more to trade there: nothing does before the order is cancelled
    (status, known, _), pos, _ = entered(contracts=2)
    assert (status, known, pos.queue) == (EXPIRED, T0 + 66_100_000_000, 1)
    strict = ExecutionConfig(**{**CFG.__dict__, "passive_fill": "through"})
    assert entered(strict)[0][0] == EXPIRED  # no trade went through the bid
    # a sell joins the ask; a trade through it fills it at its price at once
    up = exec_view(trades([(T0 + 61 * S, 2000.2, 1, 1)]), quotes([ENTRY]))
    (status, _, _), pos, _ = entered(strict, up, direction=-1)
    assert (status, pos.entry_px, pos.entry_ns) == (FILLED, round(2000.1 * PX), T0 + 61 * S)
    # chunk by chunk, the size still ahead is carried on the position
    sim = Simulator(GC, CFG, BRACKET, CAL, entry)
    whole = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
    first = exec_view(trades(rows[:1]), quotes([ENTRY]), end=T0 + 62 * S)
    assert sim.enter(first, whole) == (WAIT, 0, 0) and whole.queue == 3 and whole.resting
    rest = exec_view(trades(rows[1:]), quotes([]), end=T0 + HOUR)
    assert sim.enter(rest, whole)[0] == FILLED and whole.entry_ns == T0 + 63 * S
    with pytest.raises(ValueError, match="kind"):
        Entry("limit")


def test_the_stop_moves_to_the_entry_price_once_the_amended_order_has_arrived():
    bracket = Bracket(target_atr=3.0, stop_atr=1.0, max_hold_s=600, breakeven_atr=1.0)
    sim = Simulator(GC, CFG, bracket, CAL)
    book = [ENTRY, (T0 + 64 * S, 2000.0, 2000.1)]

    def exit_of(rows):
        view = exec_view(trades(rows), quotes(book))
        pos = sim.order(1, "GCZ6", T0 + 60 * S, 0.5, {}, view)
        assert sim.fill(view, pos)[0] == FILLED and pos.entry_px == round(2000.1 * PX)
        return sim.advance(view, 0, pos)[1], pos

    far = (T0 + 63 * S, 2000.6, 1, 1)  # 0.5 in favour: known at 64.1 s, amended by 64.15 s
    out, pos = exit_of([far, (T0 + 64_120_000_000, 2000.1, 1, 2), (T0 + 65 * S, 2000.0, 1, 2)])
    assert pos.stop_at_entry_ns == T0 + 64_150_000_000
    # the trade at the entry price at 64.12 s came before the amendment; the one at 65 s is
    # at the moved stop and sells at the bid it left
    assert out["exit_reason"] == "stop" and int(out["exit_ns"]) == T0 + 65 * S
    assert out["flags"] == ["stop_at_entry"] and out["exit_px"] == pytest.approx(2000.0)
    assert out["r_multiple"] == pytest.approx(-0.2)  # risk is still the first stop's distance
    # without the move in favour the stop stays where it was
    out, pos = exit_of([(T0 + 65 * S, 2000.0, 1, 2)])
    assert out["exit_reason"] == "time" and not pos.stop_at_entry_ns and out["flags"] == []


def test_positions_are_sized_by_the_risk_of_their_stop():
    risky = ExecutionConfig(account_usd=100_000.0, risk_pct=0.5)
    sim = Simulator(GC, risky, Bracket(stop_atr=1.0), CAL)
    # a stop of 5 ticks risks $50 a contract and one of 100 ticks $1,000: $500 buys 10 and 0
    assert sim.size(np.array([0.5, 10.0, 4.9, np.nan])).tolist() == [10, 0, 1, 0]
    assert Simulator(GC, CFG, BRACKET, CAL).size(np.array([0.5, 10.0])).tolist() == [1, 1]
    with pytest.raises(ValueError, match="risk_pct"):
        ExecutionConfig(account_usd=1e5, risk_pct=0)


def test_the_trend_gate_forbids_opening_against_a_named_trend_and_nothing_else():
    f = {
        "slow": np.array([1.0, -1.0, 0.0, np.nan, 1.0]),
        "mid": np.array([1.0, 1.0, 1.0, 1.0, -1.0]),
    }
    long_ok, short_ok = trend_gate(f, ("slow", "mid"), 5)
    assert long_ok.tolist() == [True, False, True, True, False]
    assert short_ok.tolist() == [False, False, False, False, False]
    assert trend_gate(f, ("slow",), 5)[1].tolist() == [False, True, True, True, False]
    assert all(v.all() for v in trend_gate(f, (), 5))
