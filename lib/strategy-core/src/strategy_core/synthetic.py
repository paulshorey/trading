"""Synthetic MBP-1 trade and book streams for tests and demos. Never use them as research data."""

import numpy as np

from .market import ACTION_TRADE, NS, PX, BookEvents, Trades


def random_trades(
    start: int,
    end: int,
    *,
    rate: float = 3.0,
    price: float = 2000.0,
    tick: float = 0.1,
    seed: int = 0,
    recv_jitter_ns: int = 400_000,
) -> Trades:
    """A random walk of trades between `start` and `end` (UTC ns), about `rate` per second.

    Each trade carries a plausible pre-trade book: a buyer lifts the ask, a seller hits
    the bid. Receipt times add jitter, so event times are occasionally out of order."""
    rng = np.random.default_rng(seed)
    seconds = (end - start) / NS
    n = rng.poisson(rate * seconds)
    ts_event = np.sort(rng.integers(start, end, n)).astype(np.int64)
    ts_recv = ts_event + rng.integers(50_000, recv_jitter_ns, n)
    order = np.argsort(ts_recv, kind="stable")
    ts_event, ts_recv = ts_event[order], ts_recv[order]
    tick_px = round(tick * PX)
    steps = rng.choice([-1, 0, 0, 1], n)
    level = np.round(price * PX / tick_px).astype(np.int64) + np.cumsum(steps)
    side = rng.choice(np.array([1, -1, 0], np.int8), n, p=[0.45, 0.45, 0.10])
    px = level * tick_px
    ask = np.where(side >= 0, px, px + tick_px)
    bid = ask - tick_px
    return Trades(
        ts_event=ts_event,
        ts_recv=ts_recv,
        price=px,
        size=rng.integers(1, 6, n).astype(np.int64),
        side=side,
        bid=bid,
        ask=ask,
        bid_size=rng.integers(1, 10, n).astype(np.int64),
        ask_size=rng.integers(1, 10, n).astype(np.int64),
        bid_count=rng.integers(1, 4, n).astype(np.int64),
        ask_count=rng.integers(1, 4, n).astype(np.int64),
        flags=np.zeros(n, np.uint8),
    )


def random_book(
    trades: Trades,
    *,
    rate: float = 4.0,
    tick: float = 0.1,
    seed: int = 0,
    recv_jitter_ns: int = 400_000,
) -> BookEvents:
    """Book events around `trades`: every trade as its own record (with its pre-trade book),
    and about `rate` quote changes per second between them that restate the book near the
    latest trade. Receipt times add jitter, so quote changes also arrive out of order."""
    rng = np.random.default_rng(seed)
    if not len(trades):
        return BookEvents.empty()
    lo, hi = int(trades.ts_event.min()), int(trades.ts_event.max())
    n = rng.poisson(rate * (hi - lo) / NS)
    ts_event = np.sort(rng.integers(lo, hi + 1, n)).astype(np.int64)
    by_event = np.argsort(trades.ts_event, kind="stable")
    latest = by_event[np.maximum(np.searchsorted(trades.ts_event[by_event], ts_event) - 1, 0)]
    tick_px = round(tick * PX)
    bid = trades.bid[latest] + rng.choice([-1, 0, 0, 1], n) * tick_px
    ask = np.maximum(trades.ask[latest] + rng.choice([-1, 0, 0, 1], n) * tick_px, bid + tick_px)
    side = rng.choice(np.array([1, -1], np.int8), n)
    quotes = BookEvents(
        ts_event=ts_event,
        ts_recv=ts_event + rng.integers(50_000, recv_jitter_ns, n),
        action=np.full(n, ord("M"), np.uint8),
        side=side,
        price=np.where(side > 0, bid, ask),
        size=rng.integers(1, 10, n).astype(np.int64),
        bid=bid,
        ask=ask,
        bid_size=rng.integers(1, 10, n).astype(np.int64),
        ask_size=rng.integers(1, 10, n).astype(np.int64),
        bid_count=rng.integers(1, 4, n).astype(np.int64),
        ask_count=rng.integers(1, 4, n).astype(np.int64),
        flags=np.zeros(n, np.uint8),
    )
    both = BookEvents.concat([trade_events(trades), quotes])
    return both.take(np.argsort(both.ts_recv, kind="stable"))


def trade_events(trades: Trades) -> BookEvents:
    """Trades as MBP-1 trade records."""
    fields = {name: getattr(trades, name) for name in Trades.FIELDS}
    return BookEvents(action=np.full(len(trades), ACTION_TRADE, np.uint8), **fields)
