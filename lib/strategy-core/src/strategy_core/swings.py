"""Swings: turning points of a series, their structure, and the open leg (layer 2;
docs/project/pivot-structure-design.md, docs/project/plan-1h-and-pivots.md section 3).

`Detector` replays one scale's observations in order (for price, every released trade) and keeps
one chronological swing history, with no phase key:

- **Directional change with a frozen threshold.** An up leg keeps its running high (the first
  occurrence on ties) and the lowest observation since it. The high is confirmed by the first
  observation at least `theta` below it; `theta` is frozen when the high is set and changes only
  when a strictly higher high replaces it, so falling volatility alone confirms nothing. The leg
  then turns down, its running low being the confirming observation. Lows mirror this. Until the
  first confirmation of a segment the direction is unknown and both extremes are tracked.
- **Structure.** Each confirmed high or low is compared with the previous one of its kind in the
  segment: higher (+1), lower (-1), or equal (0), with its run length and its change in ATRs.
  `trend` is +1 after a higher high and a higher low, -1 after a lower high and a lower low, 0
  for other known pairs, and undefined until both comparisons exist.
- **Breaches and reclaims.** The first observation strictly beyond the latest confirmed high or
  low is a breach; an observation back inside within `window` published rows, before a new
  pivot of that kind confirms, is a reclaim, with the depth of the sweep. Both are judged
  against the levels known before the observation, then confirmations follow.
- **Legs.** A leg holds the observations after its starting extreme through its ending extreme.
  Sums of volume by aggressor side are kept through the running extreme and since it; the
  confirming observation belongs to the new leg.
- **Segments.** Missing data, an undefined threshold or ATR, and (for prices) a nonpositive
  price end the segment: confirmed events stay as emitted, the candidate, direction, and
  comparators are dropped, and nothing before the break is compared with anything after it.
  Closures add no rows, so state continues across them and a reopening move can confirm.

Distances are log basis points for prices and plain differences for additive series (such as an
oscillator). Values "in ATRs" divide a difference by the ATR snapshot frozen with the extreme
they describe, never by the current ATR. Ages count published rows (scheduled-open time), never
clock time. State is published once per row, after the row's observations, so a value never
uses an observation from after its own row; events carry the row of the observation that
produced them.

All state lives in arrays (`Detector.STATE`), updated row by row, so a session processed at once
or one second at a time gives identical rows and events, and a checkpoint resumes exactly.
"""

import numpy as np
from numba import njit

from .bars import aggregate
from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .features import Unit  # unit labels of the registry; they do not change stored values
from .market import SECOND

PRICE, ADDITIVE = 0, 1  # how distance is measured: log bps of a price, or a plain difference
IDLE, SEEKING, ACTIVE = 0, 1, 2  # no segment; segment open, direction unknown; in a leg
HIGH, LOW, BREAK_UP, BREAK_DOWN, RECLAIM_HIGH, RECLAIM_LOW = 1, 2, 3, 4, 5, 6  # event kinds
NONE = np.iinfo(np.int64).min  # an undefined integer in the event arrays
RUN_CAP = 5  # runs are clipped to +-RUN_CAP for the bounded run ratio

# Integer state.
(G_SEG, G_MODE, G_DIR, G_BLOCKED, G_HAS_LAST, G_SEQ_ORD, G_SEQ, G_TREND_HAS, G_TREND,
 G_TREND_ORD, G_LEG_HAS, G_LEG_ORD, G_PREV_HAS, NG) = range(14)  # fmt: skip
F_LAST, F_LEG_PX, F_PREV_SIZE, F_PREV_ATR, NF = range(5)  # float state
# Candidates (row 0: the running high, row 1: the running low).
K_ORD, K_AT, NKI = range(3)
K_PX, K_THETA, K_ATR, K_OPP, NKF = range(5)
# Latest confirmed pivots (row 0: high, row 1: low).
(C_HAS, C_EXT_ORD, C_EXT_AT, C_CONF_ORD, C_SEQ, C_CLS_HAS, C_CLS, C_RUN, C_BREACH,
 C_BREACH_ORD, NCI) = range(11)  # fmt: skip
C_PX, C_ATR, C_CHANGE, C_DEEP, NCF = range(5)
A_VOL, A_BUY, A_SELL, NA = range(4)  # leg sums; row 0 through the extreme, row 1 since it

# Published row (floats, NaN undefined).
(O_STATE, O_SEG, O_EXT, O_DIR, O_PROGRESS, O_THETA, O_EXT_DIST, O_EXT_AGE, O_LEG, O_LEG_AGE,
 O_LEG_DELTA, O_REV_DELTA, O_PREV_LEG, O_RETRACE, O_CAND_CHANGE, O_TREND, O_TREND_AGE,
 O_SIDE) = range(18)  # fmt: skip
(S_LEVEL, S_DIST, S_AGE, S_CONF_AGE, S_CHANGE, S_CLS, S_RUN, S_BREAK_AGE, S_PROV,
 NS_) = range(10)  # per side, from O_SIDE (high) and O_SIDE + NS_ (low)  # fmt: skip
NO = O_SIDE + 2 * NS_

# Events: integers (NONE undefined) and floats (NaN undefined).
(E_KIND, E_ORD, E_SEQ, E_ROW, E_AT, E_SEG, E_EXT_ORD, E_EXT_AT, E_CLS, E_RUN, E_LEG_ROWS,
 E_LEG_VOL, E_LEG_BUY, E_LEG_SELL, E_REF_ORD, E_REF_SEQ, E_AGE, E_TREND,
 NEI) = range(19)  # fmt: skip
X_LEVEL, X_THETA, X_ATR, X_OVER, X_CHANGE, X_LEG, X_DEPTH, NEF = range(8)


@njit(cache=True)
def _reversal(mode, sign, extreme, x):
    """How far `x` has reversed from `extreme` (sign +1: below a high; -1: above a low)."""
    if mode == PRICE:
        return sign * 1e4 * np.log(extreme / x)
    return sign * (extreme - x)


@njit(cache=True)
def _reset(g, ci):
    g[G_MODE] = IDLE
    g[G_DIR] = 0
    g[G_HAS_LAST] = 0
    g[G_TREND_HAS] = 0
    g[G_LEG_HAS] = 0
    g[G_PREV_HAS] = 0
    for s in range(2):
        ci[s, C_HAS] = 0
        ci[s, C_CLS_HAS] = 0
        ci[s, C_RUN] = 0
        ci[s, C_BREACH] = 0


@njit(cache=True)
def _event(ev_i, ev_f, ne, kind, row, at, g):
    for c in range(NEI):
        ev_i[ne, c] = NONE
    for c in range(NEF):
        ev_f[ne, c] = np.nan
    ev_i[ne, E_KIND] = kind
    ev_i[ne, E_ORD] = g[G_SEQ_ORD]
    ev_i[ne, E_SEQ] = g[G_SEQ]
    ev_i[ne, E_ROW] = row
    ev_i[ne, E_AT] = at
    ev_i[ne, E_SEG] = g[G_SEG]
    if g[G_TREND_HAS] == 1:
        ev_i[ne, E_TREND] = g[G_TREND]
    g[G_SEQ] += 1


@njit(cache=True)
def _candidate(ki, kf, s, p, pub, at, theta, atr):
    ki[s, K_ORD] = pub
    ki[s, K_AT] = at
    kf[s, K_PX] = p
    kf[s, K_THETA] = theta
    kf[s, K_ATR] = atr
    kf[s, K_OPP] = p


@njit(cache=True)
def _publish(mode, step, pub, g, gf, ki, kf, ci, cf, acc, row):
    for c in range(NO):
        row[c] = np.nan
    m = g[G_MODE]
    row[O_STATE] = m
    if m == IDLE:
        return
    row[O_SEG] = g[G_SEG]
    last = gf[F_LAST]
    progress = np.nan
    running = -1
    if m == ACTIVE:
        running = 0 if g[G_DIR] > 0 else 1
        sign = 1.0 - 2.0 * running
        ext, atr, theta = kf[running, K_PX], kf[running, K_ATR], kf[running, K_THETA]
        progress = _reversal(mode, sign, ext, kf[running, K_OPP]) / theta
        progress = min(max(progress, 0.0), 1.0) + 0.0  # never -0.0
        size = sign * (ext - gf[F_LEG_PX])
        row[O_EXT] = ext
        row[O_DIR] = g[G_DIR]
        row[O_PROGRESS] = progress
        row[O_THETA] = theta
        row[O_EXT_DIST] = sign * (ext - last) / atr + 0.0
        row[O_EXT_AGE] = (pub - ki[running, K_ORD]) * step
        row[O_LEG] = size / atr
        row[O_LEG_AGE] = (pub - g[G_LEG_ORD]) * step
        sided = acc[0, A_BUY] + acc[0, A_SELL]
        if sided > 0:
            row[O_LEG_DELTA] = (acc[0, A_BUY] - acc[0, A_SELL]) / sided
        sided = acc[1, A_BUY] + acc[1, A_SELL]
        if sided > 0:
            row[O_REV_DELTA] = (acc[1, A_BUY] - acc[1, A_SELL]) / sided
        if g[G_PREV_HAS] == 1:
            row[O_PREV_LEG] = gf[F_PREV_ATR]
            row[O_RETRACE] = size / gf[F_PREV_SIZE]
        if ci[running, C_HAS] == 1:
            row[O_CAND_CHANGE] = (ext - cf[running, C_PX]) / atr
    for s in range(2):
        if ci[s, C_HAS] == 0:
            continue
        base = O_SIDE + s * NS_
        sign = 1.0 - 2.0 * s
        level = cf[s, C_PX]
        row[base + S_LEVEL] = level
        row[base + S_DIST] = sign * (level - last) / cf[s, C_ATR] + 0.0
        row[base + S_AGE] = (pub - ci[s, C_EXT_ORD]) * step
        row[base + S_CONF_AGE] = (pub - ci[s, C_CONF_ORD]) * step
        if ci[s, C_CLS_HAS] == 1:
            row[base + S_CHANGE] = cf[s, C_CHANGE]
            row[base + S_CLS] = ci[s, C_CLS]
            row[base + S_RUN] = min(max(ci[s, C_RUN], -RUN_CAP), RUN_CAP) / RUN_CAP
        if ci[s, C_BREACH] > 0:
            row[base + S_BREAK_AGE] = (pub - ci[s, C_BREACH_ORD]) * step
        # provisional lower high (s = 0) or higher low (s = 1): the open candidate of this kind
        # has not passed the confirmed level and has partly reversed
        inside = running == s and sign * (kf[s, K_PX] - level) < 0.0
        row[base + S_PROV] = 1.0 if inside and 0.0 < progress < 1.0 else 0.0
    if g[G_TREND_HAS] == 1:
        row[O_TREND] = g[G_TREND]
        row[O_TREND_AGE] = (pub - g[G_TREND_ORD]) * step


@njit(cache=True)
def run(mode, window, step, o_val, o_row, o_at, o_size, o_side, r_missing, r_theta, r_atr,
        r_group, r_pub, r_emit, g, gf, ki, kf, ci, cf, acc, out, ev_i, ev_f):  # fmt: skip
    """Advance one scale over a chunk's rows and their observations (sorted by row); fill one
    `out` row per published row and the events, and return the number of events.

    Per row: `r_missing` (no data coverage), the threshold and ATR snapshot for extremes set in
    it (`r_theta`, `r_atr`: from the previous completed row; not above zero means undefined),
    `r_group` (rows that share those inputs: a missing row closes its group), `r_pub` (the
    index counter of the published row it belongs to), and `r_emit` (a row is published after
    it)."""
    n_obs = o_val.shape[0]
    i = 0
    k = 0
    ne = 0
    for j in range(r_missing.shape[0]):
        group = r_group[j]
        theta_j, atr_j = r_theta[j], r_atr[j]
        if r_missing[j]:
            g[G_BLOCKED] = group
        ready = theta_j > 0.0 and atr_j > 0.0 and np.isfinite(theta_j) and np.isfinite(atr_j)
        if not ready or group == g[G_BLOCKED]:
            if g[G_MODE] != IDLE:
                _reset(g, ci)
        elif g[G_MODE] == IDLE:
            g[G_MODE] = SEEKING
            g[G_SEG] += 1
        pub = r_pub[j]
        if g[G_SEQ_ORD] != pub:
            g[G_SEQ_ORD] = pub
            g[G_SEQ] = 0
        while i < n_obs and o_row[i] <= j:
            p, at = o_val[i], o_at[i]
            size, side = o_size[i], o_side[i]
            i += 1
            if g[G_MODE] == IDLE:
                continue
            if mode == PRICE and not p > 0.0:  # log distances need positive prices
                _reset(g, ci)
                g[G_BLOCKED] = group
                continue
            # Breaches and reclaims, against the levels known before this observation.
            for s in range(2):
                if ci[s, C_HAS] == 0:
                    continue
                sign = 1.0 - 2.0 * s
                level = cf[s, C_PX]
                if ci[s, C_BREACH] == 0:
                    if sign * (p - level) > 0.0:
                        _event(ev_i, ev_f, ne, BREAK_UP + s, j, at, g)
                        ev_i[ne, E_REF_ORD] = ci[s, C_CONF_ORD]
                        ev_i[ne, E_REF_SEQ] = ci[s, C_SEQ]
                        ev_f[ne, X_LEVEL] = level
                        ev_f[ne, X_ATR] = cf[s, C_ATR]
                        ev_f[ne, X_DEPTH] = sign * (p - level) / cf[s, C_ATR]
                        ne += 1
                        ci[s, C_BREACH] = 1
                        ci[s, C_BREACH_ORD] = pub
                        cf[s, C_DEEP] = p
                elif ci[s, C_BREACH] == 1:
                    if sign * (p - cf[s, C_DEEP]) > 0.0:
                        cf[s, C_DEEP] = p
                    if sign * (p - level) < 0.0:  # back inside; equality is neither
                        if pub - ci[s, C_BREACH_ORD] <= window:
                            _event(ev_i, ev_f, ne, RECLAIM_HIGH + s, j, at, g)
                            ev_i[ne, E_REF_ORD] = ci[s, C_CONF_ORD]
                            ev_i[ne, E_REF_SEQ] = ci[s, C_SEQ]
                            ev_i[ne, E_AGE] = (pub - ci[s, C_BREACH_ORD]) * step
                            ev_f[ne, X_LEVEL] = level
                            ev_f[ne, X_ATR] = cf[s, C_ATR]
                            ev_f[ne, X_DEPTH] = sign * (cf[s, C_DEEP] - level) / cf[s, C_ATR]
                            ne += 1
                        ci[s, C_BREACH] = 2
            # Extremes, then at most one confirmation.
            buy = size if side > 0 else 0
            sell = size if side < 0 else 0
            confirmed = -1
            seeking = g[G_MODE] == SEEKING
            if seeking:
                if g[G_HAS_LAST] == 0:  # the segment's first observation seeds both extremes
                    for s in range(2):
                        _candidate(ki, kf, s, p, pub, at, theta_j, atr_j)
                        acc[s, A_VOL] = 0
                        acc[s, A_BUY] = 0
                        acc[s, A_SELL] = 0
                else:
                    for s in range(2):  # sums since each extreme, which a new extreme restarts
                        sign = 1.0 - 2.0 * s
                        if sign * (p - kf[s, K_PX]) > 0.0:
                            _candidate(ki, kf, s, p, pub, at, theta_j, atr_j)
                            acc[s, A_VOL] = 0
                            acc[s, A_BUY] = 0
                            acc[s, A_SELL] = 0
                        else:
                            acc[s, A_VOL] += size
                            acc[s, A_BUY] += buy
                            acc[s, A_SELL] += sell
                            if sign * (p - kf[s, K_OPP]) < 0.0:
                                kf[s, K_OPP] = p
                            reversal = _reversal(mode, sign, kf[s, K_PX], p)
                            if confirmed < 0 and reversal >= kf[s, K_THETA]:
                                confirmed = s
            else:
                s = 0 if g[G_DIR] > 0 else 1
                sign = 1.0 - 2.0 * s
                if sign * (p - kf[s, K_PX]) > 0.0:  # a strict new extreme: the leg grows
                    acc[0, A_VOL] += acc[1, A_VOL] + size
                    acc[0, A_BUY] += acc[1, A_BUY] + buy
                    acc[0, A_SELL] += acc[1, A_SELL] + sell
                    acc[1, A_VOL] = 0
                    acc[1, A_BUY] = 0
                    acc[1, A_SELL] = 0
                    _candidate(ki, kf, s, p, pub, at, theta_j, atr_j)
                else:
                    acc[1, A_VOL] += size
                    acc[1, A_BUY] += buy
                    acc[1, A_SELL] += sell
                    if sign * (p - kf[s, K_OPP]) < 0.0:
                        kf[s, K_OPP] = p
                    if _reversal(mode, sign, kf[s, K_PX], p) >= kf[s, K_THETA]:
                        confirmed = s
            if confirmed >= 0:
                s = confirmed
                sign = 1.0 - 2.0 * s
                ext, atr, theta = kf[s, K_PX], kf[s, K_ATR], kf[s, K_THETA]
                _event(ev_i, ev_f, ne, HIGH + s, j, at, g)
                ev_i[ne, E_EXT_ORD] = ki[s, K_ORD]
                ev_i[ne, E_EXT_AT] = ki[s, K_AT]
                ev_f[ne, X_LEVEL] = ext
                ev_f[ne, X_THETA] = theta
                ev_f[ne, X_ATR] = atr
                ev_f[ne, X_OVER] = _reversal(mode, sign, ext, p) / theta
                if ci[s, C_HAS] == 1:  # against the previous pivot of its kind
                    diff = ext - cf[s, C_PX]
                    cls = 1 if diff > 0.0 else (-1 if diff < 0.0 else 0)
                    run_ = ci[s, C_RUN]
                    if cls == 0:
                        run_ = 0
                    elif run_ * cls > 0:
                        run_ += cls
                    else:
                        run_ = cls
                    ci[s, C_CLS_HAS] = 1
                    ci[s, C_CLS] = cls
                    ci[s, C_RUN] = run_
                    cf[s, C_CHANGE] = diff / atr
                    ev_i[ne, E_CLS] = cls
                    ev_i[ne, E_RUN] = run_
                    ev_f[ne, X_CHANGE] = diff / atr
                if g[G_LEG_HAS] == 1:  # the completed leg, through its extreme
                    leg = sign * (ext - gf[F_LEG_PX])
                    ev_f[ne, X_LEG] = leg / atr
                    ev_i[ne, E_LEG_ROWS] = ki[s, K_ORD] - g[G_LEG_ORD] + 1
                    ev_i[ne, E_LEG_VOL] = acc[0, A_VOL]
                    ev_i[ne, E_LEG_BUY] = acc[0, A_BUY]
                    ev_i[ne, E_LEG_SELL] = acc[0, A_SELL]
                    gf[F_PREV_SIZE] = leg
                    gf[F_PREV_ATR] = leg / atr
                    g[G_PREV_HAS] = 1
                ci[s, C_HAS] = 1
                ci[s, C_EXT_ORD] = ki[s, K_ORD]
                ci[s, C_EXT_AT] = ki[s, K_AT]
                ci[s, C_CONF_ORD] = pub
                ci[s, C_SEQ] = ev_i[ne, E_SEQ]
                ci[s, C_BREACH] = 0
                cf[s, C_PX] = ext
                cf[s, C_ATR] = atr
                if ci[0, C_CLS_HAS] == 1 and ci[1, C_CLS_HAS] == 1:
                    trend = 0
                    if ci[0, C_CLS] > 0 and ci[1, C_CLS] > 0:
                        trend = 1
                    elif ci[0, C_CLS] < 0 and ci[1, C_CLS] < 0:
                        trend = -1
                    if g[G_TREND_HAS] == 0 or g[G_TREND] != trend:
                        g[G_TREND_ORD] = pub
                    g[G_TREND_HAS] = 1
                    g[G_TREND] = trend
                    ev_i[ne, E_TREND] = trend
                ne += 1
                # The new leg starts at this extreme with the observations since it, and its
                # running extreme is the confirming observation.
                g[G_LEG_HAS] = 1
                g[G_LEG_ORD] = ki[s, K_ORD]
                gf[F_LEG_PX] = ext
                since = s if seeking else 1
                acc[0, A_VOL] = acc[since, A_VOL]
                acc[0, A_BUY] = acc[since, A_BUY]
                acc[0, A_SELL] = acc[since, A_SELL]
                acc[1, A_VOL] = 0
                acc[1, A_BUY] = 0
                acc[1, A_SELL] = 0
                _candidate(ki, kf, 1 - s, p, pub, at, theta_j, atr_j)
                g[G_DIR] = -1 if s == 0 else 1
                g[G_MODE] = ACTIVE
            gf[F_LAST] = p
            g[G_HAS_LAST] = 1
        if r_emit[j]:
            _publish(mode, step, pub, g, gf, ki, kf, ci, cf, acc, out[k])
            k += 1
    return ne


class Detector:
    """One scale's swing state. `advance` processes a chunk and returns the published rows
    (`NO` floats each, NaN undefined) and the events (integers with `NONE`, floats with NaN)."""

    STATE = ("g", "gf", "ki", "kf", "ci", "cf", "acc")

    def __init__(self, mode: int, window: int, step: int):
        self.mode, self.window, self.step = mode, window, step
        self.g = np.zeros(NG, np.int64)
        self.g[G_BLOCKED] = self.g[G_SEQ_ORD] = NONE
        self.gf = np.zeros(NF)
        self.ki, self.kf = np.zeros((2, NKI), np.int64), np.zeros((2, NKF))
        self.ci, self.cf = np.zeros((2, NCI), np.int64), np.zeros((2, NCF))
        self.acc = np.zeros((2, NA), np.int64)

    def advance(self, obs: dict, rows: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        n = len(obs["value"])
        out = np.empty((int(rows["emit"].sum()), NO))
        ev_i, ev_f = np.empty((3 * n + 1, NEI), np.int64), np.empty((3 * n + 1, NEF))
        ne = run(
            self.mode, self.window, self.step, obs["value"], obs["row"], obs["at"], obs["size"],
            obs["side"], rows["missing"], rows["theta"], rows["atr"], rows["group"], rows["pub"],
            rows["emit"], self.g, self.gf, self.ki, self.kf, self.ci, self.cf, self.acc, out,
            ev_i, ev_f,
        )  # fmt: skip
        return out, ev_i[:ne], ev_f[:ne]


def released(chunk, context, products: dict) -> dict:
    """The chunk's accepted trades in the engine's release order (by assigned second, then
    receive order: `bars.aggregate`, the same call that builds `bar_1s`), with the index of each
    trade's second row. Computed once per chunk and shared by every scale."""
    if "released" not in products:
        ends = context.calendar.slot_ends(chunk.start, chunk.end, SECOND)
        agg = aggregate(
            chunk.trades,
            ends,
            SECOND,
            chunk.coverage,
            feed_latency=context.feed_latency,
            close_delay=context.close_delay,
        )
        t = chunk.trades
        products["released"] = {
            "value": t.price[agg.order].astype(np.float64),  # fixed point, exact below 2**53
            "row": np.searchsorted(ends, agg.slot_end).astype(np.int64),
            "at": agg.at.astype(np.int64),
            "size": t.size[agg.order].astype(np.int64),
            "side": t.side[agg.order].astype(np.int64),
            "ends": ends,
        }
    return products["released"]


def as_float(table: Table, name: str) -> np.ndarray:
    """A stored column as floats, NaN where it is NULL."""
    values = table.values[name].astype(np.float64)
    null = table.nulls.get(name)
    return values if null is None else np.where(null, np.nan, values)


PRICE_NOTE = "Databento fixed-point price (1e-9); never a model input"
SIDES = (("high", "above", "lower high"), ("low", "below", "higher low"))


def side_columns(kind: str, beyond: str, provisional: str):
    """The stored columns about the latest confirmed pivot of one kind, as (column, out index)."""
    base = O_SIDE + (0 if kind == "high" else NS_)
    inside = f"{kind} - price" if kind == "high" else f"price - {kind}"
    older = "previous one of its kind in the segment"
    return (
        (
            Column(
                f"{kind}_dist_atr",
                DOUBLE,
                f"Latest confirmed {kind}: {inside} at the last observation, in the ATR frozen "
                f"with that {kind}; negative once price is {beyond} it",
                Unit.ATR.value,
            ),
            base + S_DIST,
        ),
        (
            Column(
                f"{kind}_change_atr",
                DOUBLE,
                f"Latest confirmed {kind} minus the {older}, in the newer one's frozen ATR",
                Unit.ATR.value,
            ),
            base + S_CHANGE,
        ),
        (
            Column(
                f"{kind}_run_ratio",
                DOUBLE,
                f"Run of consecutive higher (+) or lower (-) {kind}s, clipped to +-{RUN_CAP} and "
                f"divided by {RUN_CAP}; 0 after an equal one",
                Unit.RATIO.value,
            ),
            base + S_RUN,
        ),
        (
            Column(
                f"{kind}_age_s",
                INTEGER,
                f"Scheduled-open seconds (rows) since the latest confirmed {kind} traded",
                Unit.SECONDS.value,
            ),
            base + S_AGE,
        ),
        (
            Column(
                f"{kind}_conf_age_s",
                INTEGER,
                f"Scheduled-open seconds (rows) since the latest {kind} was confirmed",
                Unit.SECONDS.value,
            ),
            base + S_CONF_AGE,
        ),
        (
            Column(
                f"break_{'up' if kind == 'high' else 'down'}_age_s",
                INTEGER,
                f"Scheduled-open seconds (rows) since the first observation strictly {beyond} "
                f"the latest confirmed {kind}; NULL while it holds",
                Unit.SECONDS.value,
            ),
            base + S_BREAK_AGE,
        ),
        (
            Column(
                f"{kind}_class",
                SMALLINT,
                f"Latest confirmed {kind} against the {older}: 1 higher, -1 lower, 0 equal",
                Unit.RATIO.value,
            ),
            base + S_CLS,
        ),
        (
            Column(
                f"prov_{''.join(w[0] for w in provisional.split())}",
                SMALLINT,
                f"1 while the open leg's candidate is a provisional {provisional}: not beyond "
                f"the latest confirmed {kind}, with 0 < progress < 1; NULL without that {kind}",
                Unit.FLAG.value,
            ),
            base + S_PROV,
        ),
    )


def dense_columns() -> tuple[tuple[Column, int], ...]:
    """Stored columns of a price swing stage's rows with their `out` index, ordered by width.
    Raw levels are context, never features."""
    ext = Column("ext_px", BIGINT, f"The open leg's running extreme, {PRICE_NOTE}")
    sides = tuple(pair for side in SIDES for pair in side_columns(*side))
    columns = (
        (ext, O_EXT),
        (
            Column(
                "progress",
                DOUBLE,
                "Largest reversal since the open leg's running extreme / theta, 0..1 (1 would "
                "confirm it)",
                Unit.RATIO.value,
            ),
            O_PROGRESS,
        ),
        (
            Column(
                "theta_bps",
                DOUBLE,
                "Reversal that confirms the running extreme, frozen when it was set: "
                "max(k x ATR, floor x spread)",
                Unit.BPS.value,
            ),
            O_THETA,
        ),
        (
            Column(
                "ext_dist_atr",
                DOUBLE,
                "Last observation's distance from the running extreme, in the ATR frozen with it",
                Unit.ATR.value,
            ),
            O_EXT_DIST,
        ),
        (
            Column(
                "leg_atr",
                DOUBLE,
                "Open leg: from the pivot that started it to its running extreme, in the "
                "extreme's frozen ATR",
                Unit.ATR.value,
            ),
            O_LEG,
        ),
        (
            Column(
                "leg_delta_ratio",
                DOUBLE,
                "(Buyer - seller aggressor volume) / sided volume of the open leg through its "
                "running extreme, -1..1",
                Unit.RATIO.value,
            ),
            O_LEG_DELTA,
        ),
        (
            Column(
                "reversal_delta_ratio",
                DOUBLE,
                "(Buyer - seller aggressor volume) / sided volume since the running extreme, -1..1",
                Unit.RATIO.value,
            ),
            O_REV_DELTA,
        ),
        (
            Column(
                "prev_leg_atr",
                DOUBLE,
                "The last completed leg, in the ATR frozen with the extreme that ended it",
                Unit.ATR.value,
            ),
            O_PREV_LEG,
        ),
        (
            Column(
                "retrace",
                DOUBLE,
                "Open leg / the last completed leg (above 1: beyond where that leg began)",
                Unit.RATIO.value,
            ),
            O_RETRACE,
        ),
        (
            Column(
                "cand_change_atr",
                DOUBLE,
                "Running extreme minus the latest confirmed pivot of its kind, in the "
                "extreme's frozen ATR: above 0 a higher high or higher low so far",
                Unit.ATR.value,
            ),
            O_CAND_CHANGE,
        ),
        *(p for p in sides if p[0].sql == DOUBLE),
        (Column("segment", INTEGER, "Counter of the stage's segments, from the span start"), O_SEG),
        (
            Column(
                "ext_age_s",
                INTEGER,
                "Scheduled-open seconds (rows) since the running extreme was set",
                Unit.SECONDS.value,
            ),
            O_EXT_AGE,
        ),
        (
            Column(
                "leg_age_s",
                INTEGER,
                "Scheduled-open seconds (rows) since the pivot that started the open leg",
                Unit.SECONDS.value,
            ),
            O_LEG_AGE,
        ),
        (
            Column(
                "trend_age_s",
                INTEGER,
                "Scheduled-open seconds (rows) since trend took its value",
                Unit.SECONDS.value,
            ),
            O_TREND_AGE,
        ),
        *(p for p in sides if p[0].sql == INTEGER),
        (
            Column(
                "state",
                SMALLINT,
                "0 idle (missing data or undefined threshold inputs), 1 segment open and "
                "direction unknown, 2 in a leg",
            ),
            O_STATE,
        ),
        (
            Column(
                "dir",
                SMALLINT,
                "Open leg: 1 up (tracking a running high), -1 down (a running low)",
                Unit.RATIO.value,
            ),
            O_DIR,
        ),
        (
            Column(
                "trend",
                SMALLINT,
                "1 after a higher high and a higher low, -1 after a lower high and a lower "
                "low, 0 other known pairs; NULL until both are classified",
                Unit.RATIO.value,
            ),
            O_TREND,
        ),
        *(p for p in sides if p[0].sql == SMALLINT),
    )
    return columns


KEY_COLUMNS = (
    Column("slot_ordinal", BIGINT, "Index counter of the published row"),
    Column("end_ns", BIGINT, "Row end, UTC ns"),
)


def dense_table(
    spec: tuple[tuple[Column, int], ...], ordinal: np.ndarray, end: np.ndarray, out: np.ndarray
) -> Table:
    """Published rows as a stage table: NaN stays behind NULL floats, integers get 0."""
    values: dict[str, np.ndarray] = {"slot_ordinal": ordinal, "end_ns": end}
    nulls: dict[str, np.ndarray] = {}
    for column, index in spec:
        x = out[:, index]
        null = np.isnan(x)
        if column.sql == DOUBLE:
            values[column.name] = x.copy()
        else:
            values[column.name] = np.where(null, 0.0, x).astype(np.int64)
        if column.name != "state":
            nulls[column.name] = null
    return Table(values, nulls)


EVENT_KINDS = "1 high, 2 low, 3 break_up, 4 break_down, 5 reclaim_high, 6 reclaim_low"
EVENT_COLUMNS: tuple[Column, ...] = (
    Column("slot_ordinal", BIGINT, "Index counter of the row of the observation that made it"),
    Column("end_ns", BIGINT, "End of that row, UTC ns"),
    Column("at_ns", BIGINT, "Time of that observation (a trade's assignment time), UTC ns"),
    Column("available_ns", BIGINT, "When the row was published: its end plus the close delay"),
    Column("ext_ordinal", BIGINT, "Pivot: index counter of the row of its extreme"),
    Column("ext_at_ns", BIGINT, "Pivot: time of the extreme observation, UTC ns"),
    Column("ref_ordinal", BIGINT, "Breach or reclaim: slot_ordinal of the pivot event it is about"),
    Column("leg_volume", BIGINT, "Pivot: contracts traded in the leg it ended"),
    Column("leg_buy_volume", BIGINT, "Pivot: buyer-aggressor volume in that leg"),
    Column("leg_sell_volume", BIGINT, "Pivot: seller-aggressor volume in that leg"),
    Column("level", DOUBLE, "The pivot's level, or the level breached or reclaimed (source units)"),
    Column("theta", DOUBLE, "Pivot: the frozen threshold it was confirmed with (bps, or points)"),
    Column("atr", DOUBLE, "ATR snapshot of the pivot (the referred pivot's), in level units"),
    Column("overshoot", DOUBLE, "Pivot: reversal at the confirming observation / theta, >= 1"),
    Column("change_atr", DOUBLE, "Pivot: level minus the previous one of its kind, in its ATR"),
    Column("leg_atr", DOUBLE, "Pivot: the leg it ended, in its ATR"),
    Column(
        "depth_atr",
        DOUBLE,
        "Breach: distance beyond the level; reclaim: the deepest observation beyond it from the "
        "breach through the reclaim; in the referred pivot's ATR",
    ),
    Column("segment", INTEGER, "Segment counter of the stage"),
    Column("leg_rows", INTEGER, "Pivot: rows of the leg it ended, both extremes included"),
    Column("age_s", INTEGER, "Reclaim: scheduled-open seconds (rows) since the breach"),
    Column("seq", SMALLINT, "Order of the scale's events within the row, from 0"),
    Column("kind", SMALLINT, EVENT_KINDS),
    Column("ref_seq", SMALLINT, "Breach or reclaim: seq of the pivot event it refers to"),
    Column("class", SMALLINT, "Pivot: 1 higher, -1 lower, 0 equal; NULL for the first of its kind"),
    Column("run", SMALLINT, "Pivot: consecutive higher (+n) or lower (-n) pivots of its kind"),
    Column("trend", SMALLINT, "Trend after the event (a breach or reclaim does not change it)"),
)
EVENT_SOURCE = {  # column: (integer array?, index)
    "slot_ordinal": (True, E_ORD),
    "at_ns": (True, E_AT),
    "ext_ordinal": (True, E_EXT_ORD),
    "ext_at_ns": (True, E_EXT_AT),
    "ref_ordinal": (True, E_REF_ORD),
    "leg_volume": (True, E_LEG_VOL),
    "leg_buy_volume": (True, E_LEG_BUY),
    "leg_sell_volume": (True, E_LEG_SELL),
    "level": (False, X_LEVEL),
    "theta": (False, X_THETA),
    "atr": (False, X_ATR),
    "overshoot": (False, X_OVER),
    "change_atr": (False, X_CHANGE),
    "leg_atr": (False, X_LEG),
    "depth_atr": (False, X_DEPTH),
    "segment": (True, E_SEG),
    "leg_rows": (True, E_LEG_ROWS),
    "age_s": (True, E_AGE),
    "seq": (True, E_SEQ),
    "kind": (True, E_KIND),
    "ref_seq": (True, E_REF_SEQ),
    "class": (True, E_CLS),
    "run": (True, E_RUN),
    "trend": (True, E_TREND),
}
EVENT_ALWAYS = frozenset({"slot_ordinal", "end_ns", "at_ns", "available_ns", "segment", "seq"})


def event_table(ev_i: np.ndarray, ev_f: np.ndarray, end: np.ndarray, close_delay: int) -> Table:
    """Events as a table; `end` is the end of each event's published row."""
    values: dict[str, np.ndarray] = {"end_ns": end, "available_ns": end + close_delay}
    nulls: dict[str, np.ndarray] = {}
    for name, (integer, index) in EVENT_SOURCE.items():
        x = ev_i[:, index] if integer else ev_f[:, index]
        null = x == NONE if integer else np.isnan(x)
        values[name] = np.where(null, 0, x) if integer else x.copy()
        if name not in EVENT_ALWAYS and name != "kind":
            nulls[name] = null
    return Table(values, nulls)


def is_warm(out: np.ndarray) -> bool:
    """Every published row had a confirmed high and a confirmed low of its segment."""
    high, low = out[:, O_SIDE + S_AGE], out[:, O_SIDE + NS_ + S_AGE]
    return bool(len(out)) and bool(np.isfinite(high).all() and np.isfinite(low).all())
