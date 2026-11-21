"""Pivot outcome labels (docs/project/pivot-label-spec.md): the labeler on hand-built price
paths, and the stored label stages against a plain reading of the stored swing rows and the
trades, in any chunking and from checkpoints, and under price and size scaling."""

import itertools
import math

import numpy as np
import pytest
from helpers import T0, calendar
from strategy_core import pivot_labels, swings
from strategy_core.bars import assignment_times
from strategy_core.engine import split_by_second
from strategy_core.pipeline import FEATURE_STAGES, STAGES, Pipeline, StageFeatures, check_graph
from strategy_core.pivot_labels import (
    BROKEN,
    INVALIDATION,
    PRE,
    REVERSAL,
    SESSION_END,
    SURVIVED,
    TIMEOUT,
    UNKNOWN,
    Labeler,
)
from strategy_core.stage_pivot_label import (
    COLUMNS,
    FAST_LABELS,
    HORIZON,
    Q_STAGES,
    SLOW_LABELS,
    PivotLabelStage,
    label,
)
from strategy_core.stage_pivot_label import (
    INVALIDATION as C_BAR,
)
from strategy_core.stage_step_pivot import FAST_SCALES as FAST
from strategy_core.stages import Stage
from strategy_core.state import from_bytes, to_bytes
from strategy_core.swings import ACTIVE, HIGH, LOW, NONE, PRICE
from strategy_core.synthetic import random_trades
from test_hour_stats import CONFIG
from test_minutes import join, regroup
from test_swings import BRANCH, FINE, SMALL, S, session_chunks


def px(bps: float) -> float:
    """A price `bps` log basis points above 1000."""
    return 1000.0 * math.exp(bps / 1e4)


# 40 bps, as the detector measures the fall from a high at 100 to exactly 60
THETA = float(1e4 * np.log(px(100) / px(60)))


def play(rows, q=0.25, horizon=5, *, last=(), parts=None):
    """Run a fast scale's detector and one labeler over rows of prices in bps (a list per row,
    or None for a row without data coverage). Returns the labels as dictionaries, in the order
    they were settled. `last`: rows that end a session; `parts`: row counts to cut the run into."""
    detector = swings.Detector(PRICE, 60, 1)
    labeler = Labeler(q, 1.0, 0.25, horizon, horizon)
    n, labels = len(rows), []
    cuts = np.cumsum([0, *(parts or [n])])
    side = {1: swings.O_SIDE + swings.S_PROV, -1: swings.O_SIDE + swings.NS_ + swings.S_PROV}
    for a, b in itertools.pairwise(cuts):
        value, row = [], []
        for j in range(a, b):
            for v in rows[j] or []:
                value.append(px(v))
                row.append(j - a)
        obs = {
            "value": np.array(value, np.float64),
            "row": np.array(row, np.int64),
            "at": np.array([10 * (a + r) + 1 for r in row], np.int64) * S,
            "size": np.ones(len(value), np.int64),
            "side": np.zeros(len(value), np.int64),
        }
        ordinal = np.arange(a, b, dtype=np.int64)
        m = int(b - a)
        spec = {
            "missing": np.array([rows[j] is None for j in range(a, b)]),
            "theta": np.full(m, THETA),
            "atr": np.full(m, 1.0),
            "group": ordinal,
            "pub": ordinal,
            "emit": np.ones(m, bool),
        }
        out, ev_i, ev_f = detector.advance(obs, spec)
        direction = out[:, swings.O_DIR]
        prov = np.array(
            [
                out[r, side[int(d)]]
                if np.isfinite(d) and np.isfinite(out[r, side[int(d)]])
                else NONE
                for r, d in enumerate(direction)
            ],
            np.float64,
        ).astype(np.int64)
        state = {
            "state": out[:, swings.O_STATE].astype(np.int64),
            "segment": np.nan_to_num(out[:, swings.O_SEG]).astype(np.int64),
            "dir": np.nan_to_num(direction).astype(np.int64),
            "px": np.nan_to_num(out[:, swings.O_EXT]),
            "ext_ordinal": ordinal - np.nan_to_num(out[:, swings.O_EXT_AGE]).astype(np.int64),
            "progress": out[:, swings.O_PROGRESS],
            "theta": out[:, swings.O_THETA],
            "prov": prov,
        }
        pivot = (ev_i[:, swings.E_KIND] == HIGH) | (ev_i[:, swings.E_KIND] == LOW)
        events = {
            "row": ev_i[pivot, swings.E_ROW],
            "kind": ev_i[pivot, swings.E_KIND],
            "segment": ev_i[pivot, swings.E_SEG],
            "ext_ordinal": ev_i[pivot, swings.E_EXT_ORD],
            "level": ev_f[pivot, swings.X_LEVEL],
            "theta": ev_f[pivot, swings.X_THETA],
        }
        frame = {
            "missing": spec["missing"],
            "pub": ordinal,
            "end": (ordinal + 1) * 10 * S,
            "emit": spec["emit"],
            "last": np.isin(ordinal, list(last)),
        }
        table = pivot_labels.label_table(*labeler.advance(obs, frame, state, events), 0)
        for r in range(len(table)):
            labels.append(
                {
                    k: (None if table.nulls.get(k, np.zeros(1, bool))[r : r + 1].any() else v[r])
                    for k, v in table.values.items()
                }
            )
    return labels


def brief(labels):
    return [(x["slot_ordinal"], x["kind"], x["outcome"], x["survival"]) for x in labels]


# A high at 100 bps, set in row 1 after a low at 0 was confirmed by the rise to it.
UP = [[0], [50, 100]]


def test_a_candidate_is_the_first_close_with_enough_progress_and_reverses_at_the_confirmation():
    rows = [*UP, [95], [86, 89], [88], [62], [60], [70], [70], [70], [70], [70], [70]]
    got = play(rows, q=0.25, horizon=5)
    high = next(x for x in got if x["kind"] == HIGH and x["outcome"] != PRE)
    # progress passes a quarter (14 of 40 bps) at the close of row 3, not at row 2 (5 bps);
    # the displacement is where the last trade left the price (11 bps)
    assert high["slot_ordinal"] == 3 and high["ext_ordinal"] == 1
    assert high["progress"] == pytest.approx(14 / 40) and high["displacement"] == pytest.approx(
        11 / 40
    )
    assert high["ext_px"] == int(px(100)) and high["theta_bps"] == THETA
    assert high["prov"] is None  # no confirmed high yet to compare with
    # the trade at 60 is exactly 40 bps below the high: a price on the barrier reaches it
    assert (high["outcome"], high["outcome_ordinal"], high["outcome_at_ns"]) == (
        REVERSAL,
        6,
        61 * S,
    )
    # survival is separate: five rows (4 to 8) pass without a trade above 100
    assert (high["survival"], high["survival_ordinal"], high["break_at_ns"]) == (SURVIVED, 8, None)
    assert high["available_ns"] == 9 * 10 * S and high["end_ns"] == 4 * 10 * S
    # one candidate per extreme and stage, however long progress stays above q
    assert sum(x["kind"] == HIGH and x["ext_ordinal"] == 1 for x in got) == 1
    # a half needs 20 bps: the same high becomes a q = 0.5 candidate only at row 5 (38 bps)
    later = next(x for x in play(rows, q=0.5) if x["kind"] == HIGH and x["outcome"] != PRE)
    assert (later["slot_ordinal"], later["outcome"], later["outcome_ordinal"]) == (5, REVERSAL, 6)


def test_invalidation_needs_a_quarter_theta_beyond_the_extreme_and_a_break_any_trade_beyond():
    # 109 is beyond the high (broken) but short of 100 + 10
    got = play([*UP, [85], [109], [111], [111], [111], [111], [111], [111]])
    high = next(x for x in got if x["slot_ordinal"] == 2)
    assert (high["outcome"], high["outcome_ordinal"]) == (INVALIDATION, 4)
    assert (high["survival"], high["survival_ordinal"], high["break_at_ns"]) == (BROKEN, 3, 31 * S)
    # The label keeps its extreme and theta after the detector moved its own to 109, then 110;
    # equality with the extreme is not a break.
    rows = [*UP, [85], [100], [109], [70], [59], [59], [59], [59], [59], [59], [59]]
    got = play(rows, horizon=6)
    first = next(x for x in got if x["slot_ordinal"] == 2)
    assert (first["outcome"], first["outcome_ordinal"]) == (REVERSAL, 6)  # 59: 41 below 100
    assert (first["survival"], first["survival_ordinal"]) == (BROKEN, 4)
    # the detector's new high at 109 is a candidate of its own, from the close of row 5
    second = next(x for x in got if x["kind"] == HIGH and x["ext_ordinal"] == 4)
    assert (second["slot_ordinal"], second["outcome"], second["survival"]) == (
        5,
        REVERSAL,
        SURVIVED,
    )


def test_timeout_session_end_and_unknown_are_different_outcomes():
    quiet = [*UP, [85], [86], [86], [], [86], [86], [86], [86]]
    got = play(quiet, horizon=4)
    high = next(x for x in got if x["slot_ordinal"] == 2)
    # rows 3 to 6 were observed in full, one of them without a trade
    assert (high["outcome"], high["outcome_ordinal"], high["outcome_at_ns"]) == (TIMEOUT, 6, None)
    assert (high["survival"], high["survival_ordinal"]) == (SURVIVED, 6)
    # the session's last row comes before the horizon ends
    got = play(quiet, horizon=4, last=(4,))
    high = next(x for x in got if x["slot_ordinal"] == 2)
    assert (high["outcome"], high["outcome_ordinal"], high["survival"]) == (
        SESSION_END,
        4,
        SESSION_END,
    )
    # a candidate made at the session's last row has nothing left to observe
    got = play(quiet, horizon=4, last=(2,))
    high = next(x for x in got if x["slot_ordinal"] == 2)
    assert (high["outcome"], high["outcome_ordinal"], high["available_ns"]) == (
        SESSION_END,
        2,
        30 * S,
    )
    # a barrier reached in the last row of the horizon still counts
    got = play([*UP, [85], [86], [86], [86], [59], [59]], horizon=4)
    assert next(x for x in got if x["slot_ordinal"] == 2)["outcome"] == REVERSAL
    # a row without data coverage: what happened in it is not known
    got = play([*UP, [85], [86], None, [59], [59], [59], [59]], horizon=4)
    high = next(x for x in got if x["slot_ordinal"] == 2)
    assert (high["outcome"], high["outcome_ordinal"], high["survival"]) == (UNKNOWN, 4, UNKNOWN)


def test_a_pivot_confirmed_inside_one_row_is_resolved_before_decision():
    # The low at 0 is confirmed while the direction is unknown; the high at 100 falls 40 inside
    # row 2, before any close saw it with progress; the new low at 59 then rebounds 11 of 40.
    got = play([*UP, [100, 59, 70], *([[70]] * 8)])
    assert [(x["slot_ordinal"], x["seq"], x["kind"], x["outcome"]) for x in got[:2]] == [
        (1, 0, LOW, PRE),
        (2, 0, HIGH, PRE),
    ]
    assert got[1]["theta_bps"] == THETA and got[1]["progress"] is None
    assert (got[1]["survival"], got[1]["outcome_ordinal"], got[1]["ext_ordinal"]) == (None, 2, 1)
    low = got[2]  # the candidate of the same row follows the confirmation in `seq`
    assert (low["slot_ordinal"], low["seq"], low["kind"], low["ext_ordinal"]) == (2, 1, LOW, 2)
    # a candidate that was seen at a close is never also recorded as resolved before decision
    got = play([*UP, [85], [59], [59], [59], [59], [59], [59], [59]])
    assert [x["outcome"] for x in got if x["kind"] == HIGH] == [REVERSAL]


def test_the_provisional_flag_is_the_scale_s_at_the_decision_close():
    # low 0, high 100, low 50, high 120; then a candidate low at 79, above the low at 50
    rows = [[0], [50, 100], [50], [95, 120], [79], *([[90]] * 8)]
    got = play(rows)
    low = next(x for x in got if x["kind"] == LOW and x["ext_ordinal"] == 4)
    assert (low["prov"], low["slot_ordinal"], low["outcome"]) == (1, 5, TIMEOUT)
    # ... and a candidate high at 130, not below the high at 120, is no provisional lower high
    rows = [[0], [50, 100], [50], [95, 120], [79], [130], *([[115]] * 8)]
    high = next(x for x in play(rows) if x["kind"] == HIGH and x["ext_ordinal"] == 5)
    assert (high["prov"], high["slot_ordinal"]) == (0, 6)


def test_processing_row_by_row_gives_the_same_labels_in_the_same_order():
    rng = np.random.default_rng(5)
    walk = np.cumsum(rng.normal(0, 6, 3000))
    rows, k = [], 0
    for j in range(600):
        m = int(rng.integers(0, 6))
        rows.append(None if j in (200, 201) else [float(v) for v in walk[k : k + m]])
        k += m
    last = (99, 299, 499, 599)
    whole = play(rows, horizon=10, last=last)
    assert {x["outcome"] for x in whole} == {
        PRE,
        REVERSAL,
        INVALIDATION,
        TIMEOUT,
        SESSION_END,
        UNKNOWN,
    }
    assert {x["survival"] for x in whole} >= {None, SURVIVED, BROKEN, SESSION_END}
    for parts in ([1] * 600, [7, 93, 250, 250]):
        assert play(rows, horizon=10, last=last, parts=parts) == whole
    keys = [(x["slot_ordinal"], x["seq"]) for x in whole]
    assert len(set(keys)) == len(keys)  # the table's key
    # every label is settled within its session, so a session's labels can be replaced alone
    ends = np.array(last)
    for x in whole:
        session_end = ends[np.searchsorted(ends, x["slot_ordinal"])]
        assert max(x["outcome_ordinal"], x["survival_ordinal"] or 0) <= session_end


# The stored stages ---------------------------------------------------------------------------

FINE_LABELS = tuple(label(s, q) for s in FINE for q in Q_STAGES)
LABELED = (*BRANCH, *FINE_LABELS)  # BRANCH holds the registered label stages already
ALL_LABELS = (*SLOW_LABELS, *FAST_LABELS, *FINE_LABELS)


def builder(cal):
    return Pipeline(cal, feed_latency=0, close_delay=CONFIG.close_delay, config=SMALL,
                    stages=LABELED)  # fmt: skip


@pytest.fixture(scope="module")
def days():
    """Six sessions: five of 90 minutes and one that closes after an hour, so the slow
    horizon (240 minutes) always meets the session end and the fast one (300 seconds) does
    not; the third has 40 seconds of missing data."""
    hours = [(2 * k, 2 * k + (1.0 if k == 4 else 1.5)) for k in range(6)]
    cal = calendar(*hours)
    end = int(cal.closes[-1])
    t = random_trades(T0, end, seed=23, rate=0.6)
    gap = int(cal.opens[2]) + 2000 * S
    cov = np.array([[T0, gap + S // 2], [gap + 40 * S, end]], np.int64)
    return cal, t, cov, session_chunks(cal, t, cov)


@pytest.fixture(scope="module")
def whole(days):
    cal, _, _, chunks = days
    p = builder(cal)
    return [p.process(c) for c in chunks]


def released(days):
    """Every accepted trade in release order: its second row, price, and assignment time."""
    cal, t, cov, _ = days
    ends = np.concatenate(
        [np.arange(o + S, c + 1, S) for o, c in zip(cal.opens, cal.closes, strict=True)]
    )
    at = assignment_times(t, CONFIG.feed_latency, CONFIG.close_delay)
    slot = np.searchsorted(ends, at, side="right")
    ok = slot < len(ends)
    ok[ok] &= ends[slot[ok]] - S <= at[ok]
    covered = np.zeros(len(ends), bool)
    for a, b in cov:
        covered |= (ends - S >= a) & (ends <= b)
    ok[ok] &= covered[slot[ok]]
    index = np.flatnonzero(ok)
    index = index[np.argsort(slot[index], kind="stable")]
    return ends, covered, slot[index], t.price[index], at[index]


def reference(days, whole, stage):
    """Labels read plainly from the stored swing rows and events and the trades: for each
    extreme the first close with enough progress, then a scan of the trades after that row."""
    cal = days[0]
    ends, covered, slot, price, at = released(days)
    w = 1 if stage.RESOLUTION == "1s" else 60
    horizon = HORIZON[stage.RESOLUTION]
    second = cal.slot_ordinals(ends, S)
    pub = (second + w - 1) // w  # the published row of each second
    closes = set(cal.closes.tolist())
    rows, nulls = join(whole, stage.SCALE.NAME)
    events = {
        k: np.concatenate([p.products["events"][stage.SCALE.NAME].values[k] for p in whole])
        for k in ("kind", "slot_ordinal", "seq", "segment", "ext_ordinal", "level", "theta")
    }
    first_trade = np.searchsorted(pub[slot], np.arange(pub.max() + 2))  # by published row
    last_second = {int(p): j for j, p in enumerate(pub)}  # the last second of each row
    out, issued = [], {}
    seen = None
    for r in range(len(rows["slot_ordinal"])):
        d = int(rows["slot_ordinal"][r])
        if rows["state"][r] != ACTIVE:
            seen = None
            continue
        up = rows["dir"][r] > 0
        level = int(rows["ext_px"][r])
        key = (
            int(rows["segment"][r]),
            HIGH if up else LOW,
            d - int(rows["ext_age_s"][r]) // w,
            level,
        )
        if key != seen:
            seen, done = key, False
        if done or rows["progress"][r] < stage.Q:
            continue
        done = True
        issued[key] = d
        theta = float(rows["theta_bps"][r])
        sign = 1.0 if up else -1.0
        j = last_second[d]
        before = np.flatnonzero(slot <= j)
        flag = "prov_lh" if up else "prov_hl"
        x = {
            "slot_ordinal": d,
            "end_ns": int(rows["end_ns"][r]),
            "kind": key[1],
            "segment": key[0],
            "ext_ordinal": key[2],
            "ext_px": level,
            "theta_bps": theta,
            "progress": float(rows["progress"][r]),
            "displacement": sign * 1e4 * math.log(level / int(price[before[-1]])) / theta,
            "prov": None if nulls[flag][r] else int(rows[flag][r]),
            "outcome": None,
            "survival": None,
            "outcome_at_ns": None,
            "break_at_ns": None,
        }
        k = int(first_trade[d + 1])
        for row in range(d, d + horizon + 1):  # the decision row, then the horizon's rows
            j = last_second[row]
            if row > d:
                firsts = [s for s in range(j - w + 1, j + 1) if not covered[s]]
                if firsts:  # missing data comes before anything else in the row
                    for name in ("outcome", "survival"):
                        if x[name] is None:
                            x[name], x[f"{name}_ordinal"] = UNKNOWN, row
                while k < len(slot) and pub[slot[k]] == row:
                    p = int(price[k])
                    reversal = sign * 1e4 * math.log(level / p)
                    if x["outcome"] is None and (reversal >= theta or -reversal >= C_BAR * theta):
                        x["outcome"] = REVERSAL if reversal >= theta else INVALIDATION
                        x["outcome_ordinal"], x["outcome_at_ns"] = row, int(at[k])
                    if x["survival"] is None and sign * (p - level) > 0:
                        x["survival"], x["survival_ordinal"] = BROKEN, row
                        x["break_at_ns"] = int(at[k])
                    k += 1
            if row == d + horizon:
                if x["outcome"] is None:
                    x["outcome"], x["outcome_ordinal"] = TIMEOUT, row
                if x["survival"] is None:
                    x["survival"], x["survival_ordinal"] = SURVIVED, row
            if int(ends[j]) in closes:
                for name in ("outcome", "survival"):
                    if x[name] is None:
                        x[name], x[f"{name}_ordinal"] = SESSION_END, row
            if x["outcome"] is not None and x["survival"] is not None:
                break
        settled = max(x["outcome_ordinal"], x["survival_ordinal"])
        x["available_ns"] = int(ends[last_second[settled]]) + CONFIG.close_delay
        out.append(x)
    counts: dict[int, int] = {}
    for e in range(len(events["kind"])):  # confirmed pivots that never were candidates
        if events["kind"][e] not in (HIGH, LOW):
            continue
        key = (int(events["segment"][e]), int(events["kind"][e]), int(events["ext_ordinal"][e]),
               int(events["level"][e]))  # fmt: skip
        row = int(events["slot_ordinal"][e])
        if issued.get(key, row) < row:
            continue
        out.append(
            {
                "slot_ordinal": row,
                "end_ns": int(ends[last_second[row]]),
                "seq": counts.get(row, 0),
                "kind": key[1],
                "segment": key[0],
                "ext_ordinal": key[2],
                "ext_px": key[3],
                "theta_bps": float(events["theta"][e]),
                "outcome": PRE,
                "outcome_ordinal": row,
                "available_ns": int(ends[last_second[row]]) + CONFIG.close_delay,
            }
        )
        counts[row] = counts.get(row, 0) + 1
    for x in out:
        x.setdefault("seq", counts.get(x["slot_ordinal"], 0))  # a candidate follows its row's
    return sorted(out, key=lambda x: (x["slot_ordinal"], x["seq"]))


@pytest.mark.parametrize("stage", ALL_LABELS, ids=lambda s: s.VARIANT)
def test_stored_labels_equal_a_plain_reading_of_the_swings_and_trades(days, whole, stage):
    values, nulls = join(whole, stage.NAME)
    order = np.lexsort((values["seq"], values["slot_ordinal"]))
    want = reference(days, whole, stage)
    assert len(order) == len(want)
    names = [c.name for c in COLUMNS]
    for i, x in zip(order, want, strict=True):
        got = {n: (None if nulls[n][i] else values[n][i]) for n in names}
        for n in names:
            if isinstance(x.get(n), float):
                assert got[n] == pytest.approx(x[n], rel=1e-12, abs=1e-12), (n, x)
            else:
                assert got[n] == x.get(n), (n, got, x)
    outcomes = {int(v) for v in values["outcome"]}
    if stage.RESOLUTION == "1s":  # noisy trades settle the first passage within seconds
        assert {PRE, REVERSAL, INVALIDATION, SESSION_END} <= outcomes and len(want) > 80
        survival = {
            int(v)
            for v, null in zip(values["survival"], nulls["survival"], strict=True)
            if not null
        }
        assert survival == {SURVIVED, BROKEN, SESSION_END, UNKNOWN}  # the 40 missing seconds
    elif stage in FINE_LABELS:  # the hourly scales hold few swings in six short sessions
        assert {PRE, REVERSAL, INVALIDATION, SESSION_END} <= outcomes and TIMEOUT not in outcomes


def test_identical_in_any_chunking_and_from_checkpoints(days, whole):
    cal, _, _, chunks = days
    seconds = [s for c in chunks for s in split_by_second(c, cal, CONFIG)]
    p = builder(cal)
    stepwise = [p.process(c) for c in regroup(seconds, [1, 7, 59, 61, 300, 1, 1000])]
    parts = regroup(seconds, [6631])  # cuts fall inside minutes and inside open candidates
    first = builder(cal)
    head = [first.process(c) for c in parts[:2]]
    saved = {name: from_bytes(to_bytes(first.export(name))) for name in first.stages}
    resumed = builder(cal)
    for name, state in saved.items():
        resumed.restore(name, state)
    tail = [resumed.process(c) for c in parts[2:]]
    for stage in ALL_LABELS:
        a, an = join(whole, stage.NAME)
        for other in (stepwise, head + tail):
            b, bn = join(other, stage.NAME)
            for k in a:
                np.testing.assert_array_equal(a[k], b[k], err_msg=f"{stage.NAME} {k}")
                np.testing.assert_array_equal(an[k], bn[k], err_msg=f"{stage.NAME} {k} NULL")
    # a whole session settles every label of its own rows: nothing is carried out of it
    for part, chunk in zip(whole, chunks, strict=True):
        lo, hi = part.tables["bar_1s"].values["end_ns"][[0, -1]]
        for stage in ALL_LABELS:
            ends = part.tables[stage.NAME].values["end_ns"]
            assert ((ends >= lo) & (ends <= hi)).all(), (stage.NAME, chunk.label)
    assert int(p.stages[FAST_LABELS[0].NAME].labeler.g[pivot_labels.G_N]) == 0


def test_labels_do_not_depend_on_price_or_size_units(days, whole):
    cal, t, cov, _ = days

    def run(scale):
        p = builder(cal)
        return [p.process(c) for c in session_chunks(cal, t.scaled(**scale), cov)]

    for other, factor in ((run({"price_factor": 3}), 3), (run({"size_factor": 7}), 1)):
        for stage in ALL_LABELS:
            base, bn = join(whole, stage.NAME)
            values, nulls = join(other, stage.NAME)
            for c in COLUMNS:
                np.testing.assert_array_equal(nulls[c.name], bn[c.name], err_msg=c.name)
                want = base[c.name] * (factor if c.name == "ext_px" else 1)
                if c.sql == "double precision":
                    np.testing.assert_allclose(
                        values[c.name], want, rtol=1e-9, atol=1e-9, equal_nan=True
                    )
                else:
                    np.testing.assert_array_equal(values[c.name], want, err_msg=c.name)


def test_labels_are_never_inputs():
    assert not any(c.unit for c in COLUMNS)  # no label column is a feature
    assert [s.NAME for s in STAGES if getattr(s, "LABEL", False)] == [
        f"pivot_label_{r}:{scale}_q{q}"
        for r, scales in (("1s", ("fast_atr_0p5", "fast_atr_1", "fast_atr_2")),
                          ("10s", ("mid_atr_0p5", "mid_atr_1", "mid_atr_2")),
                          ("1m", ("slow_atr_0p5", "slow_atr_1", "slow_atr_2")))
        for scale in scales
        for q in (25, 50)
    ]  # fmt: skip
    assert all(issubclass(s, PivotLabelStage) for s in (*SLOW_LABELS, *FAST_LABELS))
    assert FAST_LABELS[0].INPUTS == ("market", "bar_1s", "pivot_1s:fast_atr_0p5")
    # the engine computes every stage but the labels
    assert [s.NAME for s in FEATURE_STAGES] == [s.NAME for s in STAGES[:21]]
    features = StageFeatures(calendar((0, 1)), feed_latency=0, close_delay=0)
    assert set(features.pipeline.stages) == {s.NAME for s in FEATURE_STAGES}
    assert not any("label" in name for name in StageFeatures.sources())

    class Reader(Stage):
        NAME, TIER, RESOLUTION = "reader", 9, "1s"
        INPUTS = (FAST_LABELS[0].NAME,)

    with pytest.raises(ValueError, match="labels are never inputs"):
        check_graph((*STAGES, Reader))
    # the parameters frozen in the spec are the variant's settings: the label ID
    stage = FAST_LABELS[1](features.pipeline.context)
    assert stage.settings() == {
        "variant": "fast_atr_0p5_q50",
        "scale": "pivot_1s:fast_atr_0p5",
        "stage_q": 0.5,
        "reversal": 1.0,
        "invalidation": 0.25,
        "horizon_rows": 300,
        "survival_rows": 300,
        "session": "calendar interval",
    }
    assert SLOW_LABELS[0](features.pipeline.context).settings()["horizon_rows"] == 240
    assert stage.warmup() == FAST[0](features.pipeline.context).warmup()


def test_a_missing_second_voids_the_whole_row_even_after_earlier_trades_settled():
    """A slow row's missing second makes the row unknown before its earlier seconds' trades."""
    pl = pivot_labels
    pi = np.full((3, pl.NLI), pl.NONE, np.int64)
    pi[:, pl.L_OUT] = [pl.REVERSAL, pl.REVERSAL, pl.OPEN]
    pi[:, pl.L_OUT_ORD] = [7, 6, pl.NONE]  # the first settled in this row (7), the second earlier
    pi[:, pl.L_OUT_AT] = [123, 456, pl.NONE]
    pi[:, pl.L_SURV] = [pl.BROKEN, pl.SURVIVED, pl.OPEN]
    pi[:, pl.L_SURV_ORD] = [7, 6, pl.NONE]
    pi[:, pl.L_SURV_AT] = [123, pl.NONE, pl.NONE]
    pl._void_row.py_func(3, pi, 7, 420)
    assert list(pi[:, pl.L_OUT]) == [pl.UNKNOWN, pl.REVERSAL, pl.UNKNOWN]
    assert list(pi[:, pl.L_SURV]) == [pl.UNKNOWN, pl.SURVIVED, pl.UNKNOWN]
    assert pi[0, pl.L_OUT_AT] == pl.NONE and pi[1, pl.L_OUT_AT] == 456
