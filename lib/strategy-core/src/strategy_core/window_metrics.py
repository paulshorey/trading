"""Per-second metrics (`metrics.FIELDS`) aggregated over each row's rolling window: the last
`slots` rows, `o - slots + 1 ... o`, the same rows as the row's rolling candle.

Sums add, extremes take the extreme of valid rows, and first and last values come from the
earliest and latest row with a valid observation, so a window equals the direct aggregation
of its trades. Two statistics need more than their per-second values:

- **Price path.** Within-second paths plus one bridge from each observed second's open to the
  previous observed close, excluding the bridge into the window's first observed second.
- **CVD extremes.** Running buy - sell volume from the window start, from each second's net
  delta and its own extremes (`BaseBars.delta_high`, `delta_low`).

It also carries the latest observation as of each row, from any earlier row: the last trade
time, and the last sampled book (prices, displayed sizes, and imbalance) with the time of
the trade that showed it. TBBO shows the book only at trades, so its age is part of it.

The window keeps the previous `slots - 1` rows and the carried values between calls, so
processing a session at once or one second at a time gives identical results.
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .bars import OBSERVED, BaseBars
from .metrics import FIELDS, FIRST, MAX, MIN, SUM

BIG = np.iinfo(np.int64).max
BAR_INPUTS = ("status", "open", "close", "buy", "sell", "trades", "delta_high", "delta_low")
BRIDGES = ("bridge_abs", "bridge_up", "bridge_down")
CARRY = {
    "close": np.int64,
    "has_close": np.int8,
    "bid": np.int64,
    "ask": np.int64,
    "quote_at": np.int64,
    "has_quote": np.int8,
    "bid_size": np.int64,
    "ask_size": np.int64,
    "imbalance": np.float64,
    "depth_at": np.int64,
    "has_depth": np.int8,
    "trade_at": np.int64,
    "has_trade": np.int8,
}
# Outputs beyond the metric fields
AS_OF = (
    "book_bid",
    "book_ask",
    "book_at",
    "has_book",
    "book_bid_size",
    "book_ask_size",
    "book_imbalance",
    "book_depth_at",
    "has_depth",
    "last_trade_at",
    "has_trade",
)


class MetricWindow:
    STATE = ("tail", "carry")

    def __init__(self, slots: int = 60):
        self.w = slots
        self.tail: dict[str, np.ndarray] = {}
        self.carry: dict[str, np.ndarray] = {k: np.zeros((), t) for k, t in CARRY.items()}

    def update(self, bars: BaseBars, metrics: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        m, w = len(bars), self.w
        if m == 0:
            names = [f.name for f in FIELDS] + ["observed", "delta_high", "delta_low", *AS_OF]
            return {k: np.zeros(0) for k in names}
        cur = {name: getattr(bars, name) for name in BAR_INPUTS} | dict(metrics)
        cur |= self._bridges(cur)
        out = self._as_of(cur)
        n_tail = len(self.tail["status"]) if self.tail else 0
        pad = w - 1 - n_tail
        x = {
            k: np.r_[np.zeros(pad, v.dtype), self.tail[k] if self.tail else v[:0], v]
            for k, v in cur.items()
        }
        total = pad + n_tail + m
        r = np.arange(total - m, total)  # output rows
        lo = r - w + 1

        def window_sum(v: np.ndarray) -> np.ndarray:
            if v.dtype.kind == "i":
                c = np.r_[0, np.cumsum(v)]
                return c[r + 1] - c[lo]
            acc = v[r].copy()  # floats: one fixed order (newest first) for any chunking
            for j in range(1, w):
                acc += v[r - j]
            return acc

        def first_last(valid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
            index = np.arange(total)
            nxt = np.minimum.accumulate(np.where(valid, index, total)[::-1])[::-1]
            prv = np.maximum.accumulate(np.where(valid, index, -1))
            first, last = nxt[lo], prv[r]
            return first, last, first <= r

        bounds = {}
        for f in FIELDS:
            v = x[f.name]
            if f.kind == SUM:
                out[f.name] = window_sum(v)
                continue
            valid = x[f.valid] > 0
            if f.kind in (MAX, MIN):
                fill = -BIG if f.kind == MAX else BIG
                view = sliding_window_view(np.where(valid, v, fill), w)[-m:]
                res = view.max(axis=1) if f.kind == MAX else view.min(axis=1)
                out[f.name] = np.where(res == fill, 0, res)
                continue
            if f.valid not in bounds:
                bounds[f.valid] = first_last(valid)
            first, last, ok = bounds[f.valid]
            pos = first if f.kind == FIRST else last
            out[f.name] = np.where(ok, v[np.clip(pos, 0, total - 1)], 0)

        observed = x["status"] == OBSERVED
        first_obs, _, any_obs = first_last(observed)
        safe = np.clip(first_obs, 0, total - 1)
        for name, bridge in (
            ("path_abs", "bridge_abs"),
            ("upticks", "bridge_up"),
            ("downticks", "bridge_down"),
        ):
            inner = window_sum(x[bridge]) - np.where(any_obs, x[bridge][safe], 0)
            out[name] = out[name] + inner
        out["observed"] = window_sum(observed.astype(np.int64))

        net = x["buy"] - x["sell"]
        before = np.cumsum(net) - net  # running delta at each row start (arbitrary origin)
        hi = sliding_window_view(before + x["delta_high"], w)[-m:].max(axis=1)
        low = sliding_window_view(before + x["delta_low"], w)[-m:].min(axis=1)
        out["delta_high"] = hi - before[lo]
        out["delta_low"] = low - before[lo]

        keep = max(n_tail + m - (w - 1), 0)
        self.tail = {k: v[pad + keep :].copy() for k, v in x.items()}
        return out

    def _bridges(self, cur: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Bridge from each observed second's open to the previous observed close."""
        obs = cur["status"] == OBSERVED
        m = len(obs)
        c = self.carry
        last = np.maximum.accumulate(np.where(obs, np.arange(m), -1))
        before = np.r_[-1, last[:-1]] if m else last
        known = before >= 0
        prev = np.where(known, cur["close"][np.maximum(before, 0)], c["close"])
        has = obs & (known | bool(c["has_close"]))
        if m and last[-1] >= 0:
            c["close"] = np.asarray(cur["close"][last[-1]])
            c["has_close"] = np.asarray(1, np.int8)
        gap = cur["open"] - prev
        return {
            "bridge_abs": np.where(has, np.abs(gap), 0),
            "bridge_up": (has & (gap > 0)).astype(np.int64),
            "bridge_down": (has & (gap < 0)).astype(np.int64),
        }

    def _as_of(self, cur: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Latest book and trade time at or before each row, from this or any earlier row."""
        c, m, out = self.carry, len(cur["status"]), {}
        for valid, has, flag, pairs in (
            (
                cur["quote_trades"] > 0,
                "has_quote",
                "has_book",
                {"book_bid": ("last_bid", "bid"), "book_ask": ("last_ask", "ask")}
                | {"book_at": ("quote_at", "quote_at")},
            ),
            (
                cur["depth_trades"] > 0,
                "has_depth",
                "has_depth",
                {"book_bid_size": ("last_bid_size", "bid_size")}
                | {"book_ask_size": ("last_ask_size", "ask_size")}
                | {"book_imbalance": ("imbalance_last", "imbalance")}
                | {"book_depth_at": ("depth_at", "depth_at")},
            ),
            (
                cur["trades"] > 0,
                "has_trade",
                "has_trade",
                {"last_trade_at": ("last_at", "trade_at")},
            ),
        ):
            i = np.maximum.accumulate(np.where(valid, np.arange(m), -1))
            known = i >= 0
            for name, (source, key) in pairs.items():
                out[name] = np.where(known, cur[source][np.maximum(i, 0)], c[key])
            out[flag] = (known | bool(c[has])).astype(np.int8)
            if m and known[-1]:
                for source, key in pairs.values():
                    c[key] = np.asarray(cur[source][i[-1]], CARRY[key])
                c[has] = np.asarray(1, np.int8)
        return out
