"""Outcome labels of swing candidates (docs/project/pivot-label-spec.md; plan-1h-and-pivots.md,
section 3.5). Labels look into the future: they are stored apart from every input and no column
of theirs is a feature.

A **candidate** is a scale's running extreme `E` caught before it is confirmed: the first row
close at which the largest reversal since `E`, divided by its frozen threshold `theta`
(`progress`), is at least the stage `q`. Each extreme gets at most one candidate per stage.
From the next row's first trade on, every released trade is read in order:

- **First passage:** reversal when price has reversed `R x theta` from `E` (log basis points);
  invalidation when it is `C x theta` beyond `E`; timeout after `K` rows without either;
  session end when the session's last row comes first; unknown when a row without data
  coverage (or a nonpositive price) comes first. A price exactly on a barrier reaches it.
- **Survival,** separately: broken by the first trade strictly beyond `E` within `S` rows,
  survived after `S` rows without one, else session end or unknown.

A confirmed high or low that never was a candidate at a row close (it went from below `q` to
confirmed inside one row, or was confirmed while the direction was unknown) is recorded at its
confirmation row as **resolved before decision**: an observation, never a prediction target.

Rows are those of the scale's stream (seconds for fast scales, minutes for slow ones), counted
by index counter, so closures add nothing; a session is the calendar's scheduled-open interval.
A label is emitted with the row that settles its later outcome, so a whole session and one
second at a time give the same rows in the same order, and no label outlives its session.
"""

import numpy as np
from numba import njit

from .columns import BIGINT, DOUBLE, INTEGER, SMALLINT, Column, Table
from .swings import ACTIVE, HIGH, LOW, NONE

PRE, REVERSAL, INVALIDATION, TIMEOUT, SESSION_END, UNKNOWN = 0, 1, 2, 3, 4, 5  # outcomes
SURVIVED, BROKEN = 1, 2  # survival; session end and unknown as above
OPEN = -1  # not settled yet

G_N, G_HAS, G_SEG, G_DIR, G_EXT_ORD, G_ISSUED, G_SEQ_ORD, G_SEQ, NG = range(9)  # integer state
F_PX, F_LAST, NF = range(3)  # float state: the tracked extreme's level, the last trade price
# Open candidates and emitted labels share one layout: integers (NONE undefined) and floats.
(L_ORD, L_END, L_SEQ, L_KIND, L_SEG, L_EXT_ORD, L_PROV, L_OUT, L_OUT_ORD, L_OUT_AT, L_OUT_END,
 L_SURV, L_SURV_ORD, L_SURV_AT, L_SURV_END, NLI) = range(16)  # fmt: skip
X_E, X_THETA, X_PROGRESS, X_DISP, NLF = range(5)


@njit(cache=True)
def _settle_all(n, pi, pub, end, code):
    """Settle every outcome still open (missing data, or the session's last row)."""
    for c in range(n):
        if pi[c, L_OUT] == OPEN:
            pi[c, L_OUT] = code
            pi[c, L_OUT_ORD] = pub
            pi[c, L_OUT_END] = end
        if pi[c, L_SURV] == OPEN:
            pi[c, L_SURV] = code
            pi[c, L_SURV_ORD] = pub
            pi[c, L_SURV_END] = end


@njit(cache=True)
def _emit(n, pi, pf, oi, of, no):
    """Move settled candidates to the output, in the order they were made; returns the counts
    of candidates left and labels written."""
    keep = 0
    for c in range(n):
        if pi[c, L_OUT] != OPEN and pi[c, L_SURV] != OPEN:
            oi[no] = pi[c]
            of[no] = pf[c]
            no += 1
        else:
            if keep != c:
                pi[keep] = pi[c]
                pf[keep] = pf[c]
            keep += 1
    return keep, no


@njit(cache=True)
def _void_row(n, pi, pub, end):
    """A row without data coverage makes the whole row unknown, before anything in it: settle
    what is open, and take back what trades of the row's earlier seconds already settled."""
    for c in range(n):
        out, surv = pi[c, L_OUT], pi[c, L_SURV]
        if out == OPEN or (pi[c, L_OUT_ORD] == pub and out in (REVERSAL, INVALIDATION)):
            pi[c, L_OUT] = UNKNOWN
            pi[c, L_OUT_ORD] = pub
            pi[c, L_OUT_AT] = NONE
            pi[c, L_OUT_END] = end
        if surv == OPEN or (pi[c, L_SURV_ORD] == pub and surv == BROKEN):
            pi[c, L_SURV] = UNKNOWN
            pi[c, L_SURV_ORD] = pub
            pi[c, L_SURV_AT] = NONE
            pi[c, L_SURV_END] = end


@njit(cache=True)
def run(q, r_bar, c_bar, horizon, deadline, o_val, o_row, o_at, r_missing, r_pub, r_end, r_emit,
        r_last, p_state, p_seg, p_dir, p_px, p_ext_ord, p_progress, p_theta, p_prov, e_row,
        e_kind, e_seg, e_ext_ord, e_level, e_theta, g, gf, pi, pf, oi, of):  # fmt: skip
    """Advance one label variant over a chunk's second rows; fill `oi` and `of` with the labels
    settled in it and return their number.

    Per second row: `r_missing` (no data coverage), `r_pub` and `r_end` (the index counter and
    end of the scale's published row it belongs to), `r_emit` (the scale publishes after it),
    `r_last` (it is the last row of its session). `p_*` are the scale's published rows, in
    order; `e_*` its confirmed highs and lows with the second row of their confirming trade;
    `o_*` the released trades with their second row."""
    n_obs, n_ev = o_val.shape[0], e_row.shape[0]
    i = k = e = no = 0
    n = g[G_N]
    for j in range(r_missing.shape[0]):
        pub, end = r_pub[j], r_end[j]
        if g[G_SEQ_ORD] != pub:
            g[G_SEQ_ORD] = pub
            g[G_SEQ] = 0
        if r_missing[j]:
            _void_row(n, pi, pub, end)
        while i < n_obs and o_row[i] <= j:
            p, at = o_val[i], o_at[i]
            i += 1
            if not p > 0.0:  # log distances need positive prices
                _settle_all(n, pi, pub, end, UNKNOWN)
                continue
            for c in range(n):
                sign = 1.0 if pi[c, L_KIND] == HIGH else -1.0
                level, theta = pf[c, X_E], pf[c, X_THETA]
                if pi[c, L_OUT] == OPEN:
                    reversal = sign * 1e4 * np.log(level / p)  # as the detector measures it
                    hit = OPEN
                    if reversal >= r_bar * theta:
                        hit = REVERSAL
                    elif -reversal >= c_bar * theta:
                        hit = INVALIDATION
                    if hit != OPEN:
                        pi[c, L_OUT] = hit
                        pi[c, L_OUT_ORD] = pub
                        pi[c, L_OUT_AT] = at
                        pi[c, L_OUT_END] = end
                if pi[c, L_SURV] == OPEN and sign * (p - level) > 0.0:
                    pi[c, L_SURV] = BROKEN
                    pi[c, L_SURV_ORD] = pub
                    pi[c, L_SURV_AT] = at
                    pi[c, L_SURV_END] = end
            gf[F_LAST] = p
        # Confirmed highs and lows of this second that never were a candidate at a row close.
        while e < n_ev and e_row[e] <= j:
            was = (
                g[G_HAS] == 1
                and g[G_ISSUED] == 1
                and g[G_SEG] == e_seg[e]
                and g[G_EXT_ORD] == e_ext_ord[e]
                and gf[F_PX] == e_level[e]
                and (g[G_DIR] > 0) == (e_kind[e] == HIGH)
            )
            if not was:
                for c in range(NLI):
                    oi[no, c] = NONE
                for c in range(NLF):
                    of[no, c] = np.nan
                oi[no, L_ORD] = pub
                oi[no, L_END] = end
                oi[no, L_SEQ] = g[G_SEQ]
                oi[no, L_KIND] = e_kind[e]
                oi[no, L_SEG] = e_seg[e]
                oi[no, L_EXT_ORD] = e_ext_ord[e]
                oi[no, L_OUT] = PRE
                oi[no, L_OUT_ORD] = pub
                oi[no, L_OUT_END] = end
                of[no, X_E] = e_level[e]
                of[no, X_THETA] = e_theta[e]
                g[G_SEQ] += 1
                no += 1
            g[G_HAS] = 0  # a confirmation ends the tracked extreme; later ones began in this row
            e += 1
        if not r_emit[j]:
            continue
        for c in range(n):  # rows d + 1 ... d + K were observed in full
            if pi[c, L_OUT] == OPEN and pub >= pi[c, L_ORD] + horizon:
                pi[c, L_OUT] = TIMEOUT
                pi[c, L_OUT_ORD] = pub
                pi[c, L_OUT_END] = end
            if pi[c, L_SURV] == OPEN and pub >= pi[c, L_ORD] + deadline:
                pi[c, L_SURV] = SURVIVED
                pi[c, L_SURV_ORD] = pub
                pi[c, L_SURV_END] = end
        if r_last[j]:
            _settle_all(n, pi, pub, end, SESSION_END)
        n, no = _emit(n, pi, pf, oi, of, no)
        # The scale's state at this close: a new candidate when its running extreme first
        # shows progress of at least q.
        if p_state[k] == ACTIVE:
            same = (
                g[G_HAS] == 1
                and g[G_SEG] == p_seg[k]
                and g[G_DIR] == p_dir[k]
                and g[G_EXT_ORD] == p_ext_ord[k]
                and gf[F_PX] == p_px[k]
            )
            if not same:
                g[G_HAS] = 1
                g[G_SEG] = p_seg[k]
                g[G_DIR] = p_dir[k]
                g[G_EXT_ORD] = p_ext_ord[k]
                g[G_ISSUED] = 0
                gf[F_PX] = p_px[k]
            if g[G_ISSUED] == 0 and p_progress[k] >= q:
                g[G_ISSUED] = 1
                sign = 1.0 if p_dir[k] > 0 else -1.0
                for c in range(NLI):
                    pi[n, c] = NONE
                pi[n, L_ORD] = pub
                pi[n, L_END] = end
                pi[n, L_SEQ] = g[G_SEQ]
                pi[n, L_KIND] = HIGH if p_dir[k] > 0 else LOW
                pi[n, L_SEG] = p_seg[k]
                pi[n, L_EXT_ORD] = p_ext_ord[k]
                pi[n, L_PROV] = p_prov[k]
                pi[n, L_OUT] = OPEN
                pi[n, L_SURV] = OPEN
                pf[n, X_E] = p_px[k]
                pf[n, X_THETA] = p_theta[k]
                pf[n, X_PROGRESS] = p_progress[k]
                if gf[F_LAST] > 0.0 and p_theta[k] > 0.0:
                    pf[n, X_DISP] = sign * 1e4 * np.log(p_px[k] / gf[F_LAST]) / p_theta[k] + 0.0
                else:  # undefined: no trade seen yet, or no valid theta
                    pf[n, X_DISP] = np.nan
                g[G_SEQ] += 1
                n += 1
                if r_last[j]:  # nothing of its session is left to observe
                    _settle_all(n, pi, pub, end, SESSION_END)
                    n, no = _emit(n, pi, pf, oi, of, no)
        else:
            g[G_HAS] = 0
        k += 1
    g[G_N] = n
    return no


class Labeler:
    """One label variant's state: the scale's extreme at the last close, whether it has a
    candidate, and the candidates not settled yet (at most one per row of the horizon)."""

    STATE = ("g", "gf", "pi", "pf")

    def __init__(self, q: float, reversal: float, invalidation: float, horizon: int, deadline: int):
        self.q, self.reversal, self.invalidation = q, reversal, invalidation
        self.horizon, self.deadline = horizon, deadline
        cap = max(horizon, deadline) + 2
        self.g = np.zeros(NG, np.int64)
        self.g[G_SEQ_ORD] = NONE
        self.gf = np.zeros(NF)
        self.pi, self.pf = np.zeros((cap, NLI), np.int64), np.zeros((cap, NLF))

    def advance(self, obs: dict, rows: dict, state: dict, events: dict):
        """Labels settled in the chunk as integer and float arrays (`L_*`, `X_*`)."""
        size = int(self.g[G_N]) + int(rows["emit"].sum()) + len(events["row"]) + 1
        oi, of = np.empty((size, NLI), np.int64), np.empty((size, NLF))
        no = run(
            self.q, self.reversal, self.invalidation, self.horizon, self.deadline,
            obs["value"], obs["row"], obs["at"],
            rows["missing"], rows["pub"], rows["end"], rows["emit"], rows["last"],
            state["state"], state["segment"], state["dir"], state["px"], state["ext_ordinal"],
            state["progress"], state["theta"], state["prov"],
            events["row"], events["kind"], events["segment"], events["ext_ordinal"],
            events["level"], events["theta"], self.g, self.gf, self.pi, self.pf, oi, of,
        )  # fmt: skip
        return oi[:no].copy(), of[:no].copy()


PRICE_NOTE = "Databento fixed-point price (1e-9)"
OUTCOMES = (
    "0 resolved before decision, 1 reversal, 2 invalidation, 3 timeout, 4 session end, 5 unknown"
)
KEY_COLUMNS = (
    Column(
        "slot_ordinal",
        BIGINT,
        "Index counter of the decision row (a row resolved before decision: its confirmation row)",
    ),
    Column("end_ns", BIGINT, "End of that row, UTC ns; the candidate is known a close delay later"),
)
# No column has a unit: a label is never a model input. Ordered by width, as the other tables.
LABEL_COLUMNS: tuple[Column, ...] = (
    Column("available_ns", BIGINT, "When both outcomes were known: their later row's publication"),
    Column("ext_ordinal", BIGINT, "Index counter of the row of the extreme"),
    Column("ext_px", BIGINT, f"The extreme E, {PRICE_NOTE}"),
    Column("outcome_ordinal", BIGINT, "Index counter of the row that settled the first passage"),
    Column("outcome_at_ns", BIGINT, "Time of the trade that reached a barrier, UTC ns"),
    Column("survival_ordinal", BIGINT, "Index counter of the row that settled survival"),
    Column("break_at_ns", BIGINT, "Time of the first trade strictly beyond E, UTC ns"),
    Column("theta_bps", DOUBLE, "The extreme's frozen threshold: barriers are multiples of it"),
    Column("progress", DOUBLE, "Largest reversal since E / theta at the decision close"),
    Column(
        "displacement",
        DOUBLE,
        "Reversal of the last trade price from E / theta at the decision close",
    ),
    Column("segment", INTEGER, "Segment counter of the scale"),
    Column("seq", INTEGER, "Order of the variant's labels within the decision row, from 0"),
    Column("kind", SMALLINT, "1 a candidate high, 2 a candidate low"),
    Column("outcome", SMALLINT, f"First passage: {OUTCOMES}"),
    Column("survival", SMALLINT, "E within the deadline: 1 survived, 2 broken, 4, 5 as outcome"),
    Column(
        "prov",
        SMALLINT,
        "1 when the candidate was a provisional higher low or lower high at the decision close, "
        "0 when not; NULL without a confirmed pivot of its kind to compare with",
    ),
)
SOURCE = {  # column: (integer array?, index)
    "slot_ordinal": (True, L_ORD),
    "end_ns": (True, L_END),
    "ext_ordinal": (True, L_EXT_ORD),
    "outcome_ordinal": (True, L_OUT_ORD),
    "outcome_at_ns": (True, L_OUT_AT),
    "survival_ordinal": (True, L_SURV_ORD),
    "break_at_ns": (True, L_SURV_AT),
    "theta_bps": (False, X_THETA),
    "progress": (False, X_PROGRESS),
    "displacement": (False, X_DISP),
    "segment": (True, L_SEG),
    "seq": (True, L_SEQ),
    "kind": (True, L_KIND),
    "outcome": (True, L_OUT),
    "survival": (True, L_SURV),
    "prov": (True, L_PROV),
}
ALWAYS = frozenset(
    {"slot_ordinal", "end_ns", "available_ns", "ext_ordinal", "ext_px", "outcome_ordinal",
     "segment", "seq", "kind", "outcome"}
)  # fmt: skip


def label_table(oi: np.ndarray, of: np.ndarray, close_delay: int) -> Table:
    """Settled labels as a stage table."""
    later = np.where(oi[:, L_SURV_END] == NONE, oi[:, L_OUT_END], oi[:, L_SURV_END])
    values: dict[str, np.ndarray] = {
        "available_ns": np.maximum(oi[:, L_OUT_END], later) + close_delay,
        "ext_px": of[:, X_E].astype(np.int64),  # fixed point, exact below 2**53
    }
    nulls: dict[str, np.ndarray] = {}
    for name, (integer, index) in SOURCE.items():
        x = oi[:, index] if integer else of[:, index]
        null = x == NONE if integer else np.isnan(x)
        values[name] = np.where(null, 0, x) if integer else x.copy()
        if name not in ALWAYS:
            nulls[name] = null
    return Table(values, nulls)
