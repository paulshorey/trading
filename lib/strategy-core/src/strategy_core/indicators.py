"""Features of a rolling candle beyond the engine's (`features.WINDOW_FEATURES`), for stored
one-second rows. See docs/project/ingestion.md for the list and the TBBO handoff entries.

Three kinds, all in normalized units (`features.Unit`), NaN when undefined:

- **Window features**: the current candle and the metrics of its rows (`metrics.py`,
  `window_metrics.py`): shape, price path, aggressor flow, trade sizes, sweeps, the book
  sampled at trades, the latest book with its age, and the session so far.
- **Recursive per-phase indicators** (EMA distance, MACD, ADX, RSI of the sampled midpoint,
  relative activity): one state per phase, advanced only by that phase's candles, which are
  exactly one period (60 rows) apart; see docs/sliding-windows/design.md#4-indicators-per-phase.
- **Lookback indicators** (stochastic, Bollinger, CCI, Donchian, Aroon, regression,
  choppiness, volatility, money flow, efficiency ratio, multi-period flow): from the
  same-phase history matrix, whose column `j` is the candle at row `o - 60 j`.

Only complete candles are inputs (the engine's gap policy). A missing same-phase candle holds
recursive averages and restarts their previous value, and leaves undefined any lookback that
would include it. History carries between calls, so any chunking gives identical values.
"""

import numpy as np
from numba import njit

from . import kernels
from .market import NS, PX
from .windows import COMPLETE, EMPTY, Candles

U_BPS, U_ATR, U_RATIO, U_INDEX, U_LOG, U_SECONDS = (
    "bps",
    "atr",
    "ratio",
    "index_0_100",
    "log_ratio",
    "seconds",
)
FEATURES: tuple[tuple[str, str, str], ...] = (
    # Candle shape and path
    ("range_bps", U_BPS, "High - low, relative to the close"),
    ("body_bps", U_BPS, "Close - open, relative to the open"),
    ("body_ratio", U_RATIO, "(Close - open) / range, -1..1; 0 for a flat candle"),
    ("upper_wick_ratio", U_RATIO, "(High - max(open, close)) / range"),
    ("lower_wick_ratio", U_RATIO, "(min(open, close) - low) / range"),
    ("vwap_bps", U_BPS, "Close - VWAP, relative to the close"),
    ("active_ratio", U_RATIO, "Share of the window's seconds with trades"),
    ("path_bps", U_BPS, "Total absolute trade-to-trade price travel, relative to the close"),
    ("path_efficiency", U_RATIO, "|Close - open| / price travel, 0..1"),
    ("uptick_ratio", U_RATIO, "Up moves / (up + down moves) between consecutive trades"),
    # Aggressor flow and trade sizes
    ("known_ratio", U_RATIO, "Volume with a known aggressor side / volume"),
    ("count_delta_ratio", U_RATIO, "(Buy - sell trade records) / sided records, -1..1"),
    ("cvd_high_ratio", U_RATIO, "Highest running buy - sell volume from the window start / sided"),
    ("cvd_low_ratio", U_RATIO, "Lowest running buy - sell volume from the window start / sided"),
    ("size_hhi", U_RATIO, "Sum of squared sizes / volume squared: 1 = one trade"),
    ("max_size_ratio", U_RATIO, "Largest trade / volume"),
    ("side_switch_ratio", U_RATIO, "Aggressor side changes / consecutive known-side pairs"),
    ("size_side_ratio", U_RATIO, "(Mean buy size - mean sell size) / their sum"),
    ("sweep_ratio", U_RATIO, "Volume printed beyond the pre-trade opposite best / volume"),
    ("sweep_delta_ratio", U_RATIO, "(Buy - sell sweep volume) / sweep volume"),
    # Book sampled at trades
    ("spread_bps", U_BPS, "Mean quoted spread at trades, relative to the close"),
    ("spread_max_bps", U_BPS, "Widest quoted spread at trades, relative to the close"),
    ("eff_spread_bps", U_BPS, "Volume-weighted effective spread 2 x side x (price - mid)"),
    ("imbalance_mean", U_RATIO, "Mean bid / (bid + ask) displayed size at trades, 0..1"),
    ("imbalance_vw", U_RATIO, "Volume-weighted bid / (bid + ask) displayed size, 0..1"),
    ("depth_imbalance", U_RATIO, "(Sum of bid - sum of ask displayed size) / their sum"),
    ("tilt_bps", U_BPS, "Mean weighted midpoint - midpoint at trades, relative to the close"),
    ("alignment", U_RATIO, "Volume-weighted side x displayed imbalance, -1..1"),
    ("take_ratio", U_RATIO, "Buy share of trade size / opposite displayed size, 0..1"),
    ("order_imbalance", U_RATIO, "Mean bid / (bid + ask) displayed order count, 0..1"),
    ("order_size_log_ratio", U_LOG, "log(mean bid size per order / mean ask size per order)"),
    ("quote_ratio", U_RATIO, "Trades with a usable pre-trade book / trades"),
    ("bad_book_ratio", U_RATIO, "Trades flagged maybe-bad-book by Databento / trades"),
    # Latest observation, with its age (also defined for windows without trades)
    ("trade_age_s", U_SECONDS, "Seconds from the last trade to the row's end"),
    ("book_age_s", U_SECONDS, "Seconds from the last trade with a usable book to the row's end"),
    ("book_spread_bps", U_BPS, "Spread of the last sampled book, relative to its midpoint"),
    ("book_imbalance", U_RATIO, "Bid / (bid + ask) displayed size of the last sampled book"),
    # Session so far (calendar session; undefined after missing data in the session)
    ("session_elapsed_s", U_SECONDS, "Scheduled seconds since the session opened"),
    ("session_ret_bps", U_BPS, "Close - session's first trade price, relative to the latter"),
    ("session_high_bps", U_BPS, "Close - session high so far, relative to the close (<= 0)"),
    ("session_low_bps", U_BPS, "Close - session low so far, relative to the close (>= 0)"),
    ("session_delta_ratio", U_RATIO, "Session buy - sell volume / session sided volume"),
    # Recursive per-phase indicators
    ("ema9_atr", U_ATR, "Close - same-phase EMA(9) of closes, in ATRs"),
    ("ema21_atr", U_ATR, "Close - same-phase EMA(21) of closes, in ATRs"),
    ("ema50_atr", U_ATR, "Close - same-phase EMA(50) of closes, in ATRs"),
    ("macd_atr", U_ATR, "Same-phase EMA(12) - EMA(26) of closes, in ATRs"),
    ("macd_signal_atr", U_ATR, "Same-phase EMA(9) of MACD, in ATRs"),
    ("macd_hist_atr", U_ATR, "MACD - signal, in ATRs"),
    ("ppo_bps", U_BPS, "(EMA(12) - EMA(26)) / EMA(26)"),
    ("adx", U_INDEX, "Wilder ADX(14) of same-phase candles"),
    ("plus_di", U_INDEX, "Wilder +DI(14)"),
    ("minus_di", U_INDEX, "Wilder -DI(14)"),
    ("mid_rsi", U_INDEX, "Wilder RSI(14) of the window's last sampled midpoint"),
    ("rel_trades", U_LOG, "log(trade count / same-phase EMA(20) of earlier periods)"),
    ("rel_depth", U_LOG, "log(mean displayed size / same-phase EMA(20) of earlier periods)"),
    ("rel_spread", U_LOG, "log(mean spread / same-phase EMA(20) of earlier periods)"),
    # Lookback indicators on the same-phase history
    ("stoch_k", U_INDEX, "Stochastic %K(14): close within the 14-period range"),
    ("stoch_d", U_INDEX, "Mean of the last 3 same-phase %K"),
    ("bb_z", U_RATIO, "(Close - SMA(20)) / population std(20) of closes"),
    ("bb_width_bps", U_BPS, "4 x std(20) of closes, relative to SMA(20)"),
    ("cci", U_RATIO, "CCI(20) of typical prices"),
    ("donchian_pos", U_RATIO, "Close within the prior 20 periods' high-low range, 0..1 inside"),
    ("donchian_high_atr", U_ATR, "Prior 20-period high - close, in ATRs"),
    ("donchian_low_atr", U_ATR, "Close - prior 20-period low, in ATRs"),
    ("aroon_up", U_INDEX, "Aroon up(25): recency of the 25-period high"),
    ("aroon_down", U_INDEX, "Aroon down(25): recency of the 25-period low"),
    ("linreg_slope_atr", U_ATR, "OLS slope of the last 20 closes per period, in ATRs"),
    ("linreg_r2", U_RATIO, "R squared of that regression"),
    ("chop", U_INDEX, "Choppiness index(14)"),
    ("vol_bps", U_BPS, "Population std of the last 20 same-phase close-to-close returns"),
    ("cmf", U_RATIO, "Chaikin money flow(20), -1..1"),
    ("mfi", U_INDEX, "Money flow index(14)"),
    ("er", U_RATIO, "Kaufman efficiency ratio(10), 0..1"),
    ("ret_5_atr", U_ATR, "Close change over 5 periods, in ATRs"),
    ("ret_15_atr", U_ATR, "Close change over 15 periods, in ATRs"),
    ("delta_ratio_5", U_RATIO, "Buy - sell volume / sided volume over the last 5 periods"),
    ("delta_ratio_15", U_RATIO, "Buy - sell volume / sided volume over the last 15 periods"),
    ("flow_price_corr", U_RATIO, "Correlation of period close changes and delta ratios (20)"),
)
AS_OF_FEATURES = ("trade_age_s", "book_age_s", "book_spread_bps", "book_imbalance")
DEPTH = 26  # same-phase candles kept: Aroon(25) needs 26


@njit(cache=True)
def phase_ema(x, valid, phase, period, ema, count, out):
    """Same-phase EMA including the current value, NaN until `period` values were seen."""
    alpha = 2.0 / (period + 1.0)
    for i in range(x.shape[0]):
        p = phase[i]
        if not valid[i]:
            out[i] = np.nan
            continue
        if count[p] == 0:
            ema[p] = x[i]
        else:
            ema[p] += alpha * (x[i] - ema[p])
        count[p] += 1
        out[i] = ema[p] if count[p] >= period else np.nan


@njit(cache=True)
def phase_adx(high, low, close, valid, phase, n, prev, tr, pdm, mdm, count, dx, dxn, pdi, mdi, adx):
    """Wilder +DI, -DI, and ADX per phase, each average seeded by the mean of its first `n`
    values. `prev` holds the previous high, low, and close of each phase (n_phases, 3)."""
    for i in range(close.shape[0]):
        p = phase[i]
        pdi[i] = mdi[i] = adx[i] = np.nan
        if not valid[i]:
            prev[p, 2] = np.nan
            continue
        if np.isnan(prev[p, 2]):
            prev[p, 0], prev[p, 1], prev[p, 2] = high[i], low[i], close[i]
            continue
        up = high[i] - prev[p, 0]
        down = prev[p, 1] - low[i]
        plus = up if up > down and up > 0.0 else 0.0
        minus = down if down > up and down > 0.0 else 0.0
        t = max(high[i], prev[p, 2]) - min(low[i], prev[p, 2])
        prev[p, 0], prev[p, 1], prev[p, 2] = high[i], low[i], close[i]
        c = count[p] + 1
        count[p] = c
        if c <= n:
            tr[p] += t / n
            pdm[p] += plus / n
            mdm[p] += minus / n
        else:
            tr[p] = (tr[p] * (n - 1) + t) / n
            pdm[p] = (pdm[p] * (n - 1) + plus) / n
            mdm[p] = (mdm[p] * (n - 1) + minus) / n
        if c < n:
            continue
        a = 100.0 * pdm[p] / tr[p] if tr[p] > 0.0 else 0.0
        b = 100.0 * mdm[p] / tr[p] if tr[p] > 0.0 else 0.0
        pdi[i], mdi[i] = a, b
        x = 100.0 * abs(a - b) / (a + b) if a + b > 0.0 else 0.0
        d = dxn[p] + 1
        dxn[p] = d
        if d <= n:
            dx[p] += x / n
        else:
            dx[p] = (dx[p] * (n - 1) + x) / n
        if d >= n:
            adx[i] = dx[p]


def row_sum(x: np.ndarray) -> np.ndarray:
    """Sum across columns in one fixed order, so results never depend on the chunk size."""
    acc = x[:, 0].copy()
    for j in range(1, x.shape[1]):
        acc += x[:, j]
    return acc


def div(a, b, zero=np.nan):
    """a / b, with `zero` where b == 0 and NaN where either is NaN."""
    a, b = np.broadcast_arrays(np.asarray(a, float), np.asarray(b, float))
    out = np.full(a.shape, zero, float)
    nz = b != 0
    np.divide(a, b, out=out, where=nz)
    out[np.isnan(a) | np.isnan(b)] = np.nan
    return out


class History:
    """The last `depth` same-phase values of named series (NaN where a candle was invalid)."""

    STATE = ("tail",)

    def __init__(self, names: tuple[str, ...], depth: int, period: int):
        self.keep, self.period = period * (depth - 1), period
        self.tail = {n: np.full(self.keep, np.nan) for n in names}

    def extend(self, new: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        buffers = {k: np.r_[self.tail[k], new[k]] for k in self.tail}
        self.tail = {k: v[len(v) - self.keep :].copy() for k, v in buffers.items()}
        return buffers

    def matrix(self, buffer: np.ndarray, m: int, n: int) -> np.ndarray:
        """(m, n): column j is the value j periods before each of the last m rows."""
        index = self.keep + np.arange(m)[:, None] - self.period * np.arange(n)[None, :]
        return buffer[index]


class CandleIndicators:
    STATE = (
        "history",
        "k_history",
        "ema9",
        "ema21",
        "ema50",
        "ema12",
        "ema26",
        "signal",
        "adx",
        "mid_rsi",
        "rel_trades",
        "rel_depth",
        "rel_spread",
    )

    def __init__(self, slots: int = 60, period: int = 14, activity_period: int = 20):
        self.slots, self.n, self.activity = slots, period, activity_period

        def ema():
            return kernels.PhaseState(slots, ema="zero", count="count")

        self.ema9, self.ema21, self.ema50 = ema(), ema(), ema()
        self.ema12, self.ema26, self.signal = ema(), ema(), ema()
        self.adx = kernels.PhaseState(
            slots, tr="zero", pdm="zero", mdm="zero", count="count", dx="zero", dxn="count"
        )
        self.adx.prev = np.full((slots, 3), np.nan)
        self.adx.STATE = (*self.adx.STATE, "prev")
        self.mid_rsi = kernels.PhaseState(
            slots, prev="nan", gain="zero", loss="zero", count="count"
        )
        self.rel_trades = kernels.PhaseState(slots, ema="zero", count="count")
        self.rel_depth = kernels.PhaseState(slots, ema="zero", count="count")
        self.rel_spread = kernels.PhaseState(slots, ema="zero", count="count")
        names = ("close", "high", "low", "volume", "sided", "delta", "mfv")
        self.history = History(names, DEPTH, slots)
        self.k_history = History(("k",), 3, slots)

    def update(
        self,
        c: Candles,
        win: dict[str, np.ndarray],
        atr: np.ndarray,
        session: dict[str, np.ndarray],
    ) -> dict[str, np.ndarray]:
        m = len(c)
        valid = c.status == COMPLETE
        o, h, lo, cl = c.open, c.high, c.low, c.close
        atr_ok = np.where(atr > 0, atr, np.nan)
        span = h - lo
        sided = c.buy + c.sell
        f: dict[str, np.ndarray] = {}

        # Candle shape and path
        f["range_bps"] = div(span, cl) * 1e4
        f["body_bps"] = div(cl - o, o) * 1e4
        f["body_ratio"] = div(cl - o, span, 0.0)
        f["upper_wick_ratio"] = div(h - np.maximum(o, cl), span, 0.0)
        f["lower_wick_ratio"] = div(np.minimum(o, cl) - lo, span, 0.0)
        f["vwap_bps"] = div(cl - c.vwap, cl) * 1e4
        f["active_ratio"] = win["observed"] / self.slots
        path = win["path_abs"] / PX
        f["path_bps"] = div(path, cl) * 1e4
        f["path_efficiency"] = div(np.abs(cl - o), path)
        f["uptick_ratio"] = div(win["upticks"], win["upticks"] + win["downticks"])

        # Flow and sizes
        bt, st = win["buy_trades"], win["sell_trades"]
        f["known_ratio"] = div(sided, c.volume)
        f["count_delta_ratio"] = div(bt - st, bt + st)
        f["cvd_high_ratio"] = div(win["delta_high"], sided)
        f["cvd_low_ratio"] = div(win["delta_low"], sided)
        f["size_hhi"] = div(win["size_sq"], c.volume * c.volume)
        f["max_size_ratio"] = div(win["max_size"], c.volume)
        f["side_switch_ratio"] = div(win["side_switches"], win["side_pairs"])
        mean_buy, mean_sell = div(c.buy, bt), div(c.sell, st)
        f["size_side_ratio"] = div(mean_buy - mean_sell, mean_buy + mean_sell)
        sweeps = win["sweep_buy_volume"] + win["sweep_sell_volume"]
        f["sweep_ratio"] = div(sweeps, c.volume)
        f["sweep_delta_ratio"] = div(win["sweep_buy_volume"] - win["sweep_sell_volume"], sweeps)

        # Book sampled at trades
        qt, dt = win["quote_trades"], win["depth_trades"]
        spread_mean = div(win["spread_sum"], qt) / PX
        f["spread_bps"] = div(spread_mean, cl) * 1e4
        f["spread_max_bps"] = np.where(qt > 0, div(win["spread_max"] / PX, cl) * 1e4, np.nan)
        eff = div(win["eff_spread_sum"], win["known_quote_volume"]) / PX
        f["eff_spread_bps"] = div(eff, cl) * 1e4
        f["imbalance_mean"] = div(win["imbalance_sum"], dt)
        f["imbalance_vw"] = div(win["imbalance_volume_sum"], win["depth_volume"])
        bd, ad = win["bid_depth_sum"], win["ask_depth_sum"]
        f["depth_imbalance"] = div(bd - ad, bd + ad)
        f["tilt_bps"] = div(div(win["tilt_sum"], dt) / PX, cl) * 1e4
        f["alignment"] = div(win["alignment_sum"], win["known_depth_volume"])
        takes = win["buy_take_sum"] + win["sell_take_sum"]
        f["take_ratio"] = div(win["buy_take_sum"], takes)
        f["order_imbalance"] = div(win["order_imbalance_sum"], win["order_trades"])
        with np.errstate(divide="ignore", invalid="ignore"):
            per_order = div(div(bd, win["bid_orders_sum"]), div(ad, win["ask_orders_sum"]))
            f["order_size_log_ratio"] = np.where(per_order > 0, np.log(per_order), np.nan)
        f["quote_ratio"] = div(qt, c.trades)
        f["bad_book_ratio"] = div(win["bad_book_trades"], c.trades)

        # Latest observation as of the row's end
        has_trade, has_book = win["has_trade"] > 0, win["has_book"] > 0
        f["trade_age_s"] = np.where(has_trade, (c.end - win["last_trade_at"]) / NS, np.nan)
        # TBBO shows the book only at trades: a trade with an unusable book does not refresh it
        f["book_age_s"] = np.where(has_book, (c.end - win["book_at"]) / NS, np.nan)
        bid, ask = win["book_bid"] / PX, win["book_ask"] / PX
        f["book_spread_bps"] = np.where(has_book, div(ask - bid, (ask + bid) / 2) * 1e4, np.nan)
        f["book_imbalance"] = np.where(win["has_depth"] > 0, win["book_imbalance"], np.nan)

        # Session so far
        ok = session["complete"] & (session["has_px"] > 0)
        s_open = np.where(ok, session["open_px"] / PX, np.nan)
        f["session_elapsed_s"] = (c.end - session["interval_open"]) / NS
        f["session_ret_bps"] = div(cl - s_open, s_open) * 1e4
        f["session_high_bps"] = div(cl - np.where(ok, session["high_px"] / PX, np.nan), cl) * 1e4
        f["session_low_bps"] = div(cl - np.where(ok, session["low_px"] / PX, np.nan), cl) * 1e4
        cvd = np.where(session["complete"], session["cvd"], np.nan)
        f["session_delta_ratio"] = div(cvd, session["sided"])

        # Recursive per-phase indicators
        ph = c.phase.astype(np.int64)

        def ema(state, x, ok, period):
            out = np.empty(m)
            phase_ema(x, ok, ph, period, state.ema, state.count, out)
            return out

        for name, state, period in (
            ("ema9_atr", self.ema9, 9),
            ("ema21_atr", self.ema21, 21),
            ("ema50_atr", self.ema50, 50),
        ):
            f[name] = (cl - ema(state, cl, valid, period)) / atr_ok
        fast, slow = ema(self.ema12, cl, valid, 12), ema(self.ema26, cl, valid, 26)
        macd = fast - slow
        signal = ema(self.signal, macd, valid & np.isfinite(macd), 9)
        f["macd_atr"] = macd / atr_ok
        f["macd_signal_atr"] = signal / atr_ok
        f["macd_hist_atr"] = (macd - signal) / atr_ok
        f["ppo_bps"] = div(macd, slow) * 1e4
        s = self.adx
        pdi, mdi, adx = np.empty(m), np.empty(m), np.empty(m)
        # Fixed-point prices (exact integers in float64), so equal up and down moves tie exactly
        hf, lf, cf = (np.rint(x * PX) for x in (h, lo, cl))
        phase_adx(
            hf, lf, cf, valid, ph, self.n, s.prev, s.tr, s.pdm, s.mdm, s.count, s.dx, s.dxn,
            pdi, mdi, adx,
        )  # fmt: skip
        f["adx"], f["plus_di"], f["minus_di"] = adx, pdi, mdi
        mid = np.where(qt > 0, (win["last_bid"] + win["last_ask"]) / (2 * PX), np.nan)
        mid_ok = valid & np.isfinite(mid)
        out = np.empty(m)
        s = self.mid_rsi
        kernels.wilder_rsi(
            np.where(mid_ok, mid, 0.0), mid_ok, ph, self.n, s.prev, s.gain, s.loss, s.count, out
        )
        f["mid_rsi"] = out
        depth_mean = div(bd + ad, dt)
        for name, state, x in (
            ("rel_trades", self.rel_trades, c.trades.astype(float)),
            ("rel_depth", self.rel_depth, depth_mean),
            ("rel_spread", self.rel_spread, f["spread_bps"]),
        ):
            ok_x = valid & np.isfinite(x) & (x > 0)
            base = np.empty(m)
            kernels.ema_prior(
                np.where(ok_x, x, 0.0), ok_x, ph, self.activity, state.ema, state.count, base
            )
            with np.errstate(divide="ignore", invalid="ignore"):
                f[name] = np.where(ok_x & (base > 0), np.log(x / base), np.nan)

        # Lookback indicators over the same-phase history
        nan = np.nan
        mfm = div((cl - lo) - (h - cl), span, 0.0)
        new = {
            "close": cl,
            "high": h,
            "low": lo,
            "volume": c.volume,
            "sided": sided,
            "delta": c.buy - c.sell,
            "mfv": mfm * c.volume,
        }
        new = {k: np.where(valid, v, nan) for k, v in new.items()}
        hist = self.history
        buffers = hist.extend(new)

        def mat(name, n):
            return hist.matrix(buffers[name], m, n)

        C, H, L = mat("close", DEPTH), mat("high", DEPTH), mat("low", DEPTH)

        def full(*xs):
            return np.all(np.isfinite(np.concatenate(xs, axis=1)), axis=1)

        # Stochastic %K(14) and %D(3)
        hh, ll = H[:, :14].max(axis=1), L[:, :14].min(axis=1)
        ok14 = full(H[:, :14], L[:, :14], C[:, :1])
        k = np.where(ok14, div(C[:, 0] - ll, hh - ll, 0.5) * 100, nan)
        kb = self.k_history.extend({"k": k})["k"]
        K = self.k_history.matrix(kb, m, 3)
        f["stoch_k"] = k
        f["stoch_d"] = np.where(full(K), row_sum(K) / 3, nan)

        # Bollinger(20, 2) and CCI(20)
        X = C[:, :20]
        ok20 = full(X)
        mean = row_sum(X) / 20
        sd = np.sqrt(row_sum((X - mean[:, None]) ** 2) / 20)
        f["bb_z"] = np.where(ok20, div(C[:, 0] - mean, sd, 0.0), nan)
        f["bb_width_bps"] = np.where(ok20, div(4 * sd, mean) * 1e4, nan)
        TP = (H[:, :20] + L[:, :20] + X) / 3
        tp_mean = row_sum(TP) / 20
        mad = row_sum(np.abs(TP - tp_mean[:, None])) / 20
        okc = full(TP)
        f["cci"] = np.where(okc, div(TP[:, 0] - tp_mean, 0.015 * mad, 0.0), nan)

        # Donchian(20) over the prior periods
        okd = full(H[:, 1:21], L[:, 1:21], C[:, :1])
        phh, pll = H[:, 1:21].max(axis=1), L[:, 1:21].min(axis=1)
        f["donchian_pos"] = np.where(okd, div(C[:, 0] - pll, phh - pll, 0.5), nan)
        f["donchian_high_atr"] = np.where(okd, (phh - C[:, 0]) / atr_ok, nan)
        f["donchian_low_atr"] = np.where(okd, (C[:, 0] - pll) / atr_ok, nan)

        # Aroon(25): steps since the most recent highest high / lowest low of 26 candles
        oka = full(H, L)
        f["aroon_up"] = np.where(oka, 100.0 * (25 - np.argmax(H, axis=1)) / 25, nan)
        f["aroon_down"] = np.where(oka, 100.0 * (25 - np.argmin(L, axis=1)) / 25, nan)

        # Linear regression of the last 20 closes (x = 0 oldest .. 19 newest)
        xs = 19.0 - np.arange(20)
        dx = xs - xs.mean()
        sxx = float(np.sum(dx * dx))
        slope = row_sum(X * dx[None, :]) / sxx
        fitted = mean[:, None] + slope[:, None] * dx[None, :]
        sse = row_sum((X - fitted) ** 2)
        sst = row_sum((X - mean[:, None]) ** 2)
        f["linreg_slope_atr"] = np.where(ok20, slope / atr_ok, nan)
        f["linreg_r2"] = np.where(ok20, np.maximum(1 - div(sse, sst), 0.0), nan)

        # Choppiness(14), volatility(20), efficiency ratio(10), momentum
        tr = np.maximum(H[:, :14], C[:, 1:15]) - np.minimum(L[:, :14], C[:, 1:15])
        rng = H[:, :14].max(axis=1) - L[:, :14].min(axis=1)
        okch = full(H[:, :14], L[:, :14], C[:, :15])
        with np.errstate(divide="ignore", invalid="ignore"):
            chop = 100 * np.log10(div(row_sum(tr), rng)) / np.log10(14)
        f["chop"] = np.where(okch & (rng > 0), chop, nan)
        R = div(C[:, :20], C[:, 1:21]) * 1e4 - 1e4
        okr = full(C[:, :21])
        r_mean = row_sum(R) / 20
        f["vol_bps"] = np.where(okr, np.sqrt(row_sum((R - r_mean[:, None]) ** 2) / 20), nan)
        moves = np.abs(C[:, :10] - C[:, 1:11])
        f["er"] = np.where(
            full(C[:, :11]), div(np.abs(C[:, 0] - C[:, 10]), row_sum(moves), 0.0), nan
        )
        f["ret_5_atr"] = (C[:, 0] - C[:, 5]) / atr_ok
        f["ret_15_atr"] = (C[:, 0] - C[:, 15]) / atr_ok

        # Money flow and multi-period aggressor flow
        V, MFV = mat("volume", 20), mat("mfv", 20)
        f["cmf"] = np.where(full(V, MFV), div(row_sum(MFV), row_sum(V)), nan)
        tp15 = (H[:, :15] + L[:, :15] + C[:, :15]) / 3
        flow = tp15[:, :14] * mat("volume", 15)[:, :14]
        exact = sum(np.rint(x[:, :15] * PX) for x in (H, L, C))  # compare in exact units
        up, down = exact[:, :14] > exact[:, 1:15], exact[:, :14] < exact[:, 1:15]
        pos, neg = row_sum(np.where(up, flow, 0.0)), row_sum(np.where(down, flow, 0.0))
        okm = full(tp15, mat("volume", 15))
        f["mfi"] = np.where(okm, div(100 * pos, pos + neg, 50.0), nan)
        D, S = mat("delta", 20), mat("sided", 20)
        for n in (5, 15):
            f[f"delta_ratio_{n}"] = np.where(
                full(D[:, :n], S[:, :n]), div(row_sum(D[:, :n]), row_sum(S[:, :n])), nan
            )
        dc = C[:, :20] - C[:, 1:21]
        dr = div(D, S)
        okf = full(C[:, :21], D, S) & np.all(np.isfinite(dr), axis=1)
        dc_c = dc - (row_sum(dc) / 20)[:, None]
        dr_c = dr - (row_sum(np.where(np.isfinite(dr), dr, 0.0)) / 20)[:, None]
        cov = row_sum(dc_c * dr_c)
        f["flow_price_corr"] = np.where(
            okf, div(cov, np.sqrt(row_sum(dc_c**2) * row_sum(dr_c**2))), nan
        )

        as_of_ok = (c.status == COMPLETE) | (c.status == EMPTY)
        for name, values in f.items():
            gate = as_of_ok if name in AS_OF_FEATURES else valid
            values[~gate] = np.nan
        return f
