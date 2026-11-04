"""Stage `stats_1h_1m` (tier 1): statistics of the rolling `1h@1m` window that are not window
sums of second statistics (docs/project/plan-1h-and-pivots.md, section 5.4), one row per
scheduled-open minute, next to `candle_1h_1m`'s row for the same window.

It reads the minute rows (`bar_1m`) and, through a declared same-tier edge, the hourly candle
(`candle_1h_1m`): its status, which every feature requires to be complete, its ATR, which
normalizes price distances, and its window's exact drawdown and drawup. Like every window, the
one ending at minute `m` holds minute rows `m - 59 ... m` and depends on nothing older, except the
session values below.

- **Realized volatility** from one-second returns: the square root of the sum of squared log
  returns between consecutive observed one-second closes in the window. Each minute stores the
  sum inside it (`ret2_sum`); the window adds the bridge from the previous observed minute's
  close to each minute's first observed close, excluding the bridge into the window's first
  observed minute, as the price-path bridges do. `rv_atr` compares it with the hourly ATR:
  volatility measured second by second against volatility measured in ranges.
- **Minute returns**: log changes of the minute closes, carried through minutes without trades,
  from the window's first observed minute on (59 returns when the oldest minute traded; the
  window never reaches back past its own rows). Their standard deviation, skew, lag-1
  autocorrelation, Lo-MacKinlay variance ratio VR(5) (above 1 trending, below 1 mean-reverting),
  and the share of rising minutes among those that moved. They need `MIN_RETURNS` returns:
  VR(5) compares two whole 5-minute horizons at least.
- **Path**: the largest drop and rise along the window's trades (the candle window's exact path
  fields) in ATRs, and where the window's first trade at its high and at its low fell, 0 in its
  oldest second and 1 in its newest (the minute row of the extreme, then the second of its
  trade inside that minute: rows, never clock time).
- **Levels**: the close against the session's VWAP and against the previous session's high,
  low, and close, in ATRs. A session is the calendar's scheduled-open interval (as for the
  session CVD); its values are undefined after missing data in it or when the stage did not
  see it from its open, and the previous session's only when it is the interval just before.
- **Flow**: the correlation of the minute closes with the window's cumulative buy - sell volume.

Every float is computed window by window in one fixed order (`window_stats`), so any chunking
gives identical bits. The window's previous 59 minutes and the session values carry between
calls and checkpoints.
"""

from typing import Any

import numpy as np
from numba import njit

from . import warmup
from .bars import MISSING, OBSERVED, BaseBars
from .columns import BIGINT, DOUBLE, SMALLINT, Column, Table
from .engine import MarketChunk
from .features import Unit  # unit labels of the registry; they do not change stored values
from .market import MINUTE, PX, SECOND, SessionCalendar
from .stage_bar_1m import empty_table
from .stages import Stage
from .windows import BIAS, COMPLETE

PRICE = "Databento fixed-point price (1e-9)"
WIDTH = BIAS.slots  # minutes per window
SECONDS = MINUTE // SECOND  # seconds per minute
WINDOW_SECONDS = WIDTH * SECONDS
VR_PERIOD = 5  # minutes per horizon of the variance ratio
MIN_RETURNS = 2 * VR_PERIOD  # minute returns the return statistics need
DAY_SECONDS = 86_400  # no exchange session is longer: one whole previous session fits in it
BIG = np.iinfo(np.int64).max

FEATURES: tuple[tuple[str, Unit, str], ...] = (
    (
        "rv_bps",
        Unit.BPS,
        "Realized volatility: square root of the sum of squared log returns between "
        "consecutive observed one-second closes in the window",
    ),
    ("rv_atr", Unit.ATR, "Realized volatility / hourly ATR, both relative to the close"),
    (
        "ret_std_bps",
        Unit.BPS,
        "Population standard deviation of the window's minute log returns (closes carried "
        "through minutes without trades)",
    ),
    ("ret_skew", Unit.RATIO, "Skewness of the window's minute returns"),
    ("ret_autocorr", Unit.RATIO, "Lag-1 autocorrelation of the window's minute returns"),
    (
        "vr_5",
        Unit.RATIO,
        "Lo-MacKinlay variance ratio of overlapping 5-minute to 1-minute returns: above 1 "
        "trending, below 1 mean-reverting",
    ),
    ("up_minute_ratio", Unit.RATIO, "Minutes whose close rose / minutes whose close changed"),
    ("drawdown_atr", Unit.ATR, "Largest drop from a trade to a later trade in the window, in ATRs"),
    ("drawup_atr", Unit.ATR, "Largest rise from a trade to a later trade in the window, in ATRs"),
    (
        "high_pos",
        Unit.RATIO,
        "Where the window's first trade at its high fell: 0 in its oldest second, 1 in its newest",
    ),
    (
        "low_pos",
        Unit.RATIO,
        "Where the window's first trade at its low fell: 0 in its oldest second, 1 in its newest",
    ),
    ("session_vwap_atr", Unit.ATR, "Close - VWAP of the session so far, in ATRs"),
    ("prior_high_atr", Unit.ATR, "Close - previous session's high, in ATRs"),
    ("prior_low_atr", Unit.ATR, "Close - previous session's low, in ATRs"),
    ("prior_close_atr", Unit.ATR, "Close - previous session's last trade price, in ATRs"),
    (
        "cvd_close_corr",
        Unit.RATIO,
        "Correlation of the minute closes with the cumulative buy - sell volume of the window's "
        "minutes",
    ),
)
COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter of the newest minute in the window"),
    Column("end_ns", BIGINT, "Window end, UTC ns"),
    Column("status", SMALLINT, "As candle_1h_1m: 0 complete, 1 empty, 2 gap, 3 warmup"),
    Column(
        "rv_returns",
        SMALLINT,
        "One-second returns in rv_bps (pairs of consecutive observed second closes)",
    ),
    Column("minute_returns", SMALLINT, "Minute returns in the return statistics"),
    Column(
        "session_vwap",
        DOUBLE,
        "VWAP of the session's trades through this minute (quoted units); NULL after missing data",
    ),
    Column("prior_high", BIGINT, f"Highest trade price of the previous session, {PRICE}"),
    Column("prior_low", BIGINT, f"Lowest trade price of the previous session, {PRICE}"),
    Column("prior_close", BIGINT, f"Last trade price of the previous session, {PRICE}"),
    *(Column(n, DOUBLE, d, u.value) for n, u, d in FEATURES),
)
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
ALWAYS = frozenset({"slot_ordinal", "end_ns", "status"})  # never NULL
NULLABLE = tuple(c.name for c in COLUMNS if c.name not in ALWAYS)
TAIL = {  # per-minute inputs the window keeps for its next 59 rows
    "status": np.int8,
    "close": np.int64,
    "high": np.int64,
    "low": np.int64,
    "high_at": np.int64,
    "low_at": np.int64,
    "end": np.int64,
    "first_close": np.int64,
    "ret2": np.float64,
    "ret_n": np.int64,
    "net": np.int64,
}


@njit(cache=True)
def window_stats(
    status, close, high, low, high_at, low_at, end, first_close, ret2, ret_n, net, first_row,
    width, period, min_returns, rv2, rv_n, n_ret, std, skew, autocorr, vr, up, corr, high_pos,
    low_pos, last_close,
):  # fmt: skip
    """Statistics of the windows ending at rows `first_row ...`, each over its `width` rows,
    oldest to newest. Only observed rows hold prices; returns start at the window's first
    observed row. NaN where undefined."""
    rets = np.empty(width)
    xs = np.empty(width)
    ys = np.empty(width)
    last_index = width * (MINUTE // SECOND) - 1
    for i in range(rv2.shape[0]):
        r = first_row + i
        lo = r - width + 1
        s2 = 0.0
        cnt = 0
        k = 0  # minute returns
        npts = 0  # minutes with a known close, for the correlation
        prev = 0  # latest observed close in the window (fixed point), 0 before the first
        first_px = 0
        cum = 0
        ups = 0
        downs = 0
        top = -BIG
        bottom = BIG
        hi_j = -1
        lo_j = -1
        for j in range(lo, r + 1):
            cum += net[j]
            before = prev
            if status[j] == OBSERVED:
                if before > 0 and first_close[j] > 0:  # the bridge from the previous minute
                    b = np.log(first_close[j] / before)
                    s2 += b * b
                    cnt += 1
                s2 += ret2[j]
                cnt += ret_n[j]
                if high[j] > top:  # strictly higher: the first minute at the high
                    top = high[j]
                    hi_j = j
                if low[j] < bottom:
                    bottom = low[j]
                    lo_j = j
                prev = close[j]
                if first_px == 0:
                    first_px = prev
            if before > 0 and prev > 0:
                x = np.log(prev / before)
                rets[k] = x
                k += 1
                if x > 0.0:
                    ups += 1
                elif x < 0.0:
                    downs += 1
            if prev > 0:
                xs[npts] = prev - first_px  # shifts change no correlation
                ys[npts] = cum
                npts += 1
        rv2[i] = s2
        rv_n[i] = cnt
        n_ret[i] = k
        last_close[i] = prev
        std[i] = skew[i] = autocorr[i] = vr[i] = up[i] = corr[i] = np.nan
        high_pos[i] = low_pos[i] = np.nan
        if hi_j >= 0:
            s = (high_at[hi_j] - (end[hi_j] - MINUTE)) // SECOND
            high_pos[i] = ((hi_j - lo) * (MINUTE // SECOND) + s) / last_index
            s = (low_at[lo_j] - (end[lo_j] - MINUTE)) // SECOND
            low_pos[i] = ((lo_j - lo) * (MINUTE // SECOND) + s) / last_index
        if k >= min_returns:
            total = 0.0
            for t in range(k):
                total += rets[t]
            mean = total / k
            d2 = 0.0
            d3 = 0.0
            ac = 0.0
            for t in range(k):
                d = rets[t] - mean
                d2 += d * d
                d3 += d * d * d
                if t > 0:
                    ac += d * (rets[t - 1] - mean)
            var = d2 / k
            std[i] = np.sqrt(var)
            if d2 > 0.0:
                skew[i] = (d3 / k) / var**1.5
                autocorr[i] = ac / d2
                c2 = 0.0  # overlapping sums of `period` returns, less their expected drift
                for t in range(period - 1, k):
                    q = 0.0
                    for u in range(t - period + 1, t + 1):
                        q += rets[u]
                    dev = q - period * mean
                    c2 += dev * dev
                m = period * (k - period + 1) * (1.0 - period / k)
                vr[i] = (c2 / m) / (d2 / (k - 1))
            if ups + downs > 0:
                up[i] = ups / (ups + downs)
        if npts >= min_returns + 1:
            mx = 0.0
            my = 0.0
            for t in range(npts):
                mx += xs[t]
                my += ys[t]
            mx /= npts
            my /= npts
            sxx = 0.0
            syy = 0.0
            sxy = 0.0
            for t in range(npts):
                dx = xs[t] - mx
                dy = ys[t] - my
                sxx += dx * dx
                syy += dy * dy
                sxy += dx * dy
            if sxx > 0.0 and syy > 0.0:
                corr[i] = min(max(sxy / np.sqrt(sxx * syy), -1.0), 1.0)


class SessionLevels:
    """Per minute, from its session's open: the VWAP so far, and the previous session's high,
    low, and close. A session is the calendar's scheduled-open interval holding the minute. Its
    values are known only when the stage saw it from its open and no data was missing in it
    (`ok`, the minute row's session CVD being defined); the previous session counts only when
    it is the interval just before."""

    STATE = (
        "interval",
        "pv",
        "volume",
        "high",
        "low",
        "close",
        "complete",
        "prior_interval",
        "prior_high",
        "prior_low",
        "prior_close",
        "prior_complete",
    )

    def __init__(self, calendar: SessionCalendar):
        self.calendar = calendar
        self.interval, self.pv, self.volume, self.complete = -1, 0.0, 0, False
        self.high, self.low, self.close = 0, 0, 0
        self.prior_interval, self.prior_complete = -1, False
        self.prior_high, self.prior_low, self.prior_close = 0, 0, 0

    def update(self, minutes: BaseBars, ok: np.ndarray) -> dict[str, np.ndarray]:
        m, cal = len(minutes), self.calendar
        iv = np.searchsorted(cal.opens, minutes.end - MINUTE, side="right") - 1
        out = {
            "vwap": np.full(m, np.nan),
            "prior": np.zeros(m, bool),
            "prior_high": np.zeros(m, np.int64),
            "prior_low": np.zeros(m, np.int64),
            "prior_close": np.zeros(m, np.int64),
        }
        if m == 0:
            return out
        cuts = np.flatnonzero(np.r_[True, iv[1:] != iv[:-1]])
        for a, b in zip(cuts, np.r_[cuts[1:], m], strict=True):
            if iv[a] != self.interval:
                if self.interval >= 0:  # the finished session becomes the previous one
                    self.prior_interval = self.interval
                    self.prior_high, self.prior_low = self.high, self.low
                    self.prior_close = self.close
                    self.prior_complete = self.complete and self.close > 0
                self.interval, self.pv, self.volume = int(iv[a]), 0.0, 0
                self.high, self.low, self.close = 0, 0, 0
                # seen from its open: the first minute starts at the interval's open
                self.complete = bool(minutes.end[a] - MINUTE == cal.opens[iv[a]])
            g = slice(a, b)
            pv = np.cumsum(np.r_[self.pv, minutes.pv[g]])[1:]  # added in order, as one series
            volume = self.volume + np.cumsum(minutes.volume[g])
            good = self.complete & ok[g] & (volume > 0)
            with np.errstate(divide="ignore", invalid="ignore"):
                out["vwap"][g] = np.where(good, pv / volume, np.nan)
            if self.prior_complete and self.prior_interval == iv[a] - 1:
                out["prior"][g] = True
                out["prior_high"][g] = self.prior_high
                out["prior_low"][g] = self.prior_low
                out["prior_close"][g] = self.prior_close
            obs = minutes.status[g] == OBSERVED
            if obs.any():
                high, low = minutes.high[g][obs].max(), minutes.low[g][obs].min()
                self.high = int(high) if self.close == 0 else max(self.high, int(high))
                self.low = int(low) if self.close == 0 else min(self.low, int(low))
                self.close = int(minutes.close[g][obs][-1])
            self.pv, self.volume = float(pv[-1]), int(volume[-1])
            self.complete = self.complete and bool(ok[b - 1])  # missing data ends it for good
        return out


class HourStatsStage(Stage):
    NAME = "stats_1h_1m"
    TIER = 1
    RESOLUTION = "1m"
    INPUTS = ("bar_1m", "candle_1h_1m")
    MODULES = (
        "stages",
        "columns",
        "stage_stats_1h_1m",
        "stage_bar_1m",
        "bars",
        "market",
        "windows",
        "warmup",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("tail", "session")

    def __init__(self, context):
        super().__init__(context)
        self.tail = {k: np.zeros(0, t) for k, t in TAIL.items()}
        self.session = SessionLevels(context.calendar)

    def settings(self) -> dict[str, Any]:
        return {"window": BIAS.name, "vr_period": VR_PERIOD, "min_returns": MIN_RETURNS}

    def warmup(self) -> int:
        """The hourly ATR that normalizes price distances (Wilder, in hourly periods), and one
        whole previous session; the window's own values need only its 60 minutes."""
        atr = warmup.wilder(self.context.features.atr_period)
        return max(atr * WINDOW_SECONDS, DAY_SECONDS)

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        minutes = products["minutes"]
        if not len(minutes):  # most one-second chunks finish no minute; nothing changes
            return empty_table(COLUMNS, NULLABLE)
        base, candle = products["tables"]["bar_1m"], products["tables"]["candle_1h_1m"]
        if not (
            np.array_equal(base.values["end_ns"], minutes.end)
            and np.array_equal(candle.values["end_ns"], minutes.end)
        ):
            raise AssertionError("stats_1h_1m rows must align with bar_1m and candle_1h_1m")
        b = base.values
        cur = {
            "status": minutes.status.astype(np.int8),
            "close": minutes.close,
            "high": minutes.high,
            "low": minutes.low,
            "high_at": minutes.high_at,
            "low_at": minutes.low_at,
            "end": minutes.end,
            "first_close": b["first_close"].astype(np.int64),
            "ret2": b["ret2_sum"].astype(np.float64),
            "ret_n": b["ret_count"].astype(np.int64),
            "net": (minutes.buy - minutes.sell).astype(np.int64),
        }
        m = len(minutes)
        pad = WIDTH - 1 - len(self.tail["status"])
        x = {
            k: np.r_[np.full(pad, MISSING if k == "status" else 0, t), self.tail[k], cur[k]]
            for k, t in TAIL.items()
        }
        total = len(x["status"])
        out = {
            k: np.empty(m, np.float64)
            for k in ("rv2", "std", "skew", "autocorr", "vr", "up", "corr", "high_pos", "low_pos")
        }
        counts = {k: np.empty(m, np.int64) for k in ("rv_n", "n_ret", "last_close")}
        window_stats(
            x["status"], x["close"], x["high"], x["low"], x["high_at"], x["low_at"], x["end"],
            x["first_close"], x["ret2"], x["ret_n"], x["net"], total - m, WIDTH, VR_PERIOD,
            MIN_RETURNS, out["rv2"], counts["rv_n"], counts["n_ret"], out["std"], out["skew"],
            out["autocorr"], out["vr"], out["up"], out["corr"], out["high_pos"], out["low_pos"],
            counts["last_close"],
        )  # fmt: skip
        self.tail = {k: v[total - (WIDTH - 1) :].copy() for k, v in x.items()}
        levels = self.session.update(minutes, ~base.nulls["session_cvd"])
        return self.table(minutes, candle, products["hour_window"], out, counts, levels)

    @staticmethod
    def table(minutes, candle, window, out, counts, levels) -> Table:
        status = candle.values["status"]
        complete = status == COMPLETE
        atr = candle.values["atr_bps"]
        atr = np.where(~candle.nulls["atr_bps"] & (atr > 0), atr, np.nan)
        close = counts["last_close"].astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            px = np.where(complete & (close > 0), close, np.nan)  # the current price

            def in_atr(distance):  # a fixed-point price distance, in ATRs
                return distance / px * 1e4 / atr

            rv = np.where(counts["rv_n"] > 0, np.sqrt(out["rv2"]) * 1e4, np.nan)
            features = {
                "rv_bps": rv,
                "rv_atr": rv / atr,
                "ret_std_bps": out["std"] * 1e4,
                "ret_skew": out["skew"],
                "ret_autocorr": out["autocorr"],
                "vr_5": out["vr"],
                "up_minute_ratio": out["up"],
                "drawdown_atr": in_atr(window["drawdown"].astype(np.float64)),
                "drawup_atr": in_atr(window["drawup"].astype(np.float64)),
                "high_pos": out["high_pos"],
                "low_pos": out["low_pos"],
                "session_vwap_atr": in_atr(px - levels["vwap"] * PX),
                "prior_high_atr": in_atr(
                    np.where(levels["prior"], px - levels["prior_high"], np.nan)
                ),
                "prior_low_atr": in_atr(
                    np.where(levels["prior"], px - levels["prior_low"], np.nan)
                ),
                "prior_close_atr": in_atr(
                    np.where(levels["prior"], px - levels["prior_close"], np.nan)
                ),
                "cvd_close_corr": out["corr"],
            }
        v = {
            "slot_ordinal": candle.values["slot_ordinal"],
            "end_ns": minutes.end,
            "status": status.astype(np.int16),
            "rv_returns": counts["rv_n"],
            "minute_returns": counts["n_ret"],
            "session_vwap": np.where(np.isfinite(levels["vwap"]), levels["vwap"], 0.0),
            "prior_high": levels["prior_high"],
            "prior_low": levels["prior_low"],
            "prior_close": levels["prior_close"],
        }
        nulls = {
            "rv_returns": ~complete,
            "minute_returns": ~complete,
            "session_vwap": ~np.isfinite(levels["vwap"]),
            "prior_high": ~levels["prior"],
            "prior_low": ~levels["prior"],
            "prior_close": ~levels["prior"],
        }
        for name, values in features.items():
            values = np.where(complete, values, np.nan)
            nulls[name] = ~np.isfinite(values)
            v[name] = np.where(nulls[name], 0.0, values)
        return Table(v, {k: nulls[k] for k in NULLABLE})
