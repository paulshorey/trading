import numpy as np
from helpers import T0, calendar, coverage, quotes, trades
from strategy_core import targets
from strategy_core.engine import MarketChunk, session_view
from strategy_core.execution import ExecutionConfig
from strategy_core.market import NS, PX

S = NS
CFG = ExecutionConfig(feed_latency_ms=0, close_delay_ms=100, order_latency_ms=50)
CAL = calendar((0, 1))
UNTIL = T0 + 3300 * S  # the forced exit, 300 s before the close


def view_of(rows, book, cover=None):
    cover = coverage(CAL) if cover is None else cover
    chunk = MarketChunk("GCZ6", T0, T0 + 3600 * S, trades(rows), cover, "s", True, quotes(book))
    return session_view(chunk, CAL, CFG), cover


def px(value):
    return round(value * PX)


ROWS = [
    (T0 + 100 * S, 2000.0, 1, 1),
    (T0 + 200 * S, 2001.0, 1, 1),  # exactly one R above 2000.0: it reaches the barrier
    (T0 + 300 * S, 1998.9, 1, 2),  # through one R below
    (T0 + 400 * S, 2000.5, 1, 1),
]
BOOK = [
    (T0 + 50 * S, 1999.9, 2000.1),
    (T0 + 110 * S, 2000.4, 2000.6),
    (T0 + 3290 * S, 2000.3, 2000.5),
]


def test_the_move_ahead_is_the_first_barrier_reached_or_the_move_at_the_forced_exit():
    view, cover = view_of(ROWS, BOOK)
    decision = T0 + np.array([60, 210, 310, 310]) * S + CFG.close_delay
    until = np.full(4, UNTIL)
    reference = np.full(4, px(2000.0))
    distance = np.array([px(1.0), px(1.0), px(5.0), px(0.2)])
    y, settled, state = targets.move_ahead(view, cover, decision, until, reference, distance)
    # up at 200 s; down at 300 s; neither within 5.0, so the mid-price 2000.4 at the forced
    # exit, in R; and 2000.5 at 400 s is beyond a barrier of 0.2
    assert y.tolist() == [1.0, -1.0, 0.08, 1.0]
    assert settled.tolist() == [T0 + 200 * S, T0 + 300 * S, UNTIL, T0 + 400 * S]
    assert (state == targets.KNOWN).all()
    # a short sees the negative: mirrored prices give the mirrored target
    flipped = [(ts, 4000.0 - p, n, 3 - side) for ts, p, n, side in ROWS]
    mirror, _ = view_of(flipped, [(ts, 4000.0 - ask, 4000.0 - bid) for ts, bid, ask in BOOK])
    assert targets.move_ahead(mirror, cover, decision, until, reference, distance)[0].tolist() == [
        -1.0, 1.0, -0.08, -1.0,
    ]  # fmt: skip
    # a trade before the decision never counts
    late = T0 + np.array([200, 300]) * S + CFG.close_delay
    y, _, _ = targets.move_ahead(view, cover, late, until[:2], reference[:2], distance[:2])
    assert y.tolist() == [-1.0, 0.4]  # 2001.0 at 200 s came before; then 2000.4 at the end


def test_a_target_is_unknown_when_coverage_ends_first_or_no_book_is_left():
    cut = np.array([[T0, T0 + 250 * S]])
    view, _ = view_of(ROWS, BOOK, cut)
    decision = T0 + np.array([60, 210, 260]) * S + CFG.close_delay
    until, reference = np.full(3, UNTIL), np.full(3, px(2000.0))
    y, _, state = targets.move_ahead(view, cut, decision, until, reference, np.full(3, px(1.0)))
    # settled at 200 s inside the covered data; the others need data that is not there
    assert y[0] == 1.0 and np.isnan(y[1:]).all()
    assert state.tolist() == [targets.KNOWN, targets.UNKNOWN_COVERAGE, targets.UNKNOWN_COVERAGE]
    one_sided, cover = view_of(ROWS[:1], [*BOOK[:2], (T0 + 3290 * S, None, 2000.5)])
    y, _, state = targets.move_ahead(
        one_sided, cover, decision[:1], until[:1], reference[:1], np.array([px(5.0)])
    )
    assert np.isnan(y[0]) and state[0] == targets.UNKNOWN_BOOK
    assert set(targets.REASONS) == {targets.UNKNOWN_BOOK, targets.UNKNOWN_COVERAGE}


def test_horizon_moves_are_the_mid_price_later_in_the_given_unit():
    view, cover = view_of(ROWS, BOOK)
    decision = T0 + np.array([60, 3250]) * S + CFG.close_delay
    until, reference = np.full(2, UNTIL), np.full(2, px(2000.0))
    out = targets.moves(view, cover, decision, until, reference, np.full(2, px(2.0)), (30, 60))
    # 2000.0 still at 90 s, 2000.5 from 110 s on; a horizon past the forced exit has no move
    assert out[0].tolist() == [0.0, 0.25] and out[1, 0] == 0.25 and np.isnan(out[1, 1])
    cut = np.array([[T0, T0 + 100 * S]])
    assert np.isnan(targets.moves(view, cut, decision, until, reference, reference, (60,))).all()
