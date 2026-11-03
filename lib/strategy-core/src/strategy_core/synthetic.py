"""Synthetic TBBO trade streams for tests and demos. Never use them as research data."""

import numpy as np

from .market import NS, PX, Trades


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
