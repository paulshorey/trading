"""The volatility family (docs/project/plan-1h-and-pivots.md, section 7): per-window calculations
shared by the stages `vol_1m` (`1h@1m` windows) and, next, `vol_1s` (`1m@1s` windows).

Every recursive value is per phase on same-phase windows, exactly like `kernels.wilder_atr`: the
same inputs (`Candles.analysis()`: complete windows, and empty ones at the carried price), the same
seeding (the mean of the first `n` values, then Wilder), and the same reset after a window without a
price (only the previous close is forgotten, so no change is measured across it).

- **Split ATR** (`split_atr`): each true range splits exactly at `P0`, the previous same-phase
  window's close (the window's first trade when there is none), into `up = max(H, P0) - P0` and
  `down = P0 - min(L, P0)`. Bullish ATR averages `2 x down` (volatility as a long feels it),
  bearish ATR `2 x up`, so their mean is the ATR to rounding.
- **Adverse excursion** (same kernel): the deepest drop a long sat through, from `P0` or any later
  high to any later low, `max(drawdown, P0 - L)`, and the short's mirror, `max(drawup, H - P0)`,
  from the window's exact path fields, with their Wilder averages.
- **Time-of-day normal** (`TimeOfDay`): the mean of the last `window` samples of a key (the
  minute's offset in scheduled-open minutes from its session's open), one sample per session and
  key, read before the current sample joins it: earlier sessions only.
- **Daily scale** (`DailyScale`): sessions are the calendar's scheduled-open intervals. A session
  that the stage saw from its open, without missing data, and whose previous interval was such a
  session, has a true range from the previous session's close (within the contract). The daily ATR
  is the mean of the last `period` such true ranges, each in bps of its session's close (a fixed
  window: a Wilder average at daily scale would need about 107 sessions to forget its start); its
  percentile ranks it among its previous `rank` values.
- **Window estimators**: Parkinson and Garman-Klass volatility of one window.

Floats are added in one fixed order (per row, oldest first), so any chunking gives identical bits.
"""

import math

import numpy as np
from numba import njit

from .bars import MISSING, OBSERVED
from .market import MINUTE

DAY_MINUTES = 1440  # time-of-day keys: no session is longer than a day
BIG = np.iinfo(np.int64).max


@njit(cache=True)
def split_atr(
    open_, high, low, close, drawdown, drawup, valid, phase, period, prev, bull, bear, long_,
    short, count, tr_out, p0_out, bull_out, bear_out, long_out, short_out, long_exc, short_exc,
):  # fmt: skip
    """Per phase, the true range split at `P0` and the adverse excursions, with their Wilder
    averages seeded and reset exactly as `kernels.wilder_atr` (prices in quoted units). The
    current window's values (`tr_out`, `p0_out`, `long_exc`, `short_exc`) are set for every valid
    window; the averages once `period` windows of the phase were seen. NaN elsewhere."""
    n = period
    for i in range(close.shape[0]):
        p = phase[i]
        tr_out[i] = p0_out[i] = long_exc[i] = short_exc[i] = np.nan
        bull_out[i] = bear_out[i] = long_out[i] = short_out[i] = np.nan
        if not valid[i]:
            prev[p] = np.nan
            continue
        h, lo = high[i], low[i]
        tr = h - lo  # as wilder_atr: the window's own range without a previous close
        p0 = open_[i]
        if not np.isnan(prev[p]):
            tr = max(h, prev[p]) - min(lo, prev[p])
            p0 = prev[p]
        up = max(h, p0) - p0
        down = p0 - min(lo, p0)
        le = max(drawdown[i], p0 - lo)
        se = max(drawup[i], h - p0)
        prev[p] = close[i]
        c = count[p] + 1
        count[p] = c
        if c <= n:
            bull[p] += 2.0 * down / n
            bear[p] += 2.0 * up / n
            long_[p] += le / n
            short[p] += se / n
        else:
            bull[p] = (bull[p] * (n - 1) + 2.0 * down) / n
            bear[p] = (bear[p] * (n - 1) + 2.0 * up) / n
            long_[p] = (long_[p] * (n - 1) + le) / n
            short[p] = (short[p] * (n - 1) + se) / n
        tr_out[i], p0_out[i], long_exc[i], short_exc[i] = tr, p0, le, se
        if c >= n:
            bull_out[i], bear_out[i] = bull[p], bear[p]
            long_out[i], short_out[i] = long_[p], short[p]


@njit(cache=True)
def keyed_mean(key, value, push, window, samples, count, out):
    """Per row in order: the mean of its key's last `window` samples (oldest first), NaN until
    there are `window`; then, where `push`, the row's value joins its key's samples."""
    for i in range(key.shape[0]):
        k = key[i]
        out[i] = np.nan
        if count[k] >= window:
            s = 0.0
            for j in range(window):
                s += samples[k, j]
            out[i] = s / window
        if push[i]:
            if count[k] >= window:
                for j in range(window - 1):
                    samples[k, j] = samples[k, j + 1]
                samples[k, window - 1] = value[i]
            else:
                samples[k, count[k]] = value[i]
                count[k] += 1


def session_minute(calendar, ends: np.ndarray, step: int) -> np.ndarray:
    """Offset of each row's minute in scheduled-open minutes from its session's open: 0 for the
    session's first minute. Sessions are the calendar's intervals, which hold no breaks."""
    iv = np.searchsorted(calendar.opens, ends - step, side="right") - 1
    minute_end = -(-ends // MINUTE) * MINUTE  # the end of the minute holding each row
    return ((minute_end - calendar.opens[iv]) // MINUTE - 1).astype(np.int64)


class TimeOfDay:
    """Samples per session minute (`keyed_mean`) for a typical level at the same minute of the
    session over the previous `window` sessions; at most `DAY_MINUTES x window` values."""

    def __init__(self, window: int):
        self.window = window
        self.STATE = ("samples", "count")
        self.samples = np.full((DAY_MINUTES, window), np.nan)
        self.count = np.zeros(DAY_MINUTES, np.int64)

    def update(self, key: np.ndarray, value: np.ndarray, push: np.ndarray) -> np.ndarray:
        if len(key) and (key.min() < 0 or key.max() >= DAY_MINUTES):
            raise ValueError("A session minute is outside one day")
        out = np.empty(len(key))
        keyed_mean(
            key.astype(np.int64), np.where(push, value, 0.0), push, self.window, self.samples,
            self.count, out,
        )  # fmt: skip
        return out


class DailyScale:
    """Per row, from its session's open: the daily ATR and its percentile, and the session's high,
    low, and true range so far. Rows have `step` ns; prices are fixed point."""

    STATE = (
        "interval",
        "complete",
        "high",
        "low",
        "close",
        "prior_interval",
        "prior_close",
        "prior_complete",
        "ranges",
        "range_count",
        "day_atr",
        "day_pct",
        "history",
        "history_count",
    )

    def __init__(self, calendar, step: int, period: int, rank: int):
        self.calendar, self.step, self.period, self.rank = calendar, step, period, rank
        self.interval, self.complete = -1, False
        self.high, self.low, self.close = 0, 0, 0
        self.prior_interval, self.prior_close, self.prior_complete = -1, 0, False
        self.ranges = np.full(period, np.nan)  # true ranges in bps, oldest first
        self.range_count = 0
        self.day_atr, self.day_pct = math.nan, math.nan
        self.history = np.full(rank, np.nan)  # earlier sessions' daily ATRs, oldest first
        self.history_count = 0

    def _finish(self) -> None:
        """The finished session becomes the previous one; its true range joins the daily ATR."""
        complete = self.complete and self.close > 0
        if complete and self.prior_complete and self.prior_interval == self.interval - 1:
            pc = self.prior_close
            tr = max(self.high, pc) - min(self.low, pc)
            self.ranges = push(self.ranges, self.range_count, tr / self.close * 1e4)
            self.range_count = min(self.range_count + 1, self.period)
        self.prior_interval, self.prior_close = self.interval, self.close
        self.prior_complete = complete

    def _start(self, interval: int, first_end: int) -> None:
        self.interval, self.high, self.low, self.close = interval, 0, 0, 0
        # seen from its open: the first row starts at the interval's open
        self.complete = bool(first_end - self.step == self.calendar.opens[interval])
        self.day_atr = self.day_pct = math.nan
        if self.range_count == self.period:
            total = 0.0
            for x in self.ranges:  # oldest first
                total += x
            self.day_atr = total / self.period
            if self.history_count == self.rank:
                below = float(np.sum(self.history < self.day_atr))
                equal = float(np.sum(self.history == self.day_atr))
                self.day_pct = (below + 0.5 * equal) / self.rank
            self.history = push(self.history, self.history_count, self.day_atr)
            self.history_count = min(self.history_count + 1, self.rank)

    def update(self, ends, status, high, low, close) -> dict[str, np.ndarray]:
        m, cal = len(ends), self.calendar
        out = {
            "day_atr_bps": np.full(m, np.nan),
            "day_pct": np.full(m, np.nan),
            "ok": np.zeros(m, bool),  # the session so far: seen from its open, no missing data
            "high": np.zeros(m, np.int64),
            "low": np.zeros(m, np.int64),
            "prior": np.zeros(m, bool),  # the previous session's close is known
            "prior_close": np.zeros(m, np.int64),
        }
        if m == 0:
            return out
        iv = np.searchsorted(cal.opens, ends - self.step, side="right") - 1
        cuts = np.flatnonzero(np.r_[True, iv[1:] != iv[:-1]])
        for a, b in zip(cuts, np.r_[cuts[1:], m], strict=True):
            if iv[a] != self.interval:
                if self.interval >= 0:
                    self._finish()
                self._start(int(iv[a]), int(ends[a]))
            g = slice(a, b)
            obs = status[g] == OBSERVED
            started = self.close > 0
            hi = np.maximum.accumulate(np.where(obs, high[g], -BIG))
            lo = np.minimum.accumulate(np.where(obs, low[g], BIG))
            if started:
                hi, lo = np.maximum(hi, self.high), np.minimum(lo, self.low)
            traded = started | np.logical_or.accumulate(obs)
            clean = np.logical_and.accumulate(status[g] != MISSING)
            out["ok"][g] = self.complete & clean & traded
            out["high"][g] = np.where(traded, hi, 0)
            out["low"][g] = np.where(traded, lo, 0)
            out["day_atr_bps"][g] = self.day_atr
            out["day_pct"][g] = self.day_pct
            if self.prior_complete and self.prior_interval == iv[a] - 1:
                out["prior"][g] = True
                out["prior_close"][g] = self.prior_close
            if obs.any():
                self.high, self.low = int(hi[-1]), int(lo[-1])
                self.close = int(close[g][obs][-1])
            self.complete = self.complete and bool(clean[-1])  # missing data ends it for good
        return out


def push(buffer: np.ndarray, count: int, value: float) -> np.ndarray:
    """A fixed window, oldest first: `value` fills the next slot, or replaces the oldest."""
    out = buffer.copy()
    if count < len(out):
        out[count] = value
    else:
        out[:-1], out[-1] = out[1:], value
    return out


def parkinson(high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """Parkinson volatility of one window, as a log return: ln(H / L) / (2 sqrt(ln 2))."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.log(high / low) / (2.0 * math.sqrt(math.log(2.0)))


def garman_klass(open_, high, low, close) -> np.ndarray:
    """Garman-Klass volatility of one window, as a log return:
    sqrt(0.5 ln(H / L)^2 - (2 ln 2 - 1) ln(C / O)^2). Never negative: |ln(C / O)| <= ln(H / L)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        hl, co = np.log(high / low), np.log(close / open_)
        return np.sqrt(np.maximum(0.5 * hl * hl - (2.0 * math.log(2.0) - 1.0) * co * co, 0.0))
