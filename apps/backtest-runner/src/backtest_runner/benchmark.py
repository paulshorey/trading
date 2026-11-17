"""The pivot benchmark, under the rules frozen in docs/project/pivot-label-spec.md.

    uv run research benchmark detectors GC SI   # A: detectors against hindsight reference swings
    uv run research benchmark models GC SI      # B: logistic regression against boosted trees

Both read stored rows of front-contract sessions in the development period and store nothing.
Trade dates from `HOLDOUT` on are refused: the newest data stays untouched until a later,
predeclared evaluation.

A. Reference swings are defined in hindsight from the base rows, without any detector. Each
   detector gives alarms (kind, the row at which it is known, the row it claims as the extreme),
   scored for coverage, delay, location error, and false alarms per open hour.
B. Candidates (`market.pivot_label_*`) joined to the features of their decision row; walk-forward
   folds by calendar month, with the session before each test block left out.
"""

import math
import sys
from datetime import date, timedelta

import numpy as np
import psycopg
from numba import njit
from psycopg import sql
from strategy_core.pipeline import StageFeatures
from strategy_core.stage_pivot_1m import SCALES as SLOW_SCALES
from strategy_core.stage_pivot_1s import SCALES as FAST_SCALES
from strategy_core.stage_pivot_label import FAST_LABELS, INVALIDATION, REVERSAL, SLOW_LABELS

from . import db, store

DEV_START, DEV_END = date(2026, 1, 2), date(2026, 8, 31)
HOLDOUT = date(2026, 9, 1)  # from here on: not read
TEST_MONTHS = (5, 6, 7, 8)  # of 2026: one walk-forward test block each
HIGH, LOW = 1, 2
MISSING, OBSERVED = 0, 2  # `status` of a base row
STREAMS = {
    "fast": {
        "base": "bar_1s",
        "candle": "candle_1m_1s",
        "seconds": 1,
        "window": 300,
        "tolerance": 5,
        "fractal": (30, 120),
        "slope": (60, 300),
        "tasks": {"F1": 1.0, "F2": 2.0},
        "scales": FAST_SCALES,
        "features": ("candle_1m_1s", "vol_1s"),
        "labels": FAST_LABELS,
    },
    "slow": {
        "base": "bar_1m",
        "candle": "candle_1h_1m",
        "seconds": 60,
        "window": 240,
        "tolerance": 2,
        "fractal": (15, 60),
        "slope": (30, 120),
        "tasks": {"S1": 1.0, "S2": 2.0},
        "scales": SLOW_SCALES,
        "features": ("candle_1h_1m", "stats_1h_1m", "vol_1m"),
        "labels": SLOW_LABELS,
    },
}
CUSUM_ALLOWANCE, CUSUM_THRESHOLD = 0.05, 1.0  # in ATRs of the previous row
ATR_LIMIT = 50.0  # rows with a larger `*_atr` input are excluded and counted
NULL_SHARE = 0.01  # features NULL more often than this on the first training rows are dropped
TRAIN_CAP, SEED, RESAMPLES = 400_000, 0, 1000
MIN_TRAIN = 500  # rows of each class a model needs


def stderr(line: str) -> None:
    print(line, file=sys.stderr, flush=True)


def check_period(start: date, end: date) -> None:
    if end >= HOLDOUT:
        raise ValueError(
            f"Trade dates from {HOLDOUT} on are the holdout; the benchmark stops before"
        )
    if start < DEV_START:
        raise ValueError(f"The development period starts {DEV_START}; start is before it")
    if start > end:
        raise ValueError("end is before start")


# A. Detectors --------------------------------------------------------------------------------


@njit(cache=True)
def reference_swings(high, low, observed, missing, atr, window, multiple):
    """Hindsight reference swings of one session: rows whose high is the highest of the
    `window` rows on each side (the first such row on ties) with a rise to it and a fall from it
    of at least `multiple` ATRs (log bps; the ATR of the row before); lows mirror. Returns the
    kinds, the rows, and the rows eligible to hold one (whole window in the session, no missing
    row in it, ATR defined)."""
    n = len(high)
    gaps = np.zeros(n + 1, np.int64)
    for i in range(n):
        gaps[i + 1] = gaps[i] + (1 if missing[i] else 0)
    eligible = np.zeros(n, np.bool_)
    kinds, rows = [], []
    for i in range(window, n - window):
        if gaps[i + window + 1] - gaps[i - window] > 0:
            continue
        need = multiple * atr[i - 1]
        if not need > 0.0:
            continue
        eligible[i] = True
        if not observed[i]:
            continue
        top, ok, before, after = high[i], True, low[i], low[i]
        for j in range(i - window, i):
            if high[j] >= top:
                ok = False
                break
            before = min(before, low[j])
        if ok:
            for j in range(i + 1, i + window + 1):
                if high[j] > top:
                    ok = False
                    break
                after = min(after, low[j])
        if ok and 1e4 * np.log(top / before) >= need and 1e4 * np.log(top / after) >= need:
            kinds.append(HIGH)
            rows.append(i)
        bottom, ok, before, after = low[i], True, high[i], high[i]
        for j in range(i - window, i):
            if low[j] <= bottom:
                ok = False
                break
            before = max(before, high[j])
        if ok:
            for j in range(i + 1, i + window + 1):
                if low[j] < bottom:
                    ok = False
                    break
                after = max(after, high[j])
        if ok and 1e4 * np.log(before / bottom) >= need and 1e4 * np.log(after / bottom) >= need:
            kinds.append(LOW)
            rows.append(i)
    return np.array(kinds, np.int64), np.array(rows, np.int64), eligible


@njit(cache=True)
def fractal_alarms(high, low, observed, n):
    """Fixed left/right extrema: the strict first maximum (minimum) of rows i - n ... i + n,
    known at i + n. Returns kinds, known rows, claimed rows."""
    kinds, known, claimed = [], [], []
    size = len(high)
    for i in range(n, size - n):
        if not observed[i]:
            continue
        ok = True
        for j in range(i - n, i):
            if high[j] >= high[i]:
                ok = False
                break
        if ok:
            for j in range(i + 1, i + n + 1):
                if high[j] > high[i]:
                    ok = False
                    break
        if ok:
            kinds.append(HIGH)
            known.append(i + n)
            claimed.append(i)
        ok = True
        for j in range(i - n, i):
            if low[j] <= low[i]:
                ok = False
                break
        if ok:
            for j in range(i + 1, i + n + 1):
                if low[j] < low[i]:
                    ok = False
                    break
        if ok:
            kinds.append(LOW)
            known.append(i + n)
            claimed.append(i)
    return np.array(kinds, np.int64), np.array(known, np.int64), np.array(claimed, np.int64)


@njit(cache=True)
def slope_alarms(close, valid, high, low, n):
    """Slope sign: the least-squares slope of the carried close over the trailing `n` rows; a
    high when it turns from positive to negative, claiming the highest high of those rows; lows
    mirror. The sign is unknown again after a row without a price."""
    kinds, known, claimed = [], [], []
    size = len(close)
    run = 0  # consecutive valid rows
    sign = 0
    mid = (n - 1) / 2.0
    for t in range(size):
        if not valid[t]:
            run, sign = 0, 0
            continue
        run += 1
        if run < n:
            continue
        s = 0.0
        for k in range(n):
            s += (k - mid) * close[t - n + 1 + k]
        now = 1 if s > 0.0 else (-1 if s < 0.0 else sign)
        if sign == 1 and now == -1:
            best = t - n + 1
            for j in range(t - n + 1, t + 1):
                if high[j] > high[best]:
                    best = j
            kinds.append(HIGH)
            known.append(t)
            claimed.append(best)
        elif sign == -1 and now == 1:
            best = t - n + 1
            for j in range(t - n + 1, t + 1):
                if low[j] < low[best]:
                    best = j
            kinds.append(LOW)
            known.append(t)
            claimed.append(best)
        sign = now
    return np.array(kinds, np.int64), np.array(known, np.int64), np.array(claimed, np.int64)


@njit(cache=True)
def cusum_alarms(close, valid, atr, allowance, threshold):
    """Two one-sided sums of one-row log returns in ATRs of the previous row; a high when the
    downward sum reaches the threshold, claiming the row before it last left zero; lows mirror.
    Both sums restart at an alarm and at a row without a price or an ATR."""
    kinds, known, claimed = [], [], []
    down = up = 0.0
    down_from = up_from = 0
    for t in range(1, len(close)):
        if not (valid[t] and valid[t - 1] and atr[t - 1] > 0.0):
            down = up = 0.0
            continue
        r = 1e4 * np.log(close[t] / close[t - 1]) / atr[t - 1]
        step = down - r - allowance
        if step <= 0.0:
            down = 0.0
        else:
            if down == 0.0:
                down_from = t
            down = step
        step = up + r - allowance
        if step <= 0.0:
            up = 0.0
        else:
            if up == 0.0:
                up_from = t
            up = step
        if down >= threshold:
            kinds.append(HIGH)
            known.append(t)
            claimed.append(down_from - 1)
            down = up = 0.0
        elif up >= threshold:
            kinds.append(LOW)
            known.append(t)
            claimed.append(up_from - 1)
            down = up = 0.0
    return np.array(kinds, np.int64), np.array(known, np.int64), np.array(claimed, np.int64)


@njit(cache=True)
def match(reference, known, claimed, window, tolerance):
    """One kind's reference rows against its alarms (sorted by the row they are known at). A
    swing at row i is found by the earliest unused alarm known in rows i ... i + window that
    claims a row within `tolerance` of i. Returns per swing the delay (-1: not found) and the
    location error of the earliest alarm in that window (-1: none), and per alarm whether it
    found a swing."""
    used = np.zeros(len(known), np.bool_)
    delay = np.full(len(reference), -1, np.int64)
    error = np.full(len(reference), -1, np.int64)
    for r in range(len(reference)):
        i = reference[r]
        a = np.searchsorted(known, i)
        first = True
        while a < len(known) and known[a] <= i + window:
            if first:
                error[r] = abs(claimed[a] - i)
                first = False
            if not used[a] and abs(claimed[a] - i) <= tolerance:
                used[a] = True
                delay[r] = known[a] - i
                break
            a += 1
    return delay, error, used


class Tally:
    """Scores of one detector on one task and product."""

    def __init__(self):
        self.swings = self.found = self.alarms = self.false = 0
        self.rows = 0  # eligible rows
        self.delay: list[np.ndarray] = []
        self.error: list[np.ndarray] = []

    def add(self, kinds, rows, eligible, alarms, window, tolerance, only=None):
        """Score one session; `only` restricts the tally to one kind (highs or lows)."""
        a_kind, a_known, a_claim = alarms
        self.rows += int(eligible.sum())
        for kind in (only,) if only else (HIGH, LOW):
            ref = rows[kinds == kind]
            pick = a_kind == kind
            known, claim = a_known[pick], a_claim[pick]
            order = np.argsort(known, kind="stable")
            known, claim = known[order], claim[order]
            delay, error, used = match(ref, known, claim, window, tolerance)
            inside = (claim >= 0) & (claim < len(eligible))
            scored = np.zeros(len(claim), bool)
            scored[inside] = eligible[claim[inside]]  # it claims a row that could hold a swing
            self.swings += len(ref)
            self.found += int((delay >= 0).sum())
            self.alarms += int(scored.sum())
            self.false += int((scored & ~used).sum())
            self.delay.append(delay[delay >= 0])
            self.error.append(error[error >= 0])

    @classmethod
    def pool(cls, parts, rows: int) -> "Tally":
        """The sum of tallies; `rows` is the eligible rows of the pooled sample, since the
        parts may count the same rows (one tally per kind)."""
        total = cls()
        for t in parts:
            total.swings += t.swings
            total.found += t.found
            total.alarms += t.alarms
            total.false += t.false
            total.delay += t.delay
            total.error += t.error
        total.rows = rows
        return total

    def report(self, seconds: int) -> dict:
        hours = self.rows * seconds / 3600
        delay = np.concatenate(self.delay) if self.delay else np.zeros(0)
        error = np.concatenate(self.error) if self.error else np.zeros(0)

        def q(x, p):
            return float(np.percentile(x, p)) if len(x) else None

        return {
            "eligible_hours": round(hours, 1),
            "swings": self.swings,
            "swings_per_hour": round(self.swings / hours, 3) if hours else None,
            "alarms_per_hour": round(self.alarms / hours, 3) if hours else None,
            "coverage": round(self.found / self.swings, 4) if self.swings else None,
            "precision": round(self.found / (self.found + self.false), 4)
            if self.found + self.false
            else None,
            "false_alarms_per_hour": round(self.false / hours, 3) if hours else None,
            "delay_rows_median": q(delay, 50),
            "delay_rows_p90": q(delay, 90),
            "location_error_rows_median": q(error, 50),
            "location_error_rows_p90": q(error, 90),
        }


def variant_ids(conn: psycopg.Connection) -> dict[tuple[str, str], int]:
    return {
        (stage, name): int(vid)
        for stage, name, vid in conn.execute(
            "SELECT stage, name, id FROM market.variant WHERE retired_at IS NULL"
        )
    }


def front_sessions(conn, product: str, start: date, end: date, stages: list[tuple[str, int]]):
    """Front sessions of the period with stored rows, and whether every named stage (table,
    variant id) was warm in each."""
    rows = conn.execute(
        """SELECT f.trade_date, f.contract_id, f.first_ordinal, f.last_ordinal, f.open_ns,
                  f.close_ns,
                  (SELECT count(*) FILTER (WHERE s.warm) FROM market.stage_slice s
                   WHERE s.contract_id = f.contract_id AND s.trade_date = f.trade_date
                     AND (s.stage, s.variant_id) IN
                         (SELECT * FROM unnest(%s::text[], %s::bigint[])))
           FROM market.front_session f
           WHERE f.product = %s AND f.trade_date BETWEEN %s AND %s AND f.first_ordinal IS NOT NULL
           ORDER BY 1""",
        ([s for s, _ in stages], [v for _, v in stages], product, start, end),
    ).fetchall()
    return [(*r[:6], r[6] == len(stages)) for r in rows]


def intervals(end_s: np.ndarray, seconds: int) -> list[tuple[int, int]]:
    """Runs of consecutive rows: a session holds one scheduled-open interval, or two around a
    break."""
    cuts = np.flatnonzero(np.diff(end_s) != seconds) + 1
    return list(zip(np.r_[0, cuts].tolist(), np.r_[cuts, len(end_s)].tolist(), strict=True))


def pooled_report(tally: dict, task: str, name: str, products: list[str], per: int) -> dict:
    """Per product and kind, the kinds pooled per product, and everything pooled."""
    out: dict = {}
    for p in products:
        high, low = tally[task, name, p, HIGH], tally[task, name, p, LOW]
        out[p] = {
            "high": high.report(per),
            "low": low.report(per),
            "both": Tally.pool([high, low], high.rows).report(per),
        }
    every = [tally[task, name, p, k] for p in products for k in (HIGH, LOW)]
    rows = sum(tally[task, name, p, HIGH].rows for p in products)
    out["all_products"] = Tally.pool(every, rows).report(per)
    return out


def detectors(products: list[str], start: date = DEV_START, end: date = DEV_END, url=None) -> dict:
    check_period(start, end)
    out: dict = {"period": [start.isoformat(), end.isoformat()], "tasks": {}, "sessions": {}}
    with db.connect(url) as conn:
        ids = variant_ids(conn)
        for stream, spec in STREAMS.items():
            per, window, tol = spec["seconds"], spec["window"], spec["tolerance"]
            table = store.STAGE_TABLE[spec["scales"][0].NAME]
            scales = {s.VARIANT: ids[table, s.VARIANT] for s in spec["scales"]}
            needed = [(spec["candle"], 0), *((table, v) for v in scales.values())]
            names = [
                *(f"dc_{name}" for name in scales),
                *(f"fractal_{n}" for n in spec["fractal"]),
                *(f"slope_{n}" for n in spec["slope"]),
                "cusum",
            ]
            tally = {
                (task, name, p, k): Tally()
                for task in spec["tasks"]
                for name in names
                for p in products
                for k in (HIGH, LOW)
            }
            for product in products:
                used = skipped = 0
                for _day, cid, first, last, open_ns, close_ns, warm in front_sessions(
                    conn, product, start, end, needed
                ):
                    if not warm:
                        skipped += 1
                        continue
                    used += 1
                    lo, hi = store.row_bounds(spec["base"], first, last)
                    rows = np.array(
                        conn.execute(
                            sql.SQL(
                                """SELECT b.slot_ordinal, b.end_ns / 1000000000, b.status, b.high,
                                          b.low, b.close, c.atr_bps
                                   FROM {} b JOIN {} c ON c.contract_id = b.contract_id
                                    AND c.slot_ordinal = b.slot_ordinal AND c.end_ns = b.end_ns
                                   WHERE b.contract_id = %s AND b.slot_ordinal BETWEEN %s AND %s
                                     AND b.end_ns > %s AND b.end_ns <= %s ORDER BY 1"""
                            ).format(
                                sql.Identifier("market", spec["base"]),
                                sql.Identifier("market", spec["candle"]),
                            ),
                            (cid, lo, hi, open_ns, close_ns),
                        ).fetchall(),
                        dtype=np.float64,
                    )
                    events = np.array(
                        conn.execute(
                            """SELECT variant_id, kind, slot_ordinal, ext_ordinal
                               FROM market.pivot_event WHERE contract_id = %s
                                AND end_ns > %s AND end_ns <= %s AND kind IN (1, 2)
                                AND variant_id = ANY(%s) ORDER BY slot_ordinal, seq""",
                            (cid, open_ns, close_ns, list(scales.values())),
                        ).fetchall(),
                        dtype=np.int64,
                    ).reshape(-1, 4)
                    for a, b in intervals(rows[:, 1], per):
                        part = rows[a:b]
                        origin = int(part[0, 0])
                        status = part[:, 2]
                        observed, missing = status == OBSERVED, status == MISSING
                        high = np.where(observed, part[:, 3], -np.inf)
                        low = np.where(observed, part[:, 4], np.inf)
                        atr = part[:, 6]
                        # the close carried through rows without trades, never across missing data
                        last_seen = np.maximum.accumulate(
                            np.where(observed | missing, np.arange(b - a), -1)
                        )
                        valid = (last_seen >= 0) & ~missing
                        valid &= observed[np.maximum(last_seen, 0)]
                        close = np.where(valid, part[np.maximum(last_seen, 0), 5], np.nan)
                        alarms = {}
                        inside = (events[:, 2] >= origin) & (events[:, 2] < origin + (b - a))
                        for name, vid in scales.items():
                            e = events[inside & (events[:, 0] == vid)]
                            alarms[f"dc_{name}"] = (e[:, 1], e[:, 2] - origin, e[:, 3] - origin)
                        for n in spec["fractal"]:
                            alarms[f"fractal_{n}"] = fractal_alarms(high, low, observed, n)
                        for n in spec["slope"]:
                            alarms[f"slope_{n}"] = slope_alarms(close, valid, high, low, n)
                        alarms["cusum"] = cusum_alarms(
                            close, valid, atr, CUSUM_ALLOWANCE, CUSUM_THRESHOLD
                        )
                        for task, multiple in spec["tasks"].items():
                            kinds, at, eligible = reference_swings(
                                high, low, observed, missing, atr, window, multiple
                            )
                            for name in names:
                                for k in (HIGH, LOW):
                                    tally[task, name, product, k].add(
                                        kinds, at, eligible, alarms[name], window, tol, only=k
                                    )
                out["sessions"][f"{stream} {product}"] = {"used": used, "not_warm": skipped}
            for task in spec["tasks"]:
                out["tasks"][task] = {
                    name: pooled_report(tally, task, name, products, per) for name in names
                }
    return out


# B. Models -----------------------------------------------------------------------------------


def load_candidates(conn, products, label, stream, start, end, ids) -> dict:
    """One label variant's candidates on warm front sessions with the features of their
    decision row. Columns: product index, days since 2000-01-01, kind, outcome, prov,
    displacement, then the features (NaN for NULL)."""
    spec = STREAMS[stream]
    scale = label.SCALE
    pivot = store.STAGE_TABLE[scale.NAME]
    tables = [*spec["features"], pivot]
    stages = [*spec["features"], scale.NAME]
    alias = [f"t{i}" for i in range(len(tables))]
    names = [f"{s}.{n}" for s in stages for n in StageFeatures.names(s)]
    select = [
        sql.SQL("{}.{}").format(sql.Identifier(a), sql.Identifier(n))
        for a, s in zip(alias, stages, strict=True)
        for n in StageFeatures.names(s)
    ]
    joins = [
        sql.SQL(
            "JOIN {} {a} ON {a}.contract_id = l.contract_id AND {a}.slot_ordinal = l.slot_ordinal "
            "AND {a}.end_ns = l.end_ns"
        ).format(sql.Identifier("market", t), a=sql.Identifier(a))
        for a, t in zip(alias, tables, strict=True)
    ]
    scale_id, label_id = ids[pivot, scale.VARIANT], ids[label.TABLE, label.VARIANT]
    per = spec["seconds"]
    query = sql.SQL(
        """SELECT f.trade_date - DATE '2000-01-01', l.kind, l.outcome, l.prov, l.displacement, {}
           FROM market.front_session f
           JOIN {} l ON l.contract_id = f.contract_id
            AND l.slot_ordinal BETWEEN (f.first_ordinal + {per} - 1) / {per}
                                   AND f.last_ordinal / {per}
            AND l.end_ns > f.open_ns AND l.end_ns <= f.close_ns
           {}
           WHERE f.product = %s AND f.trade_date = ANY(%s) AND l.variant_id = %s
             AND l.outcome <> 0 AND {}.variant_id = %s
           ORDER BY f.trade_date, l.contract_id, l.slot_ordinal, l.seq, l.end_ns"""
    ).format(
        sql.SQL(", ").join(select),
        sql.Identifier("market", label.TABLE),
        sql.SQL(" ").join(joins),
        sql.Identifier(alias[-1]),
        per=sql.Literal(per),
    )
    count = sql.SQL(
        """SELECT count(*) FROM market.front_session f
           JOIN {} l ON l.contract_id = f.contract_id
            AND l.slot_ordinal BETWEEN (f.first_ordinal + {per} - 1) / {per}
                                   AND f.last_ordinal / {per}
            AND l.end_ns > f.open_ns AND l.end_ns <= f.close_ns
           WHERE f.product = %s AND f.trade_date = ANY(%s) AND l.variant_id = %s
             AND l.outcome = 0"""
    ).format(sql.Identifier("market", label.TABLE), per=sql.Literal(per))
    needed = [*((t, 0) for t in spec["features"]), (pivot, scale_id)]
    parts, sessions, dates, resolved = [], {}, set(), 0
    for k, product in enumerate(products):
        found = front_sessions(conn, product, start, end, needed)
        warm = [s[0] for s in found if s[6]]
        sessions[product] = {"used": len(warm), "not_warm": len(found) - len(warm)}
        dates.update((d - date(2000, 1, 1)).days for d in warm)
        resolved += int(conn.execute(count, (product, warm, label_id)).fetchone()[0])
        with conn.cursor(name=f"candidates_{k}") as cur:
            cur.itersize = 20_000
            cur.execute(query, (product, warm, label_id, scale_id))
            while batch := cur.fetchmany(20_000):
                block = np.array(batch, dtype=np.float32)
                parts.append(np.column_stack([np.full(len(block), k, np.float32), block]))
        conn.rollback()
    width = 6 + len(names)
    data = np.concatenate(parts) if parts else np.zeros((0, width), np.float32)
    return {
        "data": data,
        "names": names,
        "sessions": sessions,
        "days": sorted(dates),  # every warm session, with or without a candidate
        "resolved_before_decision": resolved,
    }


def log_loss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def scores(y, p) -> dict:
    from sklearn.metrics import average_precision_score, roc_auc_score

    both = 0 < y.sum() < len(y)
    return {
        "log_loss": round(float(log_loss(y, p).mean()), 5),
        "brier": round(float(((p - y) ** 2).mean()), 5),
        "roc_auc": round(float(roc_auc_score(y, p)), 4) if both else None,
        "average_precision": round(float(average_precision_score(y, p)), 4) if both else None,
    }


def interval(delta, groups, rng) -> list[float]:
    """95% interval of the mean of `delta` from resampling whole sessions (`groups`)."""
    _, index = np.unique(groups, return_inverse=True)
    sums = np.bincount(index, weights=delta)
    counts = np.bincount(index)
    draw = rng.integers(0, len(sums), (RESAMPLES, len(sums)))
    means = sums[draw].sum(axis=1) / counts[draw].sum(axis=1)
    return [round(float(v), 5) for v in np.percentile(means, [2.5, 97.5])]


def evaluate(frame: dict, provisional: bool) -> dict:
    """Walk-forward comparison on one label variant's candidates (`load_candidates`)."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler

    data, names = frame["data"], frame["names"]
    product, day, kind = data[:, 0].astype(int), data[:, 1].astype(int), data[:, 2].astype(int)
    outcome, prov, disp = data[:, 3].astype(int), data[:, 4], data[:, 5].astype(np.float64)
    x = data[:, 6:]
    report: dict = {"candidates": len(data)}
    if "resolved_before_decision" in frame:  # outcome 0: observations, never targets
        report["resolved_before_decision"] = frame["resolved_before_decision"]
    keep = np.ones(len(data), bool)
    if provisional:
        keep &= prov == 1
        report["provisional"] = int(keep.sum())
    report["session_end"] = int((keep & (outcome == 4)).sum())
    report["unknown"] = int((keep & (outcome == 5)).sum())
    keep &= outcome <= 3
    atr = [j for j, n in enumerate(names) if n.endswith("_atr")]
    with np.errstate(invalid="ignore"):
        extreme = (np.abs(x[:, atr]) > ATR_LIMIT).any(axis=1)
    report["extreme_atr"] = int((keep & extreme).sum())
    keep &= ~extreme
    base = date(2000, 1, 1)
    blocks = []
    for month in TEST_MONTHS:
        lo = (date(2026, month, 1) - base).days
        hi = (date(2026 + month // 12, month % 12 + 1, 1) - base).days
        # the sessions before the block, as stored (not only those with a retained candidate)
        before = np.unique(np.asarray(frame.get("days", day[keep]), dtype=int))
        before = before[before < lo]
        if len(before) < 2:
            continue
        train = keep & (day < before[-1])  # the last session before the block is left out
        test = keep & (day >= lo) & (day < hi)
        blocks.append((month, train, test))
    if not blocks:
        return report | {"error": "no test block has training sessions before it"}
    with np.errstate(invalid="ignore"):
        share = np.isnan(x[blocks[0][1]]).mean(axis=0)
    used = np.flatnonzero(share <= NULL_SHARE)
    report["dropped_features"] = [names[j] for j in np.flatnonzero(share > NULL_SHARE)]
    report["features"] = len(used)
    complete = ~np.isnan(x[:, used]).any(axis=1)
    report["null_input"] = int((keep & ~complete).sum())
    keep &= complete
    finite = np.isfinite(disp)  # the random-walk baseline needs the stored displacement
    report["null_displacement"] = int((keep & ~finite).sum())
    keep &= finite
    y = (outcome == 1).astype(np.float64)
    null = (disp + INVALIDATION) / (REVERSAL + INVALIDATION)  # as frozen; the loss clips itself
    pred = {m: np.full(len(data), np.nan) for m in ("prior", "logistic", "boosted")}
    rng = np.random.default_rng(SEED)
    skipped = []
    for month, train, test in blocks:
        for k in (HIGH, LOW):
            tr = np.flatnonzero(train & keep & (kind == k))
            te = np.flatnonzero(test & keep & (kind == k))
            ones = int(y[tr].sum())
            if min(ones, len(tr) - ones) < MIN_TRAIN or not len(te):
                skipped.append({"month": month, "kind": k, "train": len(tr), "test": len(te)})
                continue
            if len(tr) > TRAIN_CAP:
                tr = np.sort(rng.choice(tr, TRAIN_CAP, replace=False))
            xt, xs = x[tr][:, used].astype(np.float64), x[te][:, used].astype(np.float64)
            pred["prior"][te] = y[tr].mean()
            scaler = StandardScaler().fit(xt)
            logistic = LogisticRegression(C=1.0, max_iter=500).fit(scaler.transform(xt), y[tr])
            pred["logistic"][te] = logistic.predict_proba(scaler.transform(xs))[:, 1]
            boosted = HistGradientBoostingClassifier(
                max_iter=300,
                learning_rate=0.05,
                max_leaf_nodes=31,
                min_samples_leaf=200,
                l2_regularization=1.0,
                early_stopping=False,
                random_state=SEED,
            ).fit(xt, y[tr])
            pred["boosted"][te] = boosted.predict_proba(xs)[:, 1]
    report["skipped_folds"] = skipped
    scored = np.isfinite(pred["boosted"])
    report["rows_scored"] = int(scored.sum())
    if not scored.any():
        return report | {"error": "no fold had enough training rows of both classes"}
    pred["random_walk"] = null
    groups = {"all": scored} | {p: scored & (product == k) for k, p in enumerate(frame["sessions"])}
    report["results"] = {}
    for name, rows in groups.items():
        if not rows.any():
            continue
        yy = y[rows]
        entry = {
            "rows": int(rows.sum()),
            "sessions": len(np.unique(product[rows] * 100_000 + day[rows])),
            "reversal_rate": round(float(yy.mean()), 4),
        } | {m: scores(yy, pred[m][rows]) for m in ("random_walk", "prior", "logistic", "boosted")}
        loss = {m: log_loss(yy, pred[m][rows]) for m in pred}
        session = product[rows] * 100_000 + day[rows]
        entry["log_loss_gain"] = {  # positive: the first is better
            f"{a}_over_{b}": {
                "mean": round(float((loss[b] - loss[a]).mean()), 5),
                "interval_95": interval(loss[b] - loss[a], session, np.random.default_rng(SEED)),
            }
            for a, b in (
                ("boosted", "random_walk"),
                ("logistic", "random_walk"),
                ("boosted", "logistic"),
                ("boosted", "prior"),
            )
        }
        entry["brier_skill_over_random_walk"] = {
            m: round(1 - entry[m]["brier"] / entry["random_walk"]["brier"], 4)
            for m in ("logistic", "boosted")
        }
        report["results"][name] = entry
    return report


def models(
    products: list[str],
    start: date = DEV_START,
    end: date = DEV_END,
    labels: list[str] | None = None,
    url=None,
    log=lambda line: None,
) -> dict:
    check_period(start, end)
    out: dict = {
        "period": [start.isoformat(), end.isoformat()],
        "test_months": [f"2026-{m:02d}" for m in TEST_MONTHS],
        "labels": {},
    }
    known = {v.VARIANT for s in STREAMS.values() for v in s["labels"]}
    if unknown := sorted(set(labels or ()) - known):
        raise ValueError(f"Unknown label variants {unknown}; known: {sorted(known)}")
    with db.connect(url) as conn:
        ids = variant_ids(conn)
        for stream, spec in STREAMS.items():
            for label in spec["labels"]:
                if labels and label.VARIANT not in labels:
                    continue
                frame = load_candidates(conn, products, label, stream, start, end, ids)
                log(f"{label.VARIANT}: {len(frame['data']):,} candidates")
                out["labels"][label.VARIANT] = {
                    "sessions": frame["sessions"],
                    "provisional": evaluate(frame, True),
                    "all_candidates": evaluate(frame, False),
                }
                log(f"{label.VARIANT}: done")
    return out


def month_end(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1) - timedelta(days=1)


assert month_end(date(2026, TEST_MONTHS[-1], 1)) == DEV_END  # the last test block ends the period
assert math.isclose(REVERSAL, 1.0) and math.isclose(INVALIDATION, 0.25)  # as frozen in the spec
