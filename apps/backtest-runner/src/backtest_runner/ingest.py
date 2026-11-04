"""Ingestion: Databento TBBO trades to the stored rows of every stage (`pipeline.STAGES`): the
one-second and one-minute base rows (`market.bar_1s`, `market.bar_1m`) and their rolling
`1m@1s` and `1h@1m` candles and features (`market.candle_1m_1s`, `market.candle_1h_1m`). See
docs/project/ingestion.md.

    uv run research ingest plan GC SI     # what would be built; writes no rows
    uv run research ingest run GC SI      # build new contracts and sessions, repair changes
    uv run research ingest status         # what is stored

Planning, per product:

1. **Sessions**: scheduled sessions whose hours lie inside the downloaded job ranges.
2. **Volumes and rolls**: each session's outright volumes are read once from the DBN files
   and cached (`market.session_scan`, `market.session_volume`); the front contract of each
   session follows the backtest rule (most volume in the previous session). Planning only
   computes it; `run` publishes it to `market.roll` where the matching rows are stored.
3. **Spans**: every contract that is ever front is stored from the lead before its first
   front session through its last, so its values have settled when it becomes front. The lead
   is derived from the stages' warm-ups (`required_lead`), at least `LEAD_FLOOR` sessions.
   An explicit `--contract` is stored for every session in which it traded.
4. **Diff**: a contract's stored sessions (`market.ingest_slice`, one per session, and
   `market.stage_slice`, one per stage and session) must be a prefix of its span, built by the
   current builders from the current files. Each stage has its own builder identity
   (`identities`), so a stage whose code changed is rebuilt while the others stay current.
   New sessions extend it from the last checkpoints; a session whose files changed is rebuilt
   from the previous checkpoints; a stage with no rows yet is added. Rows from other code or
   settings, and new sessions before the first stored one, change every later value, so they
   need `--rebuild`, which replaces the contract's rows.

Running: a contract is one task (its sessions in order, state carried); tasks run in parallel
processes; each session commits its rows, slice records, and checkpoints in one transaction, so
an interrupted run resumes where it stopped. Every stage is computed in memory from the DBN
files; only the stages that are not current for a session are written.
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
from strategy_core import warmup
from strategy_core.execution import ExecutionConfig
from strategy_core.features import FeatureConfig
from strategy_core.market import NS, PRODUCTS, Product
from strategy_core.pipeline import STAGES, Pipeline
from strategy_core.stages import StageContext
from strategy_core.state import from_bytes, to_bytes

from . import catalog, db, store
from .calendars import PHASE_ORIGIN, Session, load_sessions
from .catalog import ROOT, DbnFile
from .source import DayCache, HistoricalSource, front_of, next_front, raw_quality

EXECUTION = ExecutionConfig()  # stored rows use the backtest defaults for trade assignment
FEATURES = FeatureConfig()
LEAD_FLOOR = 40  # sessions; reserves the lead the planned stages need (feature-pipeline.md)
LOCK_SPACE = 7_311  # pg advisory lock namespace for contracts being built
CORE = "lib/strategy-core/src/strategy_core"
RUNNER = "apps/backtest-runner/src/backtest_runner"
# Code that determines the market source of every stage: which files and sessions are read,
# their hours, how trades are decoded and filtered, and the chunk each session feeds the
# stages (`HistoricalSource.stored_chunk`). Each stage's own code is listed in its `MODULES`,
# and how its values are written in CODEC_FILES. Ingestion's orchestration (this module and
# store.py: which sessions, in which order, from which checkpoint) computes and encodes no
# values; tests prove that stored rows equal the pipeline's output in any chunking, so editing
# it leaves stored rows current, and adding a stage never makes the others stale.
SOURCE_FILES = (
    f"{CORE}/market.py",
    *(f"{RUNNER}/{n}.py" for n in ("calendars", "catalog", "source")),
)
# Code that determines the cached session volumes, and so the roll schedule: how volumes are
# summed (source.py), over which hours and files, and how scans are judged complete and stored
# (scan_sessions in this module). Editing any of them rescans every session, about 15 s.
SCAN_FILES = (
    f"{CORE}/bars.py",
    f"{CORE}/market.py",
    *(f"{RUNNER}/{n}.py" for n in ("calendars", "catalog", "ingest", "source")),
)
SOURCE_PACKAGES = ("databento", "pandas_market_calendars")
STAGE_PACKAGES = ("numpy", "numba")
CODEC_FILES = (f"{RUNNER}/codec.py",)
RUNNABLE = ("new", "extend", "add", "repair", "rebuild")
Log = Callable[[str], None]


def stderr(line: str) -> None:
    print(line, file=sys.stderr, flush=True)


def _identity(stage: str, files: list[str], settings: dict) -> dict:
    code = hashlib.sha256()
    for rel in files:
        code.update(rel.encode())
        code.update((ROOT / rel).read_bytes())
    body = json.dumps({"code": code.hexdigest(), "settings": settings}, sort_keys=True)
    return {
        "stage": stage,
        "sha256": hashlib.sha256(body.encode()).hexdigest(),
        "code_sha256": code.hexdigest(),
        "settings": settings,
    }


def stage_context(calendar=None) -> StageContext:
    """Settings and warm-ups never read the calendar, so planning builds stages without one."""
    return StageContext(calendar, EXECUTION.feed_latency, EXECUTION.close_delay, FEATURES)


def identities(product: Product, calendar_name: str) -> dict[str, dict]:
    """Builder identity of the market source and of every stage: the code that computes its
    values, its settings, its columns, numeric package versions, and its inputs' identities.
    A stage's identity changes only when something it depends on changes."""
    source = _identity(
        "source",
        list(SOURCE_FILES),
        {
            "product": product.root,
            "calendar": calendar_name,
            "phase_origin": PHASE_ORIGIN.isoformat(),
            "feed_latency_ns": EXECUTION.feed_latency,
            "close_delay_ns": EXECUTION.close_delay,
            "packages": {p: version(p) for p in SOURCE_PACKAGES},
        },
    )
    out = {"source": source}
    for cls in STAGES:
        stage = cls(stage_context())
        out[cls.NAME] = _identity(
            cls.NAME,
            [f"{CORE}/{m}.py" for m in cls.MODULES] + list(CODEC_FILES),
            {
                "product": product.root,
                "stage": cls.NAME,
                "tier": cls.TIER,
                "settings": stage.settings(),
                "columns": [f"{c.name} {c.sql}" for c in cls.COLUMNS],
                "packages": {p: version(p) for p in STAGE_PACKAGES},
                "inputs": {n: out["source" if n == "market" else n]["sha256"] for n in cls.INPUTS},
            },
        )
    return out


def required_lead(session_seconds: int) -> tuple[int, str]:
    """Sessions of lead that every stage's derived warm-up needs, and the stage that needs the
    most. `session_seconds` is a typical session's open time. `LEAD_FLOOR` adds the margin."""
    need = warm_sessions(session_seconds)
    name = max(need, key=need.get)
    return need[name], name


def warm_sessions(session_seconds: int) -> dict[str, int]:
    """Per stage: stored sessions a contract must have run before a session is warm."""
    return {
        cls.NAME: warmup.sessions(cls(stage_context()).warmup(), 1, session_seconds)
        for cls in STAGES
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
    """The files a session reads, with checksums, conditions, and the part of each day they
    cover (`DbnFile.window`, from the job's requested range): a change means rebuild."""
    return [
        {"file": f.path.name, "job": f.job_id, "sha256": f.sha256, "condition": f.condition}
        | {"window": list(f.window)}
        for _, f in source.day_files(s)
        if f is not None and f.present
    ]


def scan_identity() -> str:
    """Digest of the code, settings, and packages that compute session volumes, including the
    exchange calendar, which sets each session's hours. A cached scan is reused only while it
    matches, so rolls never come from volumes computed another way."""
    digest = hashlib.sha256()
    for rel in SCAN_FILES:
        digest.update(rel.encode())
        digest.update((ROOT / rel).read_bytes())
    packages = " ".join(f"{p}={version(p)}" for p in ("databento", "pandas_market_calendars"))
    digest.update(f"{EXECUTION.feed_latency} {EXECUTION.close_delay} {packages}".encode())
    return digest.hexdigest()


def contract_id(conn: psycopg.Connection, product: Product, symbol: str, on: date) -> int:
    return contract_id_for(conn, product, symbol, product.contract_month(symbol, on))


def contract_id_for(conn: psycopg.Connection, product: Product, symbol: str, month: date) -> int:
    """The contract with this raw symbol and delivery month (symbols repeat each decade)."""
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
        """INSERT INTO market.builder (sha256, product, code_sha256, settings, stage)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING id""",
        (
            identity["sha256"],
            identity["settings"]["product"],
            identity["code_sha256"],
            Jsonb(identity["settings"]),
            identity["stage"],
        ),
    ).fetchone()
    return int(row[0])


def scan_sessions(
    conn: psycopg.Connection, source: HistoricalSource, sessions: list[Session], log: Log
) -> int:
    """Read outright volumes of sessions not yet scanned, or scanned from other files, by other
    code or settings (`scan_identity`), or over other session hours."""
    product = source.product
    identity = scan_identity()
    known = {
        day: (files, sha, open_ns, close_ns)
        for day, files, sha, open_ns, close_ns in conn.execute(
            """SELECT trade_date, source_files, scan_sha256, open_ns, close_ns
               FROM market.session_scan WHERE product = %s""",
            (product.root,),
        )
    }
    todo = [
        s
        for s in sessions
        if known.get(s.trade_date) != (session_files(source, s), identity, s.open, s.close)
    ]
    for i, s in enumerate(todo, 1):
        # partial volumes are kept (a contract's extent); rolls use complete sessions only
        volumes, complete = source.session_volumes(s, partial=True)
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
                    complete,
                    Jsonb(session_files(source, s)),
                    identity,
                ),
            )
            for symbol, volume in volumes.items():
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


def front_schedule(
    conn: psycopg.Connection, product: Product, calendar: list[Session], downloaded: list[Session]
) -> tuple[dict[date, tuple[str, str]], list[date]]:
    """Front contract per downloaded session by the backtest rule (`source.next_front`: most
    volume in the complete previous session, forward only, else kept).

    Each downloaded range starts afresh, so a contract from before a download gap is never
    carried over it. A range's opening sessions have no usable previous session: they use
    their own volume, even if partial, and with none at all the range's first decided front
    (`same_session`: not causal, and marked so). Returns {trade_date: symbol} and the
    sessions whose front cannot be decided (no volume anywhere in their range). Nothing is
    written: `publish_rolls` publishes the schedule once matching rows are stored."""
    volumes, complete, _ = session_volumes(conn, product)
    previous = {s.trade_date: calendar[i - 1].trade_date for i, s in enumerate(calendar) if i}
    have = {s.trade_date for s in downloaded}
    front: dict[date, tuple[str, str]] = {}
    current, pending, unresolved = None, [], []
    for s in downloaded:
        before = previous.get(s.trade_date)
        if before not in have:  # first session of a downloaded range: choose afresh
            current = None
            unresolved += pending
            pending = []
        prev_volumes = volumes.get(before) if before and complete.get(before) else None
        found, basis = next_front(product, prev_volumes, current, s.trade_date)
        if found is None and volumes.get(s.trade_date):  # its own volume, even if partial
            found, basis = front_of(volumes[s.trade_date]), "same_session"
        if found is None:
            pending.append(s.trade_date)  # no volume yet: take the range's first front
            continue
        for day in pending:
            front[day] = (found, "same_session")
        pending = []
        current = found
        front[s.trade_date] = (current, basis)
    unresolved += pending
    return dict(sorted(front.items())), unresolved


def publish_rolls(
    conn: psycopg.Connection,
    product: Product,
    schedule: dict[date, tuple[str, str]],
    builders: dict[str, int],
    expected: dict[date, list[dict]],
) -> int:
    """Publish the front contract of each session to `market.roll`, which the continuous views
    read, only where that contract's session is current: its source record stored by the
    current source builder from the session's current files (`expected`), and every stage's
    rows by that stage's current builder, never stale rows. Until then a session keeps its
    previous entry, so planning, a failed build, or a rebuild in progress never takes a
    readable session out of the series or points it at rows that do not exist yet. Returns the
    number of sessions published."""
    published = 0
    with conn.transaction():
        for day, (symbol, basis) in schedule.items():
            cid = contract_id(conn, product, symbol, day)
            stored = conn.execute(
                """SELECT builder_id, source_files FROM market.ingest_slice
                   WHERE contract_id = %s AND trade_date = %s""",
                (cid, day),
            ).fetchone()
            if stored is None or tuple(stored) != (builders["source"], expected.get(day)):
                continue
            stages = dict(
                conn.execute(
                    """SELECT stage, builder_id FROM market.stage_slice
                       WHERE contract_id = %s AND trade_date = %s AND variant_id = 0""",
                    (cid, day),
                ).fetchall()
            )
            if any(stages.get(cls.NAME) != builders[cls.NAME] for cls in STAGES):
                continue
            conn.execute(
                """INSERT INTO market.roll (product, trade_date, contract_id, basis)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (product, trade_date)
                   DO UPDATE SET contract_id = EXCLUDED.contract_id, basis = EXCLUDED.basis""",
                (product.root, day, cid, basis),
            )
            published += 1
    return published


@dataclass
class ContractPlan:
    product: str
    contract: str
    contract_id: int
    sessions: list[str]  # trade dates of the contract's span, in order
    stored: int  # sessions stored by the current builder from the current files
    start: int  # index of the first session to build
    delete_from: str | None  # stored sessions from this trade date on are replaced, one by one
    action: str  # new, extend, add, repair, rebuild, current, stale, needs_rebuild
    reason: str = ""
    rows: int = 0  # scheduled seconds to build
    delivery: str = ""  # delivery month, YYYY-MM: one-digit-year symbols repeat each decade
    history_limited: bool = False  # the downloads start too late for the full lead

    @property
    def todo(self) -> int:
        return len(self.sessions) - self.start if self.action in RUNNABLE else 0


def spans(
    product: Product,
    period: list[Session],
    front: dict[date, str],
    volumes: dict[date, dict[str, int]],
    *,
    contract: str | None,
    start: date | None,
    end: date | None,
    lead: int,
) -> dict[tuple[str, date], list[Session]]:
    """Consecutive scheduled sessions to store per contract, keyed by raw symbol and delivery
    month: one-digit-year symbols repeat each decade (GCZ6 is December 2016 and 2026), and
    each delivery is its own contract. `period` holds every session from the first to the
    last downloaded one, so a span never skips one: sessions in a gap between downloads
    become rows without data coverage (missing), never a jump in the index counter, and are
    rebuilt when the gap is downloaded."""
    index = {s.trade_date: i for i, s in enumerate(period)}
    days: dict[tuple[str, date], list[int]] = {}
    if contract:
        for s in period:
            if volumes.get(s.trade_date, {}).get(contract):
                key = (contract, product.contract_month(contract, s.trade_date))
                days.setdefault(key, []).append(index[s.trade_date])
    else:
        for day, symbol in front.items():
            key = (symbol, product.contract_month(symbol, day))
            days.setdefault(key, []).append(index[day])
    out: dict[tuple[str, date], list[Session]] = {}
    for key, idx in days.items():
        first = min(idx) if contract else max(min(idx) - lead, 0)
        span = [
            s
            for s in period[first : max(idx) + 1]
            if (start is None or s.trade_date >= start) and (end is None or s.trade_date <= end)
        ]
        if span:
            out[key] = span
    return out


@dataclass(frozen=True)
class Stored:
    """A contract's stored sessions: the source record of each (`market.ingest_slice`: builder
    and files) and the builder of each stage's rows (`market.stage_slice`)."""

    source: dict[date, tuple[int, list[dict]]]
    stages: dict[str, dict[date, int]]

    @property
    def dates(self) -> list[date]:
        return sorted(self.source)


def session_state(
    day: date, stored: Stored, builders: dict[str, int], expected: dict[date, list[dict]]
) -> tuple[bool, list[str], bool]:
    """(current, stages to write, stale) for one session. The session is current when its
    source record and every stage were stored by the current builders from its current files.
    A changed source rewrites every stage; otherwise only stages missing or built by other code.
    Stale means something stored for it came from other code or settings."""
    names = [cls.NAME for cls in STAGES]
    src = stored.source.get(day)
    if src is None or src[1] != expected[day]:
        stale = src is not None and src[0] != builders["source"]
        return False, names, stale
    stale = src[0] != builders["source"]
    if stale:
        return False, names, True
    write = [n for n in names if stored.stages.get(n, {}).get(day) != builders[n]]
    stale = any(stored.stages.get(n, {}).get(day) not in (None, builders[n]) for n in names)
    return not write, write, stale


def diff(
    span: list[Session],
    period: list[Session],
    stored: Stored,
    builders: dict[str, int],
    expected: dict[date, list[dict]],
    rebuild: bool,
) -> tuple[list[Session], int, date | None, str, str]:
    """(span, start index, first replaced date, action, reason) for one contract. The span grows
    to cover every stored session first, so a rebuild or repair never drops stored sessions
    outside `--start` or `--end`. A session is current when its source record and all stages
    are current (`session_state`); building starts at the first one that is not, from the
    checkpoints before it, and replaces stored sessions one at a time, so an interrupted
    rebuild resumes there. A stage without stored rows (a new stage) is added from the span
    start without `--rebuild`: nothing stored is replaced."""
    dates = stored.dates
    if not dates:
        return span, 0, None, "new", ""
    lo, hi = min(dates[0], span[0].trade_date), max(dates[-1], span[-1].trade_date)
    span = [s for s in period if lo <= s.trade_date <= hi]
    states = [session_state(s.trade_date, stored, builders, expected) for s in span]
    i = 0
    while i < len(span) and states[i][0]:
        i += 1
    if i == len(span):
        return span, i, None, "current", ""
    rest = [k for k in range(i, len(span)) if span[k].trade_date in stored.source]
    if not rest:
        return span, i, None, "extend", ""
    stale = any(states[k][2] for k in rest)
    if stale:
        why = "stored by other code or settings"
        if rebuild:
            return span, i, span[i].trade_date, "rebuild", why
        return span, len(span), None, "stale", why + "; use --rebuild"

    def only_missing(k: int) -> bool:  # source current; its other stages were never stored
        day = span[k].trade_date
        source_ok = stored.source[day] == (builders["source"], expected[day])
        return source_ok and all(day not in stored.stages.get(n, {}) for n in states[k][1])

    contiguous = all(span[k].trade_date in stored.source for k in range(i, rest[-1] + 1))
    if contiguous and all(only_missing(k) for k in rest):
        missing = sorted({n for k in rest for n in states[k][1]})
        return span, i, None, "add", f"stages without stored rows: {', '.join(missing)}"
    if i == 0:
        why = "a session before the stored ones, or the first session's files changed"
        if rebuild:
            return span, i, span[i].trade_date, "rebuild", why
        return span, len(span), None, "needs_rebuild", why + "; use --rebuild"
    return span, i, span[i].trade_date, "repair", "files changed or sessions missing"


def stored_sessions(conn: psycopg.Connection, cid: int) -> Stored:
    source = {
        day: (int(b), files)
        for day, b, files in conn.execute(
            """SELECT trade_date, builder_id, source_files FROM market.ingest_slice
               WHERE contract_id = %s""",
            (cid,),
        )
    }
    stages: dict[str, dict[date, int]] = {}
    for stage, day, b in conn.execute(
        """SELECT stage, trade_date, builder_id FROM market.stage_slice
           WHERE contract_id = %s AND variant_id = 0""",
        (cid,),
    ):
        stages.setdefault(stage, {})[day] = int(b)
    return Stored(source, stages)


def session_seconds(sessions: list[Session]) -> int:
    """A typical session's scheduled-open seconds (the median), for warm-ups in sessions."""
    lengths = sorted((s.close - s.open) // NS for s in sessions)
    return int(lengths[len(lengths) // 2]) if lengths else 86_400


def plan_product(
    conn: psycopg.Connection,
    data: ProductData,
    *,
    contract: str | None = None,
    start: date | None = None,
    end: date | None = None,
    lead: int | None = None,
    rebuild: bool = False,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> dict:
    product = data.product
    if contract is not None and not product.is_outright(contract):
        raise ValueError(f"{contract!r} is not a {product.root} outright contract")
    calendar_name, calendar, downloaded = data.sessions()
    ids = identities(product, calendar_name)
    builders = {name: builder_id(conn, identity) for name, identity in ids.items()}
    source = HistoricalSource(
        product, data.files, [], downloaded, EXECUTION, None, cache or DayCache()
    )
    scan_sessions(conn, source, downloaded, log)
    schedule, unresolved = front_schedule(conn, product, calendar, downloaded)
    front = {d: symbol for d, (symbol, _) in schedule.items()}
    if unresolved:
        log(
            f"{product.root}: no front contract for {len(unresolved)} sessions without any "
            f"volume in their downloaded range, first {unresolved[0]}; they are not stored"
        )
    volumes, _, _ = session_volumes(conn, product)
    period = [
        s for s in calendar if downloaded and downloaded[0].open <= s.open <= downloaded[-1].open
    ]
    seconds = session_seconds(period)
    required, required_by = required_lead(seconds)
    if lead is None:
        lead = max(LEAD_FLOOR, required)
    elif lead < required:
        raise ValueError(
            f"lead {lead} is shorter than the {required} sessions {required_by} needs to settle"
        )
    expected = {s.trade_date: session_files(source, s) for s in period}
    index = {s.trade_date: i for i, s in enumerate(period)}
    first_front: dict[tuple[str, date], int] = {}
    for day, symbol in front.items():
        key = (symbol, product.contract_month(symbol, day))
        first_front[key] = min(first_front.get(key, index[day]), index[day])
    plans = []
    for (symbol, month), span in spans(
        product, period, front, volumes, contract=contract, start=start, end=end, lead=lead
    ).items():
        cid = contract_id_for(conn, product, symbol, month)
        stored = stored_sessions(conn, cid)
        span, i, delete_from, action, reason = diff(
            span, period, stored, builders, expected, rebuild
        )
        if action in ("needs_rebuild", "rebuild") and span[0].trade_date < min(
            stored.dates, default=span[0].trade_date
        ):
            reason += (
                f"; the lead of {lead} sessions starts before the stored sessions "
                f"(required: {required}, by {required_by})"
            )
        todo = span[i:] if action in RUNNABLE else []
        limited = contract is None and first_front.get((symbol, month), lead) < lead
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
                delivery=f"{month:%Y-%m}",
                history_limited=limited,
            )
        )
    plans.sort(key=lambda p: (p.sessions[0], p.contract))
    return {
        "product": product.root,
        "builders": builders,
        "builder": {name: identity["sha256"][:12] for name, identity in ids.items()},
        "lead_sessions": lead,
        "required_lead": {"sessions": required, "stage": required_by},
        "warm_sessions": warm_sessions(seconds),
        "downloaded_sessions": len(downloaded),
        "first_session": downloaded[0].trade_date.isoformat() if downloaded else None,
        "last_session": downloaded[-1].trade_date.isoformat() if downloaded else None,
        "front_sessions": len(front),
        "schedule": schedule,  # published by `run` (publish_rolls), never by planning
        "expected": expected,  # each session's current files, for publish_rolls
        "unresolved_sessions": [d.isoformat() for d in unresolved],
        "contracts": plans,
    }


def require_migrated(conn: psycopg.Connection) -> None:
    pending = [
        f"{r['version']:04d}_{r['name']}" for r in db.status(conn) if r["state"] != "applied"
    ]
    if pending:
        raise ValueError(f"Database migrations not applied: {pending}; run `research db migrate`")


def downstream(names: set[str]) -> set[str]:
    """The named stages and every stage that reads them, directly or through others."""
    out = set(names)
    for cls in STAGES:  # registered in dependency order
        if any(n in out for n in cls.INPUTS):
            out.add(cls.NAME)
    return out


def build_contract(
    plan: dict,
    product_plan: dict,
    run_id: int,
    url: str,
    data: ProductData,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> dict:
    """Build one contract's sessions from `plan["start"]` on, in order, resuming every stage
    from its checkpoint of the session before. Every stage is computed in memory; a stage's rows
    are written from the first session where it, or a stage it reads, is not current, because
    its state carries from there on. Each session commits on its own."""
    product, symbol, cid = data.product, plan["contract"], plan["contract_id"]
    builders, warm = product_plan["builders"], product_plan["warm_sessions"]
    dates = [date.fromisoformat(d) for d in plan["sessions"]]
    calendar, _, sessions = load_sessions(product, dates[0], dates[-1], 0)
    by_date = {s.trade_date: s for s in sessions}
    span = [by_date[d] for d in dates]
    source = HistoricalSource(product, data.files, [], span, EXECUTION, symbol, cache or DayCache())
    pipeline = Pipeline(
        calendar,
        feed_latency=EXECUTION.feed_latency,
        close_delay=EXECUTION.close_delay,
        config=FEATURES,
    )
    names = [cls.NAME for cls in STAGES]
    done, total_rows, started = 0, 0, time.time()
    tables: set[str] = set()  # stages written
    with db.connect(url) as conn:
        conn.autocommit = True  # each session's transaction commits on its own
        locked = conn.execute("SELECT pg_try_advisory_lock(%s, %s)", (LOCK_SPACE, cid)).fetchone()
        if not locked[0]:
            raise RuntimeError(f"{symbol} is being built by another ingest run")
        stored = stored_sessions(conn, cid)
        if plan["start"] > 0:
            before = dates[plan["start"] - 1]
            for name in names:
                state = conn.execute(
                    """SELECT state FROM market.stage_slice WHERE stage = %s AND variant_id = 0
                           AND contract_id = %s AND trade_date = %s AND builder_id = %s""",
                    (name, cid, before, builders[name]),
                ).fetchone()
                if state is None:
                    raise RuntimeError(f"{symbol}: no current {name} checkpoint for {before}")
                pipeline.restore(name, from_bytes(state[0]))
        dirty: set[str] = set()
        for k in range(plan["start"], len(span)):
            s = span[k]
            t0 = time.time()
            chunk, trades, unmapped, rejected = source.stored_chunk(symbol, s)
            rows = pipeline.process(chunk)
            files = session_files(source, s)
            _, write, _ = session_state(s.trade_date, stored, builders, {s.trade_date: files})
            source_current = stored.source.get(s.trade_date) == (builders["source"], files)
            dirty = set(names) if not source_current else downstream(dirty | set(write))
            base = rows.tables["bar_1s"].values
            report = {
                "aggregation": asdict(rows.report),
                "raw": raw_quality(trades),
                "rejected_trades": rejected,
                "contract_unmapped_days": [d.isoformat() for d in unmapped],
                "history_limited": bool(plan.get("history_limited")),
            }
            # the session's second ordinals; each table's own rows follow (store.row_bounds)
            lo, hi = int(base["slot_ordinal"][0]), int(base["slot_ordinal"][-1])
            with conn.transaction():  # replace this session's records and rows atomically
                if not source_current:  # a new source record; its stage records cascade
                    old = conn.execute(
                        """DELETE FROM market.ingest_slice WHERE contract_id = %s
                               AND trade_date = %s RETURNING first_ordinal, last_ordinal""",
                        (cid, s.trade_date),
                    ).fetchone()
                    if old is not None:
                        lo, hi = min(lo, int(old[0])), max(hi, int(old[1]))
                    conn.execute(
                        """INSERT INTO market.ingest_slice (contract_id, trade_date, builder_id,
                               run_id, open_ns, close_ns, first_ordinal, last_ordinal, row_count,
                               observed, missing, report, source_files, build_seconds)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            cid,
                            s.trade_date,
                            builders["source"],
                            run_id,
                            s.open,
                            s.close,
                            lo,
                            hi,
                            len(rows),
                            int((base["status"] == 2).sum()),
                            int((base["status"] == 0).sum()),
                            Jsonb(report),
                            Jsonb(files),
                            time.time() - t0,
                        ),
                    )
                written = [n for n in names if n in dirty]
                store.delete_rows(conn, cid, lo, hi, written)
                for name in written:
                    store.copy_table(conn, name, rows.tables[name], cid)
                    conn.execute(
                        """DELETE FROM market.stage_slice WHERE stage = %s AND variant_id = 0
                               AND contract_id = %s AND trade_date = %s""",
                        (name, cid, s.trade_date),
                    )
                    conn.execute(
                        """INSERT INTO market.stage_slice (stage, variant_id, contract_id,
                               trade_date, builder_id, run_id, state, warm, build_seconds)
                           VALUES (%s, 0, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            name,
                            cid,
                            s.trade_date,
                            builders[name],
                            run_id,
                            to_bytes(pipeline.export(name)),
                            k >= warm[name],
                            time.time() - t0,
                        ),
                    )
            done += 1
            total_rows += len(rows)
            tables.update(written)
            observed = (base["status"] == 2).mean()
            log(
                f"{product.root} {symbol} {s.trade_date}: {len(rows):,} rows "
                f"({', '.join(written) or 'nothing written'}), {observed:.0%} with trades, "
                f"{int((base['status'] == 0).sum()):,} missing, {time.time() - t0:.1f}s "
                f"({done}/{len(span) - plan['start']})"
            )
    return {
        "contract": symbol,
        "sessions": done,
        "rows": total_rows,
        "seconds": time.time() - started,
        "tables": sorted(tables),
    }


def _task(args: tuple) -> dict:
    plan, product_plan, run_id, url, data = args
    try:
        return build_contract(plan, product_plan, run_id, url, data)
    except Exception as error:  # report per contract; the other contracts continue
        return {"contract": plan["contract"], "error": f"{error}", "trace": traceback.format_exc()}


def plan(
    products: list[str],
    *,
    contract: str | None = None,
    start: date | None = None,
    end: date | None = None,
    lead: int | None = None,
    rebuild: bool = False,
    url: str | None = None,
    data: dict[str, ProductData] | None = None,
    cache: DayCache | None = None,
    log: Log = stderr,
) -> list[dict]:
    products = list(dict.fromkeys(products))  # `GC GC` must not plan every contract twice
    if contract is not None and len(products) != 1:
        raise ValueError("--contract needs exactly one product")
    if lead is not None and (type(lead) is not int or not 0 <= lead <= 400):
        raise ValueError("lead sessions must be an integer from 0 to 400")
    with db.connect(url) as conn:
        conn.autocommit = True  # each `transaction()` block commits on its own
        require_migrated(conn)
        store.apply_registry(conn)
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
        publish(plans, url, log)
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
    args = [
        (
            asdict(c),
            {"builders": p["builders"], "warm_sessions": p["warm_sessions"]},
            run_id,
            url,
            sources[c.product],
        )
        for p, c in tasks
    ]
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
        written = sorted({t for r in results for t in r.get("tables", [])})
        if len(failed) < len(results) and written:  # fresh planner statistics for the new rows
            tables = ", ".join(f"market.{name}" for name in written)
            with db.connect(url) as conn:
                conn.autocommit = True
                conn.execute(f"ANALYZE {tables}")
            log(f"Analyzed {tables}")
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
    publish(plans, url, log)  # rolls whose rows now exist, after a full or partial build
    return {**summary, "run_id": run_id, "status": status, "results": results}


def publish(plans: list[dict], url: str, log: Log) -> None:
    with db.connect(url) as conn:
        conn.autocommit = True
        for p in plans:
            n = publish_rolls(
                conn, PRODUCTS[p["product"]], p["schedule"], p["builders"], p["expected"]
            )
            log(
                f"{p['product']}: published the front contract of {n}/{len(p['schedule'])} sessions"
            )


def summarize(plans: list[dict]) -> dict:
    products = []
    for p in plans:
        contracts = [
            {
                "contract": c.contract,
                "delivery": c.delivery,
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
        kept = {k: v for k, v in p.items() if k not in ("contracts", "schedule", "expected")}
        products.append(kept | {"contracts": contracts})
    return {
        "products": products,
        "todo_sessions": sum(c["todo"] for p in products for c in p["contracts"]),
        "todo_rows": sum(c["rows"] for p in products for c in p["contracts"]),
    }


def stored_contract(row: tuple) -> dict:
    """One `status` entry from the per-contract aggregate of `market.ingest_slice`."""
    product, symbol, month, n, first, last, rows, observed, missing, builders, at = row
    return {
        "product": product,
        "contract": symbol,
        "delivery": f"{month:%Y-%m}",
        "sessions": int(n),
        "first": first.isoformat(),
        "last": last.isoformat(),
        "rows": int(rows),
        "with_trades": round(float(observed) / float(rows), 3) if rows else None,
        "missing_rows": int(missing),
        "builders": builders,
        "last_ingested": at.isoformat(),
    }


def status(url: str | None = None) -> dict:
    """The continuous series per product (front sessions stored, rolls), stored contracts with
    their sessions, rows, and builders, table sizes, and recent runs."""
    with db.connect(url) as conn:
        require_migrated(conn)
        stored = conn.execute(
            """SELECT c.product, c.raw_symbol, c.contract_month, count(*), min(s.trade_date),
                          max(s.trade_date), sum(s.row_count), sum(s.observed), sum(s.missing),
                          (SELECT array_agg(DISTINCT t.stage || ' ' || left(b.sha256, 12))
                           FROM market.stage_slice t JOIN market.builder b ON b.id = t.builder_id
                           WHERE t.contract_id = c.id),
                          max(s.ingested_at)
                   FROM market.ingest_slice s
                   JOIN market.contract c ON c.id = s.contract_id
                   GROUP BY c.id, 1, 2, 3 ORDER BY 1, 5"""
        ).fetchall()
        contracts = [stored_contract(row) for row in stored]
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
