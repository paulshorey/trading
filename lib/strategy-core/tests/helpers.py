import numpy as np
from strategy_core.market import HOUR, NS, PX, SessionCalendar, Trades

T0 = 1_767_571_200 * NS  # 2026-01-05 00:00 UTC
TICK = 100_000_000  # 0.1


def calendar(*hours: tuple[float, float]) -> SessionCalendar:
    """Sessions given as (open_hour, close_hour) offsets from T0."""
    opens = np.array([T0 + round(o * HOUR) for o, _ in hours], np.int64)
    closes = np.array([T0 + round(c * HOUR) for _, c in hours], np.int64)
    return SessionCalendar("test", opens, closes)


def trades(rows: list[tuple]) -> Trades:
    """Rows of (ts_event, price, size, side[, recv_delay_ns, bid, ask, bid_size, ask_size,
    bid_count, ask_count])."""
    n = len(rows)
    out = {
        name: np.zeros(n, dtype) for name, dtype in zip(Trades.FIELDS, Trades.DTYPES, strict=True)
    }
    for i, row in enumerate(rows):
        ts, price, size, side, *rest = row
        delay = rest[0] if rest else 1_000
        px = round(price * PX)
        bid = round(rest[1] * PX) if len(rest) > 1 else px - TICK
        ask = round(rest[2] * PX) if len(rest) > 2 else px + TICK
        out["ts_event"][i], out["ts_recv"][i] = ts, ts + delay
        out["price"][i], out["size"][i], out["side"][i] = px, size, side
        out["bid"][i], out["ask"][i] = bid, ask
        out["bid_size"][i] = rest[3] if len(rest) > 3 else 5
        out["ask_size"][i] = rest[4] if len(rest) > 4 else 5
        out["bid_count"][i] = rest[5] if len(rest) > 5 else 1
        out["ask_count"][i] = rest[6] if len(rest) > 6 else 1
    return Trades(**out)


def coverage(cal: SessionCalendar) -> np.ndarray:
    return np.stack([cal.opens, cal.closes], axis=1)


def wilder_rsi_reference(closes: list[float], n: int) -> list[float | None]:
    """Plain-Python Wilder RSI with a simple-mean seed: the pinned reference."""
    out: list[float | None] = [None] * len(closes)
    gains, losses = [], []
    avg_g = avg_l = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
        k = len(gains)
        if k < n:
            continue
        if k == n:
            avg_g, avg_l = sum(gains) / n, sum(losses) / n
        else:
            avg_g = (avg_g * (n - 1) + gains[-1]) / n
            avg_l = (avg_l * (n - 1) + losses[-1]) / n
        out[i] = (
            100.0
            if avg_l == 0 and avg_g > 0
            else 50.0
            if avg_l == 0
            else (100 - 100 / (1 + avg_g / avg_l))
        )
    return out
