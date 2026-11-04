"""Per-second metrics (`metrics.FIELDS`) aggregated over each row's rolling window: the last
`slots` rows, `o - slots + 1 ... o`, the same rows as the row's rolling candle.

Sums add, extremes take the extreme of valid rows, and first and last values come from the
earliest and latest row with a valid observation, so a window equals the direct aggregation
of its trades. Two statistics need more than their per-second values:

- **Price path and side transitions.** Within-second counts plus one bridge per observed
  second from the previous observed second's last trade to its first trade (price change;
  a side pair when both sides are known), excluding the bridge into the window's first
  observed second, so a window equals the direct count over its trades.
- **CVD extremes.** Running buy - sell volume from the window start, from each second's net
  delta and its own extremes (`BaseBars.delta_high`, `delta_low`).
- **Drawdown, drawup, and extreme order.** The largest drop over the window is the largest of
  each second's own drawdown and of an earlier second's high minus a later second's low (the
  same for drawup); which extreme came first follows the seconds of the window's first high
  and first low, and that second's own order when they share it.

It also carries the latest observation as of each row, from any earlier row: the last trade
time, and the last sampled book (prices, displayed sizes, and imbalance) with the time of
the trade that showed it. TBBO shows the book only at trades, so its age is part of it. An
observation is never carried across missing data, where newer trades may be unknown.

The window keeps the previous `slots - 1` rows and the carried values between calls, so
processing a session at once or one second at a time gives identical results.
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .bars import MISSING, OBSERVED, BaseBars
from .metrics import DRAWDOWN, DRAWUP, FIELDS, FIRST, MAX, MIN, ORDER, SUM

BIG = np.iinfo(np.int64).max
BAR_INPUTS = (
    "status",
    "open",
    "high",
    "low",
    "close",
    "buy",
    "sell",
    "trades",
    "delta_high",
    "delta_low",
)
BRIDGES = ("bridge_abs", "bridge_up", "bridge_down", "bridge_pair", "bridge_switch")
CARRY = {
    "close": np.int64,
    "side": np.int64,
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
            acc = v[lo].copy()  # floats: oldest first, the one order for any chunking
            for j in range(1, w):
                acc += v[lo + j]
            return acc

        def first_last(valid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
            index = np.arange(total)
            nxt = np.minimum.accumulate(np.where(valid, index, total)[::-1])[::-1]
            prv = np.maximum.accumulate(np.where(valid, index, -1))
            first, last = nxt[lo], prv[r]
            return first, last, first <= r

        bounds = {}
        path = self._path(x, m, w)
        for f in FIELDS:
            v = x[f.name]
            if f.kind in path:
                out[f.name] = path[f.kind]
                continue
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
            ("side_pairs", "bridge_pair"),
            ("side_switches", "bridge_switch"),
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

    @staticmethod
    def _path(x: dict[str, np.ndarray], m: int, w: int) -> dict[str, np.ndarray]:
        """Window drawdown, drawup, and extreme order from each row's own and its high and
        low, rows oldest to newest (0 without an observed row; NULL by the `trades` count)."""
        obs = sliding_window_view(x["status"] == OBSERVED, w)[-m:]
        high = np.where(obs, sliding_window_view(x["high"], w)[-m:], -BIG)
        low = np.where(obs, sliding_window_view(x["low"], w)[-m:], BIG)
        top = np.maximum.accumulate(high, axis=1)  # highest at or before each row
        bottom = np.minimum.accumulate(low, axis=1)
        before_top = np.c_[np.full(m, -BIG), top[:, :-1]]  # strictly earlier rows
        before_bottom = np.c_[np.full(m, BIG), bottom[:, :-1]]
        across_down = np.where(obs & (before_top > -BIG), before_top - low, 0)
        across_up = np.where(obs & (before_bottom < BIG), high - before_bottom, 0)
        own_down = np.where(obs, sliding_window_view(x["drawdown"], w)[-m:], 0)
        own_up = np.where(obs, sliding_window_view(x["drawup"], w)[-m:], 0)
        down = np.maximum(np.maximum(own_down, across_down).max(axis=1), 0)
        up = np.maximum(np.maximum(own_up, across_up).max(axis=1), 0)
        hi_row = np.argmax(high, axis=1)  # first row at the window's high
        lo_row = np.argmin(low, axis=1)
        own = sliding_window_view(x["extreme_order"], w)[-m:]
        same = own[np.arange(m), hi_row]
        order = np.where(lo_row < hi_row, 1, np.where(hi_row < lo_row, -1, same))
        any_obs = obs.any(axis=1)
        return {
            DRAWDOWN: np.where(any_obs, down, 0),
            DRAWUP: np.where(any_obs, up, 0),
            ORDER: np.where(any_obs, order, 0),
        }

    def _bridges(self, cur: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Bridges from the previous observed second's last trade to each observed second's
        first: the price change, and a side pair (and switch) when both sides are known."""
        obs = cur["status"] == OBSERVED
        m = len(obs)
        c = self.carry
        last = np.maximum.accumulate(np.where(obs, np.arange(m), -1))
        before = np.r_[-1, last[:-1]] if m else last
        known = before >= 0
        safe = np.maximum(before, 0)
        prev = np.where(known, cur["close"][safe], c["close"])
        prev_side = np.where(known, cur["last_side"][safe], c["side"])
        has = obs & (known | bool(c["has_close"]))
        if m and last[-1] >= 0:
            c["close"] = np.asarray(cur["close"][last[-1]])
            c["side"] = np.asarray(cur["last_side"][last[-1]], np.int64)
            c["has_close"] = np.asarray(1, np.int8)
        gap = cur["open"] - prev
        pair = has & (prev_side != 0) & (cur["first_side"] != 0)
        return {
            "bridge_abs": np.where(has, np.abs(gap), 0),
            "bridge_up": (has & (gap > 0)).astype(np.int64),
            "bridge_down": (has & (gap < 0)).astype(np.int64),
            "bridge_pair": pair.astype(np.int64),
            "bridge_switch": (pair & (prev_side != cur["first_side"])).astype(np.int64),
        }

    def _as_of(self, cur: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Latest book and trade time at or before each row, from this or any earlier row, but
        never across missing data: trades during a missing row are unknown, so each carried
        observation is unknown from a missing row until the next valid one."""
        c, m, out = self.carry, len(cur["status"]), {}
        index = np.arange(m)
        # index of the latest missing row at or before each row (-1: none in this chunk)
        gap = np.maximum.accumulate(np.where(cur["status"] == MISSING, index, -1))
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
            i = np.maximum.accumulate(np.where(valid, index, -1))
            fresh = (i >= 0) & (i > gap)  # observed in this chunk after its latest missing row
            carried = (gap < 0) & bool(c[has])  # from earlier chunks, with no missing row since
            for name, (source, key) in pairs.items():  # 0 where unknown, in any chunking
                known_value = np.where(fresh, cur[source][np.maximum(i, 0)], c[key])
                out[name] = np.where(fresh | carried, known_value, 0)
            out[flag] = (fresh | carried).astype(np.int8)
            if m and fresh[-1]:
                for source, key in pairs.values():
                    c[key] = np.asarray(cur[source][i[-1]], CARRY[key])
                c[has] = np.asarray(1, np.int8)
            elif m and gap[-1] >= 0:  # the chunk ends after missing data: nothing is known
                c[has] = np.asarray(0, np.int8)
        return out
