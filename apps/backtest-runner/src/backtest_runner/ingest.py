"""Ingestion: Databento TBBO trades to stored one-second rows (`market.bar_1s`) and their
rolling `1m@1s` candles and features (`market.candle_1m_1s`). See docs/project/ingestion.md.

    uv run research ingest plan GC SI     # what would be built; writes no rows
    uv run research ingest run GC SI      # build new contracts and sessions, repair changes
    uv run research ingest status         # what is stored

Planning, per product:

1. **Sessions**: scheduled sessions whose hours lie inside the downloaded job ranges.
2. **Volumes and rolls**: each session's outright volumes are read once from the DBN files
   and cached (`market.session_scan`, `market.session_volume`); the front contract of each
   session follows the backtest rule (most volume in the previous session), `market.roll`.
3. **Spans**: every contract that is ever front is stored from `lead_sessions` before its
   first front session through its last, so its indicators are warm when it becomes front.
   An explicit `--contract` is stored for every session in which it traded.
4. **Diff**: a contract's stored sessions (`market.ingest_slice`) must be a prefix of its
   span, built by the current builder from the current files. New sessions extend it from the
   last checkpoint; a session whose files changed is rebuilt from the previous checkpoint.
   Rows from other code or settings, and new sessions before the first stored one, change
   every later value, so they need `--rebuild`, which replaces the contract's rows.

Running: a contract is one task (its sessions in order, state carried); tasks run in parallel
processes; each session commits its rows, slice record, and checkpoint in one transaction, so
an interrupted run resumes where it stopped.
"""

import hashlib
import json
import multiprocessing as mp
import os
import sys
import time
import traceback
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from importlib.metadata import version

import psycopg
from psycopg.types.json import Jsonb
from strategy_core.engine import MarketChunk
from strategy_core.execution import ExecutionConfig
from strategy_core.features import FeatureConfig
from strategy_core.market import NS, PRODUCTS, Product
from strategy_core.rows import ROWS_VERSION, SecondRowBuilder
from strategy_core.state import from_bytes, to_bytes

from . import catalog, db, store
from .calendars import PHASE_ORIGIN, Session, load_sessions
from .catalog import ROOT, DbnFile
from .source import DayCache, HistoricalSource, front_of, next_front, raw_quality

EXECUTION = ExecutionConfig()  # stored rows use the backtest defaults for trade assignment
FEATURES = FeatureConfig()
LEAD_SESSIONS = 5
LOCK_SPACE = 7_311  # pg advisory lock namespace for contracts being built
CORE = "lib/strategy-core/src/strategy_core"
RUNNER = "apps/backtest-runner/src/backtest_runner"
# Code that determines stored values: the calculations, and how ingestion selects files and
# sessions, feeds them to the builder, restores checkpoints, and writes rows (this module).
# Editing any of these files makes stored rows `stale` until they are rebuilt.
BUILDER_FILES = tuple(
    f"{CORE}/{name}.py"
    for name in (
        "bars",
        "features",
        "indicators",
        "kernels",
        "market",
        "metrics",
        "rows",
        "state",
        "window_metrics",
        "windows",
    )
) + tuple(f"{RUNNER}/{n}.py" for n in ("calendars", "catalog", "ingest", "source", "store"))
# Code that determines the cached session volumes, and so the roll schedule
SCAN_FILES = (
    f"{CORE}/bars.py",
    f"{CORE}/market.py",
    *(f"{RUNNER}/{n}.py" for n in ("calendars", "catalog", "source")),
)
PACKAGES = ("numpy", "numba", "databento", "pandas_market_calendars")
RUNNABLE = ("new", "extend", "repair", "rebuild")
Log = Callable[[str], None]


def stderr(line: str) -> None:
    print(line, file=sys.stderr, flush=True)


def builder_identity(product: Product, calendar_name: str) -> dict:
    """Everything that determines stored values: the code that computes them, assignment
    timing, feature settings, the calendar and phase origin, and numeric package versions."""
    code = hashlib.sha256()
    for rel in BUILDER_FILES:
        code.update(rel.encode())
        code.update((ROOT / rel).read_bytes())
    settings = {
        "rows_version": ROWS_VERSION,
        "product": product.root,
        "calendar": calendar_name,
        "phase_origin": PHASE_ORIGIN.isoformat(),
        "feed_latency_ns": EXECUTION.feed_latency,
        "close_delay_ns": EXECUTION.close_delay,
        "features": asdict(FEATURES),
        "packages": {p: version(p) for p in PACKAGES},
        "columns": {n: [f"{c.name} {c.sql}" for c in cols] for n, cols in store.TABLES.items()},
    }
    body = json.dumps({"code": code.hexdigest(), "settings": settings}, sort_keys=True)
    return {
        "sha256": hashlib.sha256(body.encode()).hexdigest(),
        "code_sha256": code.hexdigest(),
        "settings": settings,
    }


@dataclass
class ProductData:
    """A product's DBN files and the downloaded `[start, end)` ranges of its jobs."""

    product: Product
    files: dict[date, DbnFile]
    ranges: list[tuple[int, int]]

    @classmethod
    def load(cls, root: str) -> "ProductData":
        if root not in PRODUCTS:
            raise ValueError(f"Unknown product {root!r}; known: {sorted(PRODUCTS)}")
        p = PRODUCTS[root]
        return cls(
            p,
            catalog.files_for(p.parent_symbol, p.dataset),
            catalog.job_ranges(p.parent_symbol, p.dataset),
        )

    def merged(self) -> list[tuple[int, int]]:
        out: list[list[int]] = []
        for lo, hi in sorted(self.ranges):
            if out and lo <= out[-1][1]:
                out[-1][1] = max(out[-1][1], hi)
            else:
                out.append([lo, hi])
        return [(a, b) for a, b in out]

    def downloaded(self, s: Session) -> bool:
        return any(lo <= s.open and s.close <= hi for lo, hi in self.merged())

    def sessions(self) -> tuple[str, list[Session], list[Session]]:
        """Calendar name, all sessions in the downloaded period, and the downloaded ones."""
        ranges = self.merged()
        if not ranges:
            raise ValueError(f"No {self.product.parent_symbol} TBBO jobs under data/")
        first = datetime.fromtimestamp(ranges[0][0] // NS, UTC).date()
        last = datetime.fromtimestamp((ranges[-1][1] - 1) // NS, UTC).date()
        calendar, _, sessions = load_sessions(self.product, first, last, 0)
        return calendar.name, sessions, [s for s in sessions if self.downloaded(s)]


def session_files(source: HistoricalSource, s: Session) -> list[dict]:
    """The files a session reads, with checksums and conditions: a change means rebuild."""
    return [
        {"file": f.path.name, "job": f.job_id, "sha256": f.sha256, "condition": f.condition}
        for _, f in source.day_files(s)
        if f is not None and f.present
    ]


def scan_identity() -> str:
    """Digest of the code and settings that compute session volumes: a cached scan is reused
    only while it matches, so rolls never come from volumes computed another way."""
    digest = hashlib.sha256()
    for rel in SCAN_FILES:
        digest.update(rel.encode())
        digest.update((ROOT / rel).read_bytes())
    digest.update(
        f"{EXECUTION.feed_latency} {EXECUTION.close_delay} {version('databento')}".encode()
    )
    return digest.hexdigest()


def contract_id(conn: psycopg.Connection, product: Product, symbol: str, on: date) -> int:
    month = product.contract_month(symbol, on)
    row = conn.execute(
        """INSERT INTO market.contract (product, raw_symbol, contract_month, dataset, tick_size,
               tick_value) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (product, raw_symbol, contract_month)
           DO UPDATE SET product = EXCLUDED.product
           RETURNING id""",
        (product.root, symbol, month, product.dataset, product.tick_size, product.tick_value),
    ).fetchone()
    return int(row[0])


def builder_id(conn: psycopg.Connection, identity: dict) -> int:
    row = conn.execute(
        """INSERT INTO market.builder (sha256, product, code_sha256, settings)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING id""",
        (
            identity["sha256"],
            identity["settings"]["product"],
            identity["code_sha256"],
            Jsonb(identity["settings"]),
        ),
    ).fetchone()
    return int(row[0])


def scan_sessions(
    conn: psycopg.Connection, source: HistoricalSource, sessions: list[Session], log: Log
) -> int:
    """Read outright volumes of sessions not yet scanned, scanned from other files, or scanned
    by other code or settings (`scan_identity`)."""
    product = source.product
    identity = scan_identity()
    known = {
        day: (files, sha)
        for day, files, sha in conn.execute(
            """SELECT trade_date, source_files, scan_sha256 FROM market.session_scan
               WHERE product = %s""",
            (product.root,),
        )
    }
    todo = [s for s in sessions if known.get(s.trade_date) != (session_files(source, s), identity)]
    for i, s in enumerate(todo, 1):
        volumes = source.outright_volumes(s)
        with conn.transaction():
            conn.execute(
                "DELETE FROM market.session_scan WHERE product = %s AND trade_date = %s",
                (product.root, s.trade_date),
            )
            conn.execute(
                """INSERT INTO market.session_scan (product, trade_date, open_ns, close_ns,
                       complete, source_files, scan_sha256) VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (
                    product.root,
                    s.trade_date,
                    s.open,
                    s.close,
                    volumes is not None,
                    Jsonb(session_files(source, s)),
                    identity,
                ),
            )
            for symbol, volume in (volumes or {}).items():
                conn.execute(
                    """INSERT INTO market.session_volume (product, trade_date, contract_id, volume)
                       VALUES (%s, %s, %s, %s)""",
                    (
                        product.root,
                        s.trade_date,
                        contract_id(conn, product, symbol, s.trade_date),
                        volume,
                    ),
                )
        if i % 25 == 0 or i == len(todo):
            log(f"{product.root}: scanned volumes of {i}/{len(todo)} sessions")
    return len(todo)


def session_volumes(conn: psycopg.Connection, product: Product) -> tuple[dict, dict, dict]:
    """Per trade date: {symbol: volume} for complete sessions, completeness, and symbol ids."""
    complete = dict(
        conn.execute(
            "SELECT trade_date, complete FROM market.session_scan WHERE product = %s",
            (product.root,),
        ).fetchall()
    )
    volumes: dict[date, dict[str, int]] = {}
    ids: dict[str, int] = {}
    for day, symbol, cid, volume in conn.execute(
        """SELECT v.trade_date, c.raw_symbol, c.id, v.volume FROM market.session_volume v
           JOIN market.contract c ON c.id = v.contract_id WHERE v.product = %s""",
        (product.root,),
    ):
        volumes.setdefault(day, {})[symbol] = int(volume)
        ids[(symbol, day)] = int(cid)
    return volumes, complete, ids


def update_rolls(
    conn: psycopg.Connection, product: Product, calendar: list[Session], downloaded: list[Session]
) -> dict[date, str]:
    """Front contract per downloaded session by the backtest rule (`source.next_front`: most
    volume in the complete previous session, forward only, else kept). The first session of
    each downloaded range uses its own volume (not causal, and marked so), so a contract from
    before a download gap is never carried over it. Returns {trade_date: symbol}."""
    volumes, complete, ids = session_volumes(conn, product)
    previous = {s.trade_date: calendar[i - 1].trade_date for i, s in enumerate(calendar) if i}
    have = {s.trade_date for s in downloaded}
    front: dict[date, tuple[str, str]] = {}
    current = None
    for s in downloaded:
        before = previous.get(s.trade_date)
        if before not in have:  # first session of a downloaded range: choose afresh
            current = None
        prev_volumes = volumes.get(before) if before and complete.get(before) else None
        found, basis = next_front(product, prev_volumes, current, s.trade_date)
        if found is None and complete.get(s.trade_date) and volumes.get(s.trade_date):
            found, basis = front_of(volumes[s.trade_date]), "same_session"
        if found is None:
            continue
        current = found
        front[s.trade_date] = (current, basis)
    with conn.transaction():
        conn.execute("DELETE FROM market.roll WHERE product = %s", (product.root,))
        for day, (symbol, basis) in front.items():
            cid = ids.get((symbol, day)) or contract_id(conn, product, symbol, day)
            conn.execute(
                """INSERT INTO market.roll (product, trade_date, contract_id, basis)
                   VALUES (%s, %s, %s, %s)""",
                (product.root, day, cid, basis),
            )
    return {d: f for d, (f, _) in front.items()}


@dataclass
class ContractPlan:
    product: str
    contract: str
    contract_id: int
    sessions: list[str]  # trade dates of the contract's span, in order
    stored: int  # sessions stored by the current builder from the current files
    start: int  # index of the first session to build
    delete_from: str | None  # stored sessions from this trade date on are replaced
    action: str  # new, extend, repair, rebuild, current, stale, needs_rebuild
    reason: str = ""
    rows: int = 0  # scheduled seconds to build

    @property
    def todo(self) -> int:
        return len(self.sessions) - self.start if self.action in RUNNABLE else 0


def spans(
    period: list[Session],
    front: dict[date, str],
    volumes: dict[date, dict[str, int]],
    *,
    contract: str | None,
    start: date | None,
    end: date | None,
    lead: int,
) -> dict[str, list[Session]]:
    """Consecutive scheduled sessions to store per contract. `period` holds every session from
    the first to the last downloaded one, so a span never skips one: sessions in a gap between
    downloads become rows without data coverage (missing), never a jump in the index counter,
    and are rebuilt when the gap is downloaded."""
    index = {s.trade_date: i for i, s in enumerate(period)}
    out: dict[str, list[Session]] = {}
    if contract:
        traded = [s for s in period if volumes.get(s.trade_date, {}).get(contract)]
        if traded:
            out[contract] = period[index[traded[0].trade_date] : index[traded[-1].trade_date] + 1]
    else:
        by_contract: dict[str, list[int]] = {}
        for day, symbol in front.items():
            by_contract.setdefault(symbol, []).append(index[day])
        for symbol, idx in by_contract.items():
            out[symbol] = period[max(min(idx) - lead, 0) : max(idx) + 1]
    for symbol in list(out):
        out[symbol] = [
            s
            for s in out[symbol]
            if (start is None or s.trade_date >= start) and (end is None or s.trade_date <= end)
        ]
        if not out[symbol]:
            del out[symbol]
    return out


def diff(
    span: list[Session],
    period: list[Session],
    stored: list[tuple],
    builder: int,
    expected: dict[date, list[dict]],
    rebuild: bool,
) -> tuple[list[Session], int, date | None, str, str]:
    """(span, start index, delete-from date, action, reason) for one contract. The span grows
    to cover every stored session first, so a rebuild or repair never drops stored sessions
    outside `--start` or `--end`."""
    if not stored:
        return span, 0, None, "new", ""
    first_stored, last_stored = stored[0][0], stored[-1][0]
    lo, hi = min(first_stored, span[0].trade_date), max(last_stored, span[-1].trade_date)
    span = [s for s in period if lo <= s.trade_date <= hi]
    if any(b != builder for _, b, _ in stored):
        if rebuild:
            return span, 0, first_stored, "rebuild", "stored by other code or settings"
        return span, len(span), None, "stale", "stored by other code or settings; use --rebuild"
    files = {d: f for d, _, f in stored}
    i = 0
    while i < len(span) and files.get(span[i].trade_date) == expected[span[i].trade_date]:
        i += 1
    if i == len(span):
        return span, i, None, "current", ""
    later = any(d >= span[i].trade_date for d in files)
    if i == 0:
        why = "a session before the stored ones, or the first session's files changed"
        if rebuild:
            return span, 0, first_stored, "rebuild", why
        return span, len(span), None, "needs_rebuild", why + "; use --rebuild"
    if later:
        return span, i, span[i].trade_date, "repair", "files changed or sessions missing"
    return span, i, None, "extend", ""


def plan_product(
    conn: psycopg.Connection,
    data: ProductData,
    *,
    contract: str | None = None,
    start: date | None = None,
    end: date | None = None,
    lead: int = LEAD_SESSIONS,
    rebuild: bool = False,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> dict:
    product = data.product
    if contract is not None and not product.is_outright(contract):
        raise ValueError(f"{contract!r} is not a {product.root} outright contract")
    calendar_name, calendar, downloaded = data.sessions()
    identity = builder_identity(product, calendar_name)
    builder = builder_id(conn, identity)
    source = HistoricalSource(
        product, data.files, [], downloaded, EXECUTION, None, cache or DayCache()
    )
    scan_sessions(conn, source, downloaded, log)
    front = update_rolls(conn, product, calendar, downloaded)
    volumes, _, _ = session_volumes(conn, product)
    period = [
        s for s in calendar if downloaded and downloaded[0].open <= s.open <= downloaded[-1].open
    ]
    expected = {s.trade_date: session_files(source, s) for s in period}
    plans = []
    for symbol, span in spans(
        period, front, volumes, contract=contract, start=start, end=end, lead=lead
    ).items():
        cid = contract_id(conn, product, symbol, span[-1].trade_date)
        stored = conn.execute(
            """SELECT trade_date, builder_id, source_files FROM market.ingest_slice
               WHERE contract_id = %s ORDER BY trade_date""",
            (cid,),
        ).fetchall()
        span, i, delete_from, action, reason = diff(
            span, period, stored, builder, expected, rebuild
        )
        todo = span[i:] if action in RUNNABLE else []
        plans.append(
            ContractPlan(
                product.root,
                symbol,
                cid,
                [s.trade_date.isoformat() for s in span],
                i if action not in ("stale", "needs_rebuild") else 0,
                i,
                delete_from.isoformat() if delete_from else None,
                action,
                reason,
                sum((s.close - s.open) // NS for s in todo),
            )
        )
    plans.sort(key=lambda p: (p.sessions[0], p.contract))
    return {
        "product": product.root,
        "builder_id": builder,
        "builder": identity["sha256"][:12],
        "downloaded_sessions": len(downloaded),
        "first_session": downloaded[0].trade_date.isoformat() if downloaded else None,
        "last_session": downloaded[-1].trade_date.isoformat() if downloaded else None,
        "front_sessions": len(front),
        "contracts": plans,
    }


def require_migrated(conn: psycopg.Connection) -> None:
    pending = [
        f"{r['version']:04d}_{r['name']}" for r in db.status(conn) if r["state"] != "applied"
    ]
    if pending:
        raise ValueError(f"Database migrations not applied: {pending}; run `research db migrate`")


def build_contract(
    plan: dict,
    builder: int,
    run_id: int,
    url: str,
    data: ProductData,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> dict:
    """Build one contract's sessions from `plan["start"]` on, in order, resuming from the
    checkpoint of the session before. Each session commits on its own."""
    product, symbol, cid = data.product, plan["contract"], plan["contract_id"]
    dates = [date.fromisoformat(d) for d in plan["sessions"]]
    calendar, _, sessions = load_sessions(product, dates[0], dates[-1], 0)
    by_date = {s.trade_date: s for s in sessions}
    span = [by_date[d] for d in dates]
    source = HistoricalSource(product, data.files, [], span, EXECUTION, symbol, cache or DayCache())
    rows_builder = SecondRowBuilder(
        calendar,
        feed_latency=EXECUTION.feed_latency,
        close_delay=EXECUTION.close_delay,
        config=FEATURES,
    )
    done, total_rows, started = 0, 0, time.time()
    with db.connect(url) as conn:
        conn.autocommit = True  # each session's transaction commits on its own
        locked = conn.execute("SELECT pg_try_advisory_lock(%s, %s)", (LOCK_SPACE, cid)).fetchone()
        if not locked[0]:
            raise RuntimeError(f"{symbol} is being built by another ingest run")
        if plan["delete_from"]:
            with conn.transaction():
                first = conn.execute(
                    """SELECT min(first_ordinal) FROM market.ingest_slice
                       WHERE contract_id = %s AND trade_date >= %s""",
                    (cid, plan["delete_from"]),
                ).fetchone()[0]
                if first is not None:
                    store.delete_rows(conn, cid, int(first))
                conn.execute(
                    "DELETE FROM market.ingest_slice WHERE contract_id = %s AND trade_date >= %s",
                    (cid, plan["delete_from"]),
                )
        if plan["start"] > 0:
            state = conn.execute(
                "SELECT state FROM market.ingest_slice WHERE contract_id = %s AND trade_date = %s",
                (cid, dates[plan["start"] - 1]),
            ).fetchone()
            if state is None:
                raise RuntimeError(f"{symbol}: no checkpoint for {dates[plan['start'] - 1]}")
            rows_builder.restore(from_bytes(state[0]))
        for s in span[plan["start"] :]:
            t0 = time.time()
            trades, coverage, unmapped = source.session_trades(symbol, s)
            label = f"{s.trade_date} {symbol}"
            rows = rows_builder.process(
                MarketChunk(symbol, s.open, s.close, trades, coverage, label)
            )
            base = rows.base.values
            report = {
                "aggregation": asdict(rows.report),
                "raw": raw_quality(trades),
                "contract_unmapped_days": [d.isoformat() for d in unmapped],
            }
            with conn.transaction():
                store.write_rows(conn, cid, rows)
                conn.execute(
                    """INSERT INTO market.ingest_slice (contract_id, trade_date, builder_id, run_id,
                           open_ns, close_ns, first_ordinal, last_ordinal, row_count, observed,
                           missing, report, source_files, state, build_seconds)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        cid,
                        s.trade_date,
                        builder,
                        run_id,
                        s.open,
                        s.close,
                        int(base["slot_ordinal"][0]),
                        int(base["slot_ordinal"][-1]),
                        len(rows),
                        int((base["status"] == 2).sum()),
                        int((base["status"] == 0).sum()),
                        Jsonb(report),
                        Jsonb(session_files(source, s)),
                        to_bytes(rows_builder.export()),
                        time.time() - t0,
                    ),
                )
            done += 1
            total_rows += len(rows)
            observed = (base["status"] == 2).mean()
            log(
                f"{product.root} {symbol} {s.trade_date}: {len(rows):,} rows, "
                f"{observed:.0%} with trades, {int((base['status'] == 0).sum()):,} missing, "
                f"{time.time() - t0:.1f}s ({done}/{len(span) - plan['start']})"
            )
    return {
        "contract": symbol,
        "sessions": done,
        "rows": total_rows,
        "seconds": time.time() - started,
    }


def _task(args: tuple) -> dict:
    plan, builder, run_id, url, data = args
    try:
        return build_contract(plan, builder, run_id, url, data)
    except Exception as error:  # report per contract; the other contracts continue
        return {"contract": plan["contract"], "error": f"{error}", "trace": traceback.format_exc()}


def plan(
    products: list[str],
    *,
    contract: str | None = None,
    start: date | None = None,
    end: date | None = None,
    lead: int = LEAD_SESSIONS,
    rebuild: bool = False,
    url: str | None = None,
    data: dict[str, ProductData] | None = None,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> list[dict]:
    products = list(dict.fromkeys(products))  # `GC GC` must not plan every contract twice
    if contract is not None and len(products) != 1:
        raise ValueError("--contract needs exactly one product")
    if type(lead) is not int or not 0 <= lead <= 60:
        raise ValueError("lead sessions must be an integer from 0 to 60")
    with db.connect(url) as conn:
        conn.autocommit = True  # each `transaction()` block commits on its own
        require_migrated(conn)
        store.apply_comments(conn)
        if data is None:
            db.register_files(conn, [f for f in catalog.discover(schema=None) if f.present])
        sources = data or {p: ProductData.load(p) for p in products}
        return [
            plan_product(
                conn,
                sources[p],
                contract=contract,
                start=start,
                end=end,
                lead=lead,
                rebuild=rebuild,
                cache=cache,
                log=log,
            )
            for p in products
        ]


def run(
    products: list[str],
    *,
    workers: int | None = None,
    url: str | None = None,
    data: dict[str, ProductData] | None = None,
    cache: DayCache | None = None,
    log: Log = stderr,
    **options,
) -> dict:
    url = url or db.database_url()
    products = list(dict.fromkeys(products))
    plans = plan(products, url=url, data=data, cache=cache, log=log, **options)
    sources = data or {p: ProductData.load(p) for p in products}
    tasks = [(p, c) for p in plans for c in p["contracts"] if c.todo]
    tasks.sort(key=lambda t: -t[1].rows)  # largest first balances the workers
    summary = summarize(plans)
    if not tasks:
        return {**summary, "run_id": None, "results": []}
    with db.connect(url) as conn:
        dates = [s for _, c in tasks for s in c.sessions[c.start :]]
        first = min(date.fromisoformat(d) for d in dates)
        last = max(date.fromisoformat(d) for d in dates)
        store.ensure_partitions(
            conn, store.to_ns(first) - 2 * 86_400 * NS, store.to_ns(last) + 86_400 * NS
        )
        command = {
            "products": products,
            "workers": workers,
            **{k: str(v) for k, v in options.items()},
        }
        run_id = conn.execute(
            "INSERT INTO market.ingest_run (command, status) VALUES (%s, 'running') RETURNING id",
            (Jsonb(command),),
        ).fetchone()[0]
        conn.commit()
    workers = workers or max(1, min(len(tasks), (os.cpu_count() or 2) - 2))
    log(f"Ingest run {run_id}: {len(tasks)} contracts, {sum(c.todo for _, c in tasks)} sessions, "
        f"{sum(c.rows for _, c in tasks):,} rows, {workers} workers")  # fmt: skip
    args = [(asdict(c), p["builder_id"], run_id, url, sources[c.product]) for p, c in tasks]
    results, status = [], "failed"
    try:
        if workers == 1:
            for a in args:
                try:
                    results.append(build_contract(*a, cache=cache, log=log))
                except Exception as error:
                    results.append({"contract": a[0]["contract"], "error": str(error)})
        else:
            with ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn")) as pool:
                for future in as_completed([pool.submit(_task, a) for a in args]):
                    result = future.result()
                    results.append(result)
                    if "error" in result:
                        log(f"FAILED {result['contract']}: {result['error']}\n{result['trace']}")
        failed = [r for r in results if "error" in r]
        status = "done" if not failed else "partial" if len(failed) < len(results) else "failed"
        if len(failed) < len(results):  # fresh planner statistics for the new rows
            with db.connect(url) as conn:
                conn.autocommit = True
                conn.execute("ANALYZE market.bar_1s, market.candle_1m_1s")
            log("Analyzed market.bar_1s and market.candle_1m_1s")
    finally:
        with db.connect(url) as conn:
            conn.execute(
                """UPDATE market.ingest_run SET finished_at = now(), status = %s, summary = %s,
                       error = %s WHERE id = %s""",
                (
                    status,
                    Jsonb(
                        {
                            **summary,
                            "results": [
                                {k: v for k, v in r.items() if k != "trace"} for r in results
                            ],
                        }
                    ),
                    "; ".join(f"{r['contract']}: {r['error']}" for r in results if "error" in r)
                    or None,
                    run_id,
                ),
            )
    results = [{k: v for k, v in r.items() if k != "trace"} for r in results]  # logged above
    return {**summary, "run_id": run_id, "status": status, "results": results}


def summarize(plans: list[dict]) -> dict:
    products = []
    for p in plans:
        contracts = [
            {
                "contract": c.contract,
                "action": c.action,
                "sessions": len(c.sessions),
                "first": c.sessions[0],
                "last": c.sessions[-1],
                "stored": c.stored,
                "todo": c.todo,
                "rows": c.rows,
                **({"reason": c.reason} if c.reason else {}),
            }
            for c in p["contracts"]
        ]
        products.append({k: v for k, v in p.items() if k != "contracts"} | {"contracts": contracts})
    return {
        "products": products,
        "todo_sessions": sum(c["todo"] for p in products for c in p["contracts"]),
        "todo_rows": sum(c["rows"] for p in products for c in p["contracts"]),
    }


def status(url: str | None = None) -> dict:
    """The continuous series per product (front sessions stored, rolls), stored contracts with
    their sessions, rows, and builders, table sizes, and recent runs."""
    with db.connect(url) as conn:
        require_migrated(conn)
        stored = conn.execute(
            """SELECT c.product, c.raw_symbol, count(*), min(s.trade_date), max(s.trade_date),
                          sum(s.row_count), sum(s.observed), sum(s.missing),
                          array_agg(DISTINCT left(b.sha256, 12)), max(s.ingested_at)
                   FROM market.ingest_slice s
                   JOIN market.contract c ON c.id = s.contract_id
                   JOIN market.builder b ON b.id = s.builder_id
                   GROUP BY 1, 2 ORDER BY 1, 4"""
        ).fetchall()
        contracts = [
            {
                "product": product,
                "contract": symbol,
                "sessions": int(n),
                "first": first.isoformat(),
                "last": last.isoformat(),
                "rows": int(rows),
                "with_trades": round(float(observed) / float(rows), 3) if rows else None,
                "missing_rows": int(missing),
                "builders": builders,
                "last_ingested": at.isoformat(),
            }
            for product, symbol, n, first, last, rows, observed, missing, builders, at in stored
        ]
        continuous = [
            {
                "product": product,
                "front_sessions": int(n),
                "stored_sessions": int(stored_n),
                "first": first.isoformat(),
                "last": last.isoformat(),
                "missing": [d.isoformat() for d in (missing or [])],
                "contracts": contracts_rolled or [],
            }
            for product, n, stored_n, first, last, missing, contracts_rolled in conn.execute(
                """SELECT product, count(*), count(first_ordinal), min(trade_date), max(trade_date),
                          (array_agg(trade_date ORDER BY trade_date)
                              FILTER (WHERE first_ordinal IS NULL))[1:10],
                          array_agg(contract ORDER BY trade_date) FILTER (WHERE rolled)
                   FROM market.front_session GROUP BY product ORDER BY product"""
            )
        ]
        sizes = {
            name: int(
                conn.execute(
                    """SELECT coalesce(sum(pg_total_relation_size(relid)), 0)
                       FROM pg_partition_tree(%s)""",
                    (f"market.{name}",),
                ).fetchone()[0]
            )
            for name in store.TABLES
        }
        runs = [
            {"id": i, "started": s.isoformat(), "status": st, "error": e}
            for i, s, st, e in conn.execute(
                """SELECT id, started_at, status, error FROM market.ingest_run
                   ORDER BY id DESC LIMIT 5"""
            )
        ]
    return {
        "continuous": continuous,  # per product: front sessions stored (first 10 missing)
        "contracts": contracts,
        "table_gigabytes": {k: round(v / 1e9, 2) for k, v in sizes.items()},
        "recent_runs": runs,
    }
