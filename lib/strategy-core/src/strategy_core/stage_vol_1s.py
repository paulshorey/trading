"""Stage `vol_1s` (tier 1): the volatility family of the rolling `1m@1s` window
(docs/project/plan-1h-and-pivots.md, section 7), one row per scheduled-open second, next to
`candle_1m_1s`'s row for the same window. It is the second-resolution half of `vol_1m`: the same
calculations (`volatility.py`), the same feature names, and one more, realized volatility.

It reads the second rows (`bar_1s`) and, through a declared same-tier edge, the `1m@1s` candle
(`candle_1m_1s`): its windows (`candles`) and their exact path fields (`window`), and its stored
ATR(14) (`atr_bps`), which this stage never stores again. Values are per phase `o % 60` on
same-phase windows 60 rows apart, like the ATR, and normalized (`features.Unit`):

- **Horizons**: ATR(5) and ATR(50) in bps, and log ratios against ATR(14): above 0 when the shorter
  horizon's volatility is larger (expanding).
- **Bullish and bearish ATR**: Wilder averages of twice the decline and twice the rise from `P0`
  (the previous same-phase close, or the window's first trade without one), with the ATR's inputs,
  seeding, and resets, so their mean equals `atr_bps` to rounding; and their skew.
- **Adverse excursion**: Wilder averages of the deepest drop a long and the highest rise a short
  sat through from `P0`, and the current window's excursions in ATRs.
- **The window's extremes as levels**: the close's distance to the window's high and low in ATRs,
  their ages in scheduled-open seconds counted in rows (from the second of the window's first trade
  at the extreme to its newest second, 0-59), and which came first.
- **Time-of-day normal**: ATR(14) against the mean of its samples at the same session minute (the
  minute's offset from the session's open) in the previous `TOD_SESSIONS` sessions. One sample per
  minute: the ATR at ordinal `60 m`, the window that is exactly minute `m`; every second of the
  minute compares its own phase's ATR with that minute's samples from earlier sessions.
- **Daily scale**: as `vol_1m` (the same daily ATR, percentile, and session levels, from second
  rows): the daily ATR, the session's true range so far as a share of it, the close's distances to
  the session's high and low in daily ATRs, and the daily ATR's percentile.
- **The current window**: its true range, Parkinson and Garman-Klass volatility, the mean quoted
  spread against ATR(14), and realized volatility from its one-second returns (between consecutive
  observed second closes inside the window), in bps and against ATR(14): noise against range.

Averages, like the ATR, are defined for complete windows and for empty ones with a carried price;
values of the current window and of the session so far need the window's trades (complete). The
daily ATR and its percentile belong to the session and are defined at every row of it. ATR in price
units and in dollars per contract are context for stops and sizing, never features.

Every float is computed in one fixed order (numba loops per row and window, oldest first), so any
chunking gives identical bits. The window's previous 59 seconds carry between calls and checkpoints.
"""

from typing import Any

import numpy as np
from numba import njit

from . import kernels, warmup
from .bars import MISSING, OBSERVED
from .columns import BIGINT, DOUBLE, SMALLINT, Column, Table
from .engine import MarketChunk
from .features import Unit  # unit labels of the registry; they do not change stored values
from .market import MINUTE, PRODUCTS, PX, SECOND
from .stages import Stage
from .volatility import DailyScale, TimeOfDay, garman_klass, parkinson, session_minute, split_atr
from .windows import COMPLETE, FAST

WIDTH = FAST.slots  # seconds per window, and same-phase windows per minute
PERIOD_SECONDS = FAST.period // SECOND  # scheduled-open seconds per same-phase period
DAY_SECONDS = 86_400  # no exchange session is longer: a chain of whole sessions fits in this

FEATURES: tuple[tuple[str, Unit, str], ...] = (
    ("atr5_bps", Unit.BPS, "Wilder ATR(5) of same-phase windows, relative to the close"),
    ("atr50_bps", Unit.BPS, "Wilder ATR(50) of same-phase windows, relative to the close"),
    (
        "atr_5_14_log",
        Unit.LOG_RATIO,
        "log(ATR(5) / ATR(14)), ATR(14) being candle_1m_1s.atr_bps: above 0 when expanding",
    ),
    ("atr_14_50_log", Unit.LOG_RATIO, "log(ATR(14) / ATR(50)): above 0 when expanding"),
    (
        "bull_atr_bps",
        Unit.BPS,
        "Bullish ATR: Wilder(14) of 2 x the decline from P0 (the previous same-phase close), "
        "relative to the close; volatility as a long feels it",
    ),
    (
        "bear_atr_bps",
        Unit.BPS,
        "Bearish ATR: Wilder(14) of 2 x the rise from P0, relative to the close; (bull + bear) / 2 "
        "is atr_bps",
    ),
    ("bull_bear_skew", Unit.RATIO, "(Bullish - bearish ATR) / their sum, -1..1"),
    (
        "long_adverse_atr_bps",
        Unit.BPS,
        "Wilder(14) of the long adverse excursion max(drawdown, P0 - low), relative to the close",
    ),
    (
        "short_adverse_atr_bps",
        Unit.BPS,
        "Wilder(14) of the short adverse excursion max(drawup, high - P0), relative to the close",
    ),
    ("long_excursion_atr", Unit.ATR, "This window's long adverse excursion, in ATRs"),
    ("short_excursion_atr", Unit.ATR, "This window's short adverse excursion, in ATRs"),
    ("high_dist_atr", Unit.ATR, "Window high - close, in ATRs"),
    ("low_dist_atr", Unit.ATR, "Close - window low, in ATRs"),
    (
        "high_age_s",
        Unit.SECONDS,
        "Scheduled-open seconds (rows) from the window's first trade at its high to its newest "
        "second",
    ),
    (
        "low_age_s",
        Unit.SECONDS,
        "Scheduled-open seconds (rows) from the window's first trade at its low to its newest "
        "second",
    ),
    (
        "extreme_order",
        Unit.RATIO,
        "1 when the window's low came before its high, -1 when the high came first, 0 the same "
        "trade",
    ),
    (
        "atr_tod_log",
        Unit.LOG_RATIO,
        "log(ATR(14) / mean ATR(14) at the end of the same session minute in the previous 20 "
        "sessions)",
    ),
    (
        "day_atr_bps",
        Unit.BPS,
        "Daily ATR: mean true range of the previous 14 complete sessions (from each one's "
        "previous close), each relative to its close",
    ),
    (
        "day_range_ratio",
        Unit.RATIO,
        "The session's true range so far (from the previous session's close) / daily ATR",
    ),
    ("day_high_dist", Unit.ATR, "Session high so far - close, in daily ATRs"),
    ("day_low_dist", Unit.ATR, "Close - session low so far, in daily ATRs"),
    (
        "day_atr_pct",
        Unit.RATIO,
        "Percentile of the daily ATR among its previous 20 values, 0..1 (ties count half)",
    ),
    ("tr_atr", Unit.ATR, "This window's true range (from P0) / ATR(14)"),
    (
        "parkinson_bps",
        Unit.BPS,
        "Parkinson volatility of the window: ln(high / low) / (2 sqrt(ln 2))",
    ),
    (
        "gk_bps",
        Unit.BPS,
        "Garman-Klass volatility of the window from its high, low, first, and last trade",
    ),
    ("spread_atr", Unit.ATR, "Mean quoted spread at trades / ATR(14)"),
    (
        "rv_bps",
        Unit.BPS,
        "Realized volatility: square root of the sum of squared log returns between "
        "consecutive observed one-second closes in the window",
    ),
    ("rv_atr", Unit.ATR, "Realized volatility / ATR(14), both relative to the close"),
)
COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter of the newest second in the window"),
    Column("end_ns", BIGINT, "Window end, UTC ns"),
    Column("status", SMALLINT, "As candle_1m_1s: 0 complete, 1 empty, 2 gap, 3 warmup"),
    Column("atr_price", DOUBLE, "ATR(14) in quoted price units, for stops; never a model input"),
    Column(
        "atr_usd",
        DOUBLE,
        "ATR(14) in US dollars per contract (tick value / tick size), for sizing; never a model "
        "input",
    ),
    Column(
        "rv_returns",
        SMALLINT,
        "One-second returns in rv_bps (pairs of consecutive observed second closes)",
    ),
    *(Column(n, DOUBLE, d, u.value) for n, u, d in FEATURES),
)
FEATURE_COLUMNS = tuple(c.name for c in COLUMNS if c.unit)
ALWAYS = frozenset({"slot_ordinal", "end_ns", "status"})  # never NULL
NULLABLE = tuple(c.name for c in COLUMNS if c.name not in ALWAYS)
SESSION = frozenset({"day_atr_bps", "day_atr_pct"})  # the session's, at every row of it
AVERAGES = frozenset(  # like the ATR: complete windows and empty ones with a carried price
    {
        "atr5_bps",
        "atr50_bps",
        "atr_5_14_log",
        "atr_14_50_log",
        "bull_atr_bps",
        "bear_atr_bps",
        "bull_bear_skew",
        "long_adverse_atr_bps",
        "short_adverse_atr_bps",
        "atr_tod_log",
    }
)
TAIL = {"status": np.int8, "close": np.int64}  # per-second inputs the window keeps for 59 rows


@njit(cache=True)
def window_rv(status, close, first_row, width, rv2, count):
    """Sum of squared log returns between consecutive observed closes inside each window ending at
    rows `first_row ...` (`width` rows each), oldest first, and their count. A return pairs a row
    with the previous observed row (none across missing data); it belongs to a window only when
    both rows do, so the return into the window's first observed second is left out."""
    n = status.shape[0]
    ret2 = np.zeros(n)
    back = np.full(n, -1, np.int64)
    prev = -1
    for j in range(n):
        if status[j] == MISSING:
            prev = -1
        elif status[j] == OBSERVED:
            if prev >= 0:
                x = np.log(close[j] / close[prev])
                ret2[j] = x * x
                back[j] = prev
            prev = j
    for i in range(rv2.shape[0]):
        r = first_row + i
        lo = r - width + 1
        s = 0.0
        k = 0
        for j in range(lo, r + 1):
            if back[j] >= lo:
                s += ret2[j]
                k += 1
        rv2[i] = s
        count[i] = k


def usd_per_price(contract: str) -> float:
    """US dollars per quoted price unit and contract of the contract's product (NaN unknown)."""
    for product in PRODUCTS.values():
        if product.is_outright(contract):
            return product.tick_value * PX / product.tick_size
    return float("nan")


def empty_table() -> Table:
    """A table without rows, for chunks without scheduled-open seconds."""
    dtypes = {DOUBLE: np.float64, SMALLINT: np.int16}
    values = {c.name: np.zeros(0, dtypes.get(c.sql, np.int64)) for c in COLUMNS}
    return Table(values, {name: np.zeros(0, bool) for name in NULLABLE})


class VolSecondStage(Stage):
    NAME = "vol_1s"
    TIER = 1
    RESOLUTION = "1s"
    INPUTS = ("bar_1s", "candle_1m_1s")
    MODULES = (
        "stages",
        "columns",
        "stage_vol_1s",
        "volatility",
        "bars",
        "kernels",
        "market",
        "windows",
        "warmup",
        "state",
    )
    COLUMNS = COLUMNS
    STATE = ("atr", "atr5", "atr50", "split", "tod", "daily", "tail")
    SHORT, LONG = 5, 50  # ATR horizons next to the configured ATR(14)
    TOD_SESSIONS = 20  # sessions in the time-of-day normal
    DAY_PERIOD, DAY_RANK = 14, 20  # sessions in the daily ATR, and daily ATRs in its percentile

    def __init__(self, context):
        super().__init__(context)
        p = WIDTH

        def atr():
            return kernels.PhaseState(p, prev="nan", atr="zero", count="count")

        self.atr, self.atr5, self.atr50 = atr(), atr(), atr()
        self.split = kernels.PhaseState(
            p, prev="nan", bull="zero", bear="zero", long="zero", short="zero", count="count"
        )
        self.tod = TimeOfDay(self.TOD_SESSIONS)
        self.daily = DailyScale(context.calendar, SECOND, self.DAY_PERIOD, self.DAY_RANK)
        self.tail = {k: np.zeros(0, t) for k, t in TAIL.items()}

    def settings(self) -> dict[str, Any]:
        return {
            "window": FAST.name,
            "atr_period": self.context.features.atr_period,
            "atr_short": self.SHORT,
            "atr_long": self.LONG,
            "tod_sessions": self.TOD_SESSIONS,
            "day_period": self.DAY_PERIOD,
            "day_rank": self.DAY_RANK,
        }

    def warmup(self) -> int:
        """The longest chain, in scheduled-open seconds: the `1m@1s` ATR(50) (Wilder, in minute
        periods of one phase); the time-of-day normal, `TOD_SESSIONS` sessions of settled ATR(14)
        samples; and the daily percentile, `DAY_PERIOD + 1` sessions for the daily ATR (each true
        range needs the previous close), then `DAY_RANK` daily ATRs. Session chains count whole
        days."""
        atr = warmup.wilder(self.context.features.atr_period)  # also the split and adverse ATRs
        periods = max(atr, warmup.wilder(self.SHORT), warmup.wilder(self.LONG)) * PERIOD_SECONDS
        tod = atr * PERIOD_SECONDS + warmup.window(self.TOD_SESSIONS) * DAY_SECONDS
        daily = (warmup.window(self.DAY_PERIOD) + 1 + warmup.window(self.DAY_RANK)) * DAY_SECONDS
        return max(periods, tod, daily)

    def process(self, chunk: MarketChunk, products: dict[str, Any]) -> Table:
        bars = products["bars"]
        if not len(bars):
            return empty_table()
        base, candle = products["tables"]["bar_1s"], products["tables"]["candle_1m_1s"]
        if not (
            np.array_equal(base.values["end_ns"], bars.end)
            and np.array_equal(candle.values["end_ns"], bars.end)
        ):
            raise AssertionError("vol_1s rows must align with bar_1s and candle_1m_1s")
        c, win = products["candles"], products["window"]
        m, cfg = len(c), self.context.features
        complete = c.status == COMPLETE
        priced = complete | c.carried  # the ATR's inputs
        o, h, lo, cl = (np.where(priced, x, 0.0) for x in c.analysis())
        phase = c.phase.astype(np.int64)

        def wilder_atr(state, period):
            out = np.empty(m)
            kernels.wilder_atr(
                h, lo, cl, priced, phase, period, state.prev, state.atr, state.count, out
            )
            return out

        atr = wilder_atr(self.atr, cfg.atr_period)  # the candle's ATR(14), in price units
        atr5, atr50 = wilder_atr(self.atr5, self.SHORT), wilder_atr(self.atr50, self.LONG)
        s = self.split
        k = {
            name: np.empty(m)
            for name in ("tr", "p0", "bull", "bear", "long", "short", "long_exc", "short_exc")
        }
        down = np.where(complete, win["drawdown"] / PX, 0.0)  # 0 for an empty window: no move
        up = np.where(complete, win["drawup"] / PX, 0.0)
        split_atr(
            o, h, lo, cl, down, up, priced, phase, cfg.atr_period, s.prev, s.bull, s.bear, s.long,
            s.short, s.count, k["tr"], k["p0"], k["bull"], k["bear"], k["long"], k["short"],
            k["long_exc"], k["short_exc"],
        )  # fmt: skip
        atr_bps = candle.values["atr_bps"]
        atr_bps = np.where(~candle.nulls["atr_bps"] & (atr_bps > 0), atr_bps, np.nan)
        key = session_minute(self.context.calendar, bars.end, SECOND)
        sample = (c.ordinal % (MINUTE // SECOND) == 0) & np.isfinite(atr_bps)  # ordinal 60 m
        normal = self.tod.update(key, atr_bps, sample)
        day = self.daily.update(bars.end, bars.status, bars.high, bars.low, bars.close)
        rv2, rv_n = self.realized(bars)
        ages = self.ages(c, complete)
        close_fixed = candle.values["close"].astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            px = np.where(priced, cl, np.nan)  # the current price (quoted), as the ATR's

            def bps(x):  # a quoted price distance or average, relative to the current price
                return x / px * 1e4

            def in_atr(x):
                return bps(x) / atr_bps

            bull, bear = bps(k["bull"]), bps(k["bear"])
            pxf = np.where(complete & (close_fixed > 0), close_fixed, np.nan)  # fixed point
            day_atr = day["day_atr_bps"]
            ok = day["ok"]
            sh, sl, pc = (day[n].astype(np.float64) for n in ("high", "low", "prior_close"))
            session_tr = np.where(
                ok & day["prior"], np.maximum(sh, pc) - np.minimum(sl, pc), np.nan
            )

            def in_day(x):  # a fixed-point distance from the current price, in daily ATRs
                return x / pxf * 1e4 / day_atr

            rv = np.where(rv_n > 0, np.sqrt(rv2) * 1e4, np.nan)
            features = {
                "atr5_bps": bps(atr5),
                "atr50_bps": bps(atr50),
                "atr_5_14_log": np.log(bps(atr5) / atr_bps),
                "atr_14_50_log": np.log(atr_bps / bps(atr50)),
                "bull_atr_bps": bull,
                "bear_atr_bps": bear,
                "bull_bear_skew": np.where(bull + bear > 0, (bull - bear) / (bull + bear), np.nan),
                "long_adverse_atr_bps": bps(k["long"]),
                "short_adverse_atr_bps": bps(k["short"]),
                "long_excursion_atr": in_atr(k["long_exc"]),
                "short_excursion_atr": in_atr(k["short_exc"]),
                "high_dist_atr": in_atr(c.high - c.close),
                "low_dist_atr": in_atr(c.close - c.low),
                "high_age_s": ages["high"],
                "low_age_s": ages["low"],
                "extreme_order": win["extreme_order"].astype(np.float64),
                "atr_tod_log": np.log(atr_bps / normal),
                "day_atr_bps": day_atr,
                "day_range_ratio": in_day(session_tr),
                "day_high_dist": in_day(np.where(ok, sh - pxf, np.nan)),
                "day_low_dist": in_day(np.where(ok, pxf - sl, np.nan)),
                "day_atr_pct": day["day_pct"],
                "tr_atr": in_atr(k["tr"]),
                "parkinson_bps": parkinson(c.high, c.low) * 1e4,
                "gk_bps": garman_klass(c.open, c.high, c.low, c.close) * 1e4,
                "spread_atr": candle.values["spread_bps"] / atr_bps,
                "rv_bps": rv,
                "rv_atr": rv / atr_bps,
            }
            usd = usd_per_price(chunk.contract)
            context = {"atr_price": np.where(priced, atr, np.nan)}
            context["atr_usd"] = context["atr_price"] * usd
        v: dict[str, np.ndarray] = {
            "slot_ordinal": candle.values["slot_ordinal"],
            "end_ns": bars.end,
            "status": c.status.astype(np.int16),
            "rv_returns": rv_n.astype(np.int16),
        }
        nulls: dict[str, np.ndarray] = {"rv_returns": ~complete}
        for name, values in (*context.items(), *features.items()):
            if name in SESSION or name in context:
                gate = np.ones(m, bool)
            else:
                gate = priced if name in AVERAGES else complete
            values = np.where(gate, values, np.nan)
            nulls[name] = ~np.isfinite(values)
            v[name] = values  # NaN behind NULL, as in the candle tables
        return Table(v, {k: nulls[k] for k in NULLABLE})

    def realized(self, bars) -> tuple[np.ndarray, np.ndarray]:
        """Per window, the sum of squared one-second log returns inside it and their count
        (`window_rv`), from the window's previous 59 seconds and this chunk's."""
        m = len(bars)
        cur = {"status": bars.status.astype(np.int8), "close": bars.close.astype(np.int64)}
        pad = WIDTH - 1 - len(self.tail["status"])  # before the first second ever received
        x = {
            k: np.r_[np.full(pad, MISSING if k == "status" else 0, t), self.tail[k], cur[k]]
            for k, t in TAIL.items()
        }
        total = len(x["status"])
        rv2, count = np.empty(m), np.empty(m, np.int64)
        window_rv(x["status"], x["close"], total - m, WIDTH, rv2, count)
        self.tail = {k: v[total - (WIDTH - 1) :].copy() for k, v in x.items()}
        return rv2, count

    def ages(self, c, complete: np.ndarray) -> dict[str, np.ndarray]:
        """Scheduled-open seconds from the second of the window's first trade at its high (low) to
        the window's newest second: counted by the calendar's index counter, never by clock time,
        so a window across a closure counts only open seconds."""
        out = {}
        for name, at in (("high", c.high_at), ("low", c.low_at)):
            age = np.full(len(c), np.nan)
            if complete.any():
                second_end = (at[complete] // SECOND + 1) * SECOND  # the second holding the trade
                ordinal = self.context.calendar.slot_ordinals(second_end, SECOND)
                age[complete] = c.ordinal[complete] - ordinal
            out[name] = age
        return out
