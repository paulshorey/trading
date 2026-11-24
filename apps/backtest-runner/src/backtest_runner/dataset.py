"""The decision dataset of the first decision model (docs/project/yardstick-spec.md, Part A).

One row for the second that ends each minute of every warm front session of the development
period: the features the engine holds at that second, read from the stored rows (which equal
what the engine computes), whether the row is eligible for a decision, and its targets. The
targets look into the future and are computed from the DBN files' trades and book: the move
ahead in R, and the mid-price's move over a few fixed horizons as a diagnostic.

Nothing here is stored in the database. `build` returns arrays, and `cached` keeps them in a
file under `data/research/` (derived, not in git) named by everything that determines them.
"""

import hashlib
import json
import multiprocessing as mp
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date

import numpy as np
from strategy_core import targets
from strategy_core.engine import session_view
from strategy_core.execution import ExecutionConfig
from strategy_core.market import NS, PX
from strategy_core.pipeline import StageFeatures
from strategy_core.timeframes import FAST, MIDDLE, SLOW

from . import db, store
from .calendars import load_sessions
from .catalog import ROOT
from .ingest import ProductData
from .periods import DEV_END, DEV_START, check_period
from .source import DayCache, HistoricalSource

# Frozen in the spec before any outcome was read.
R_ATR = 1.5  # one R: this many ATRs of the latest completed 1h@1m row (roadmap decision 39)
ENTRY_CUTOFF_S = 3_600  # no decision within this long before the forced exit (decision 21)
SPREAD_LIMIT = 0.25  # of R: a wider book at the decision is not traded (decision 27)
HORIZONS_S = (60, 300, 900, 3_600)  # the horizon map's diagnostic targets
ROW_SECONDS = 60  # a training row is the second that ends each minute
EXECUTION = ExecutionConfig()  # the base timing: when a second closes and its book is read
ELIGIBLE, NO_ATR, NO_ROOM, FLAGGED, NO_BOOK, WIDE = range(6)
INELIGIBLE = {
    NO_ATR: "no_atr",
    NO_ROOM: "too_close_to_the_forced_exit",
    FLAGGED: "session_data_flagged",
    NO_BOOK: "no_usable_book_at_the_decision",
    WIDE: "spread_too_wide_for_the_stop",
}
SESSIONS_PER_TASK = 4
CACHE = ROOT / "data/research/yardstick"
FLAGGED_QUERY = """
    SELECT s.contract_id, s.trade_date FROM market.ingest_slice s
    WHERE s.contract_id = ANY(%s) AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.source_files) f
        WHERE f->>'condition' <> 'available')"""


def variant_ids(conn) -> dict[str, int]:
    """Each active variant's id by stage name (`pivot_1m:slow_atr_3`)."""
    rows = conn.execute("SELECT stage, name, id FROM market.variant WHERE retired_at IS NULL")
    return {f"{stage}:{name}": int(vid) for stage, name, vid in rows}


def front_sessions(conn, product: str, start: date, end: date, stages: list[tuple[str, int]]):
    """Front sessions of the period with stored rows: trade date, contract id and symbol, first
    and last second ordinal, open, close, and whether every named stage (table, variant id)
    was warm in it."""
    rows = conn.execute(
        """SELECT f.trade_date, f.contract_id, f.contract, f.first_ordinal, f.last_ordinal,
                  f.open_ns, f.close_ns,
                  (SELECT count(*) FILTER (WHERE s.warm) FROM market.stage_slice s
                   WHERE s.contract_id = f.contract_id AND s.trade_date = f.trade_date
                     AND (s.stage, s.variant_id) IN
                         (SELECT * FROM unnest(%s::text[], %s::bigint[])))
           FROM market.front_session f
           WHERE f.product = %s AND f.trade_date BETWEEN %s AND %s AND f.first_ordinal IS NOT NULL
           ORDER BY 1""",
        ([s for s, _ in stages], [v for _, v in stages], product, start, end),
    ).fetchall()
    return [(*r[:7], r[7] == len(stages)) for r in rows]


def plan(ids: dict[str, int]) -> tuple[list[str], str, list[tuple[str, int]]]:
    """The features in the engine's order and by its names, the query that reads them for one
    contract and session at the seconds that end a minute, and the stages (table, variant id)
    that must be warm. At such a second every slower timeframe's latest completed row ends at
    the same instant, so its age is zero."""
    names: list[str] = []
    select: list[str] = []
    joins: list[str] = []
    needed: list[tuple[str, int]] = []
    groups = {FAST.name: StageFeatures.SECONDLY} | dict(StageFeatures.STEPWISE)
    per_row = {FAST.name: 1, MIDDLE.name: MIDDLE.seconds, SLOW.name: SLOW.seconds}
    first = ""
    for timeframe, stages in groups.items():
        for stage in stages:
            alias = f"t{len(needed)}"
            table = store.STAGE_TABLE[stage]
            variant = ids.get(stage, 0)
            needed.append((table, variant))
            columns = StageFeatures.names(stage)
            names += [f"{StageFeatures.PREFIX[stage]}.{n}" for n in columns]
            select += [f'{alias}."{n}"' for n in columns]
            if not first:
                first = alias
                joins.append(f"FROM market.{table} {alias}")
                continue
            on = (
                f"{alias}.contract_id = {first}.contract_id AND {alias}.end_ns = {first}.end_ns "
                f"AND {alias}.slot_ordinal = {first}.slot_ordinal / {per_row[timeframe]}"
            )
            if variant:
                on += f" AND {alias}.variant_id = {variant}"
            joins.append(f"LEFT JOIN market.{table} {alias} ON {on}")
        if timeframe != FAST.name:  # the timeframe's age follows its features, as in the engine
            names.append(StageFeatures.AGES[timeframe].name)
            candle = f"t{len(needed) - len(stages)}"
            select.append(f"CASE WHEN {candle}.end_ns IS NULL THEN NULL ELSE 0 END")
    atr = next(
        f"t{i}" for i, (table, _) in enumerate(needed) if table == f"vol_{SLOW.rows}"
    )  # the slow timeframe's ATR in price units: context, the unit of R
    query = (
        f"SELECT {first}.slot_ordinal, {first}.end_ns, {atr}.atr_price, {', '.join(select)} "
        + " ".join(joins)
        + f" WHERE {first}.contract_id = %s AND {first}.slot_ordinal BETWEEN %s AND %s"
        f" AND {first}.slot_ordinal %% {ROW_SECONDS} = 0"
        f" AND {first}.end_ns > %s AND {first}.end_ns <= %s ORDER BY {first}.slot_ordinal"
    )
    return names, query, sorted(set(needed))


def session_rows(product, calendar, view, coverage, found, flagged: bool) -> dict:
    """One session's rows from the query's result: eligibility, the cost of a round trip in R,
    and the targets. `found` holds slot ordinal, row end, the slow ATR in price units, then the
    features (None for NULL)."""
    end = np.array([r[1] for r in found], np.int64)
    block = np.array([r[2:] for r in found], dtype=np.float64)  # NULL becomes NaN
    atr, x = block[:, 0], block[:, 1:].astype(np.float32)
    n = len(end)
    until = calendar.close_after(end) - EXECUTION.flat_before_close
    decision = end + EXECUTION.close_delay
    with np.errstate(invalid="ignore"):
        defined = np.isfinite(atr) & (atr > 0)
    distance = np.where(defined, np.round(R_ATR * atr * PX), 1).astype(np.int64)
    why = np.where(
        ~defined, NO_ATR, np.where(end + ENTRY_CUTOFF_S * NS <= until, ELIGIBLE, NO_ROOM)
    ).astype(np.int8)
    if flagged:
        why[why == ELIGIBLE] = FLAGGED
    reference = np.zeros(n, np.int64)
    cost = np.full(n, np.nan)
    commission = 2 * EXECUTION.commission_per_contract / product.tick_value * product.tick_size
    for i in np.flatnonzero(why == ELIGIBLE):
        seen = view.book.known(int(end[i]))  # the book the engine holds at the decision
        if seen is None or not seen.usable:
            why[i] = NO_BOOK
        elif seen.ask - seen.bid > SPREAD_LIMIT * distance[i]:
            why[i] = WIDE
        else:
            reference[i] = (seen.bid + seen.ask) // 2
            cost[i] = (seen.ask - seen.bid + commission) / distance[i]
    ok = why == ELIGIBLE
    y, state = np.full(n, np.nan), np.full(n, -1, np.int8)
    moves = np.full((n, len(HORIZONS_S)), np.nan)
    if ok.any():
        y[ok], _, state[ok] = targets.move_ahead(
            view, coverage, decision[ok], until[ok], reference[ok], distance[ok]
        )
        unit = np.round(atr[ok] * PX)  # the horizon map's moves are in slow ATRs
        moves[ok] = targets.moves(
            view, coverage, decision[ok], until[ok], reference[ok], unit, HORIZONS_S
        )
    return {
        "end": end,
        "why": why,
        "state": state,
        "y": y,
        "moves": moves,
        "cost_r": cost,
        "x": x,
    }


def build_sessions(root: str, sessions: list[tuple], query: str, url: str | None) -> dict:
    """One worker's task: consecutive front sessions of one product (trade date, contract id,
    symbol, first and last second ordinal, open, close, flagged)."""
    data = ProductData.load(root)
    product = data.product
    calendar, _, spans = load_sessions(product, sessions[0][0], sessions[-1][0], 0)
    by_date = {s.trade_date: s for s in spans}
    cache = DayCache(size=3, book=True)
    parts = []
    with db.connect(url) as conn:
        for day, cid, symbol, first, last, open_ns, close_ns, flagged in sessions:
            found = conn.execute(query, (cid, first, last, open_ns, close_ns)).fetchall()
            conn.rollback()
            if not found:
                continue
            session = by_date[day]
            source = HistoricalSource(product, data.files, [], [session], EXECUTION, symbol, cache)
            chunk = source.stored_chunk(symbol, session)[0]
            if not len(chunk.coverage) or not len(chunk.book):
                raise ValueError(f"No MBP-1 records for {symbol} on {day}: are its files present?")
            view = session_view(chunk, calendar, EXECUTION)
            part = session_rows(product, calendar, view, chunk.coverage, found, flagged)
            part["day"] = np.full(len(found), (day - date(2000, 1, 1)).days, np.int32)
            parts.append(part)
    return {"root": root, "parts": parts}


def _task(args: tuple) -> dict:
    return build_sessions(*args)


def settings() -> dict:
    return {
        "r_atr": R_ATR,
        "r_timeframe": SLOW.name,
        "entry_cutoff_s": ENTRY_CUTOFF_S,
        "spread_limit_r": SPREAD_LIMIT,
        "horizons_s": list(HORIZONS_S),
        "row_seconds": ROW_SECONDS,
        "close_delay_ms": EXECUTION.close_delay_ms,
        "flat_before_close_s": EXECUTION.flat_before_close_s,
        "commission_per_contract": EXECUTION.commission_per_contract,
    }


def build(
    products: list[str],
    start: date = DEV_START,
    end: date = DEV_END,
    workers: int | None = None,
    url: str | None = None,
    log=lambda line: None,
) -> dict:
    """The dataset of `products` over the period: one array per column, rows ordered by
    product, then time. `product` indexes `products`; `day` counts days from 2000-01-01."""
    check_period(start, end)
    products = list(dict.fromkeys(products))
    tasks, sessions, builders = [], {}, {}
    with db.connect(url) as conn:
        names, query, needed = plan(variant_ids(conn))
        for root in products:
            found = front_sessions(conn, root, start, end, needed)
            flagged = set(conn.execute(FLAGGED_QUERY, (sorted({s[1] for s in found}),)).fetchall())
            warm = [(*s[:7], (s[1], s[0]) in flagged) for s in found if s[7]]
            sessions[root] = {
                "used": len(warm),
                "not_warm": len(found) - len(warm),
                "flagged": sum(s[7] for s in warm),
            }
            tasks += [
                (root, warm[i : i + SESSIONS_PER_TASK], query, url)
                for i in range(0, len(warm), SESSIONS_PER_TASK)
            ]
        builders = dict(
            conn.execute(
                """SELECT s.stage || ':' || s.variant_id, max(b.sha256)
                   FROM market.stage_slice s JOIN market.builder b ON b.id = s.builder_id
                   GROUP BY 1"""
            ).fetchall()
        )
    workers = workers or max(1, min(8, (mp.cpu_count() or 2) - 2))
    started, parts, done = time.time(), [], 0
    log(
        f"Dataset: {sum(s['used'] for s in sessions.values())} sessions, {len(tasks)} tasks, "
        f"{workers} workers, {len(names)} features"
    )

    def collect(results) -> None:
        nonlocal done
        for result in results:
            parts.extend((products.index(result["root"]), p) for p in result["parts"])
            done += 1
            if done % 10 == 0 or done == len(tasks):
                log(f"  {done}/{len(tasks)} tasks, {time.time() - started:,.0f} s")

    if workers == 1:
        collect(map(_task, tasks))
    else:
        with ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn")) as pool:
            collect(f.result() for f in as_completed([pool.submit(_task, t) for t in tasks]))
    if not parts:
        raise ValueError(
            f"No rows for {products} from {start} to {end}: {sessions}. "
            "Are the stored rows built (`research ingest plan`)?"
        )
    parts.sort(key=lambda p: (p[0], int(p[1]["end"][0])))  # the same rows in the same order
    out = {k: np.concatenate([p[k] for _, p in parts]) for k in parts[0][1]}
    out["product"] = np.concatenate([np.full(len(p["end"]), k, np.int8) for k, p in parts])
    return out | {
        "names": names,
        "products": products,
        "period": [start.isoformat(), end.isoformat()],
        "sessions": sessions,
        "settings": settings(),
        "stored_rows": hashlib.sha256(json.dumps(builders, sort_keys=True).encode()).hexdigest(),
    }


ARRAYS = ("end", "why", "state", "y", "moves", "cost_r", "x", "day", "product")


def cached(
    products: list[str],
    start: date = DEV_START,
    end: date = DEV_END,
    workers: int | None = None,
    url: str | None = None,
    log=lambda line: None,
    rebuild: bool = False,
) -> dict:
    """`build`, kept in a file named by the products, the period, the settings, the feature
    list, and the builders of the stored rows: any change to one of them builds a new file."""
    check_period(start, end)
    products = list(dict.fromkeys(products))
    with db.connect(url) as conn:
        names, _, _ = plan(variant_ids(conn))
        builders = conn.execute(
            """SELECT s.stage || ':' || s.variant_id, max(b.sha256)
               FROM market.stage_slice s JOIN market.builder b ON b.id = s.builder_id
               GROUP BY 1 ORDER BY 1"""
        ).fetchall()
    identity = [products, start.isoformat(), end.isoformat(), settings(), names, builders]
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f"dataset-{key}.npz"
    meta = path.with_suffix(".json")
    if path.exists() and meta.exists() and not rebuild:
        log(f"Dataset: reading {path.relative_to(ROOT)}")
        with np.load(path) as stored:
            return {k: stored[k] for k in ARRAYS} | json.loads(meta.read_text())
    data = build(products, start, end, workers, url, log)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(path, **{k: data[k] for k in ARRAYS})
    meta.write_text(json.dumps({k: v for k, v in data.items() if k not in ARRAYS}))
    log(f"Dataset: wrote {path.relative_to(ROOT)}")
    return data
