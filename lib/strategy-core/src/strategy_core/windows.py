"""Rolling (sliding-window) candles: at every step, a complete candle from the last
`slots` scheduled-open base bars. See docs/sliding-windows/design.md.

The window keeps the previous `slots - 1` bars between calls, so processing a whole
session at once or one step at a time yields identical candles.

A candle's phase is its trading-time ordinal modulo `slots` (see
`SessionCalendar.slot_ordinals`), never the clock: the previous candle of the same phase
is exactly `slots` rows earlier, adjacent and non-overlapping, across any closure.
"""

from dataclasses import dataclass

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .bars import MISSING, OBSERVED, BaseBars
from .kernels import ordered_sum
from .market import MINUTE, PX, SECOND, SessionCalendar

COMPLETE, EMPTY, GAP, WARMUP = 0, 1, 2, 3
STATUS_NAMES = ("complete", "empty", "gap", "warmup")


@dataclass(frozen=True)
class WindowSpec:
    name: str
    step: int
    slots: int

    @property
    def period(self) -> int:
        return self.step * self.slots


FAST = WindowSpec("1m@1s", SECOND, 60)  # entry timing: last 60 seconds, every second
BIAS = WindowSpec("1h@1m", MINUTE, 60)  # direction bias: last 60 minutes, every minute


@dataclass(frozen=True)
class Candles:
    """Rolling candles in quoted-price floats, one per base bar."""

    end: np.ndarray
    start: np.ndarray  # start of the oldest slot; end - start > period means it spans a closure
    ordinal: np.ndarray  # trading-time index of the newest slot
    phase: np.ndarray  # ordinal % slots
    status: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    high_at: np.ndarray
    low_at: np.ndarray
    volume: np.ndarray
    buy: np.ndarray
    sell: np.ndarray
    trades: np.ndarray
    vwap: np.ndarray

    def __len__(self) -> int:
        return len(self.end)


class RollingWindow:
    STATE = ("tail", "seen")  # see `state.export_state`

    def __init__(self, spec: WindowSpec, calendar: SessionCalendar):
        self.spec, self.calendar = spec, calendar
        self.tail = BaseBars.empty(spec.step)
        self.seen = 0  # scheduled-open slots received so far

    def update(self, bars: BaseBars) -> Candles:
        spec, w = self.spec, self.spec.slots
        if bars.step != spec.step:
            raise ValueError(f"{spec.name} expects {spec.step} ns base bars")
        m = len(bars)
        b = BaseBars.concat(spec.step, [self.tail, bars])
        pad = w - 1 - len(self.tail)  # absent slots before the first bar ever received
        n = len(b)
        obs = np.r_[np.zeros(pad, bool), b.status == OBSERVED]
        miss = np.r_[np.zeros(pad, bool), b.status == MISSING]
        absent = np.r_[np.ones(pad, bool), np.zeros(n, bool)]
        total = pad + n

        def window_sum(values: np.ndarray) -> np.ndarray:
            c = np.r_[0, np.cumsum(values)]
            return (c[w:] - c[:-w])[-m:] if m else c[:0]

        def padded(values: np.ndarray, fill) -> np.ndarray:
            return np.r_[np.full(pad, fill, values.dtype), values]

        n_obs = window_sum(obs.astype(np.int64))
        n_miss = window_sum(miss.astype(np.int64))
        n_absent = window_sum(absent.astype(np.int64))
        status = np.where(
            n_absent > 0,
            WARMUP,
            np.where(n_miss > 0, GAP, np.where(n_obs == 0, EMPTY, COMPLETE)),
        ).astype(np.int8)

        index = np.arange(total)
        nxt = np.minimum.accumulate(np.where(obs, index, total)[::-1])[::-1]
        prv = np.maximum.accumulate(np.where(obs, index, -1))
        rows = index[-m:] if m else index[:0]
        first = nxt[rows - w + 1]
        last = prv[rows]
        has = n_obs > 0

        open_ = padded(b.open, 0)
        close = padded(b.close, 0)
        high_masked = np.where(obs, padded(b.high, 0), np.iinfo(np.int64).min)
        low_masked = np.where(obs, padded(b.low, 0), np.iinfo(np.int64).max)
        hv = sliding_window_view(high_masked, w)[-m:] if m else high_masked[:0, None]
        lv = sliding_window_view(low_masked, w)[-m:] if m else low_masked[:0, None]
        hi_arg = rows - w + 1 + hv.argmax(axis=1)  # ties resolve to the earliest slot
        lo_arg = rows - w + 1 + lv.argmin(axis=1)
        high_at = padded(b.high_at, 0)
        low_at = padded(b.low_at, 0)
        ends = padded(b.end, 0)

        volume = window_sum(padded(b.volume, 0)).astype(float)
        # Float sums over each window's own slots, oldest first (not cumulative-sum
        # differences), so the result never depends on where a chunk started.
        pv = ordered_sum(sliding_window_view(padded(b.pv, 0.0), w)[-m:]) if m else np.zeros(0)
        nan = np.full(m, np.nan)

        def px(values: np.ndarray) -> np.ndarray:
            return np.where(has, values / PX, nan)

        start = np.where(n_absent > 0, 0, ends[np.maximum(rows - w + 1, 0)] - spec.step)
        ordinal = self.calendar.slot_ordinals(bars.end, spec.step)
        candles = Candles(
            end=bars.end,
            start=start,
            ordinal=ordinal,
            phase=ordinal % w,
            status=status,
            open=px(open_[np.minimum(first, total - 1)]),
            high=px(hv.max(axis=1) if m else hv[:, 0]),
            low=px(lv.min(axis=1) if m else lv[:, 0]),
            close=px(close[np.maximum(last, 0)]),
            high_at=np.where(has, high_at[hi_arg], 0),
            low_at=np.where(has, low_at[lo_arg], 0),
            volume=volume,
            buy=window_sum(padded(b.buy, 0)).astype(float),
            sell=window_sum(padded(b.sell, 0)).astype(float),
            trades=window_sum(padded(b.trades, 0)).astype(float),
            vwap=np.where(volume > 0, pv / np.where(volume > 0, volume, 1), nan),
        )
        self.tail = b.take(slice(max(n - (w - 1), 0), None))
        self.seen += m
        return candles
