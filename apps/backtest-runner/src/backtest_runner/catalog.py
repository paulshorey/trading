"""Databento batch-download folders: discovery, checksums, and per-date availability.

Keep each job folder exactly as delivered (`manifest.json`, `metadata.json`,
`condition.json`, and the data files) under `data/databento/`, for example
`data/databento/tbbo/GC--2025-11--2026-10/`; jobs are found at any depth (data/README.md).
`data/sample/` holds the bundled one-day sample. DBN files are the permanent tick
archive; backtests rebuild bars from them and `research ingest` stores rows built from them.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import cache
from pathlib import Path

import databento as db

ROOT = Path(__file__).resolve().parents[4]
SEARCH = (ROOT / "data/databento", ROOT / "data/sample")
FILE_DATE = re.compile(r"(\d{8})\.([a-z0-9-]+)\.dbn(\.zst)?$")
COVERED = ("available", "degraded")
DAY_NS = 86_400 * 1_000_000_000
ISO = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?"
    r"(Z|[+-]\d{2}:?\d{2})?"
)


def to_ns(value: int | str) -> int:
    """A job's `start` or `end` in UTC nanoseconds. Downloaded `metadata.json` files hold
    integer nanoseconds; the batch API reports ISO 8601 strings such as
    `2022-06-06T12:00:00.000000000Z`. Both are accepted, at full nanosecond precision."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    text = str(value).strip()
    if text.lstrip("-").isdigit():
        return int(text)
    m = ISO.fullmatch(text)
    if not m:
        raise ValueError(f"Unrecognized job timestamp {value!r}")
    y, mo, d, h, mi, sec, frac, zone = m.groups()
    moment = datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0), int(sec or 0), tzinfo=UTC)
    if zone and zone != "Z":
        sign = 1 if zone[0] == "+" else -1
        hours, minutes = int(zone[1:3]), int(zone[-2:])
        moment -= sign * timedelta(hours=hours, minutes=minutes)
    return int(moment.timestamp()) * 1_000_000_000 + int((frac or "").ljust(9, "0") or 0)


SCHEMAS = ("tbbo", "definition")  # trades with the pre-trade book; contract metadata


@dataclass(frozen=True)
class DbnFile:
    path: Path
    date: date
    job_id: str
    dataset: str
    parents: tuple[str, ...]  # parent symbols requested, e.g. ("GC.FUT",)
    sha256: str
    size: int
    condition: str  # Databento: available, degraded, pending, or missing
    schema: str = "tbbo"
    start_ns: int | None = None  # the job's requested [start, end), UTC ns: a file covers only
    end_ns: int | None = None  # its day inside it (None: the whole day)

    @property
    def present(self) -> bool:
        return self.path.is_file()

    @property
    def covered(self) -> bool:
        return self.present and self.condition in COVERED

    @property
    def window(self) -> tuple[int, int]:
        """The `[start, end)` UTC nanoseconds this file covers: its day inside its job's
        requested range. A job that starts or ends partway through a day delivers only that
        part of it."""
        lo = int(datetime(self.date.year, self.date.month, self.date.day, tzinfo=UTC).timestamp())
        lo *= 1_000_000_000
        hi = lo + DAY_NS
        if self.start_ns is not None:
            lo = max(lo, self.start_ns)
        if self.end_ns is not None:
            hi = min(hi, self.end_ns)
        return lo, hi


def discover(roots: tuple[Path, ...] = SEARCH, schema: str | None = "tbbo") -> list[DbnFile]:
    """Files of `schema` (None for all) from every job folder under `roots`, at any depth.
    Earlier roots win when jobs repeat a date."""
    seen: dict[tuple[str, str, str, date], DbnFile] = {}
    for f in all_files(roots, schema):
        for parent in f.parents:
            seen.setdefault((f.schema, f.dataset, parent, f.date), f)
    return sorted(set(seen.values()), key=lambda f: (f.date, str(f.path)))


def all_files(roots: tuple[Path, ...] = SEARCH, schema: str | None = "tbbo") -> list[DbnFile]:
    """Every file of `schema` (None for all) in every job, earlier roots first."""
    out = []
    for root in roots:
        if not root.is_dir():
            continue
        for manifest_path in sorted(root.rglob("manifest.json")):
            out += [f for f in job_files(manifest_path.parent) if schema in (None, f.schema)]
    return out


def job_files(folder: Path) -> list[DbnFile]:
    manifest = json.loads((folder / "manifest.json").read_text())
    query = json.loads((folder / "metadata.json").read_text())["query"]
    if query.get("schema") not in SCHEMAS or query.get("stype_in") != "parent":
        return []
    condition_path = folder / "condition.json"
    conditions = {}
    if condition_path.is_file():
        conditions = {c["date"]: c["condition"] for c in json.loads(condition_path.read_text())}
    out = []
    for entry in manifest["files"]:
        match = FILE_DATE.search(entry["filename"])
        if not match:
            continue
        day = datetime.strptime(match.group(1), "%Y%m%d").date()
        out.append(
            DbnFile(
                path=folder / entry["filename"],
                date=day,
                job_id=manifest["job_id"],
                dataset=query["dataset"],
                parents=tuple(query["symbols"]),
                sha256=entry["hash"].removeprefix("sha256:"),
                size=entry["size"],
                condition=conditions.get(day.isoformat(), "missing"),
                schema=query["schema"],
                start_ns=to_ns(query["start"]) if query.get("start") is not None else None,
                end_ns=to_ns(query["end"]) if query.get("end") is not None else None,
            )
        )
    return out


def job_ranges(
    parent: str, dataset: str, schema: str = "tbbo", roots: tuple[Path, ...] = SEARCH
) -> list[tuple[int, int]]:
    """Requested `[start, end)` UTC nanoseconds of every downloaded job for a parent symbol.
    Data inside a range without a file (a weekend) has no trades; outside, it is unknown."""
    out = []
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("metadata.json")):
            query = json.loads(path.read_text())["query"]
            if (
                query.get("schema") == schema
                and query.get("dataset") == dataset
                and parent in query.get("symbols", [])
                and (path.parent / "manifest.json").is_file()
            ):
                out.append((to_ns(query["start"]), to_ns(query["end"])))
    return sorted(out)


def files_for(
    parent: str, dataset: str, schema: str = "tbbo", roots: tuple[Path, ...] = SEARCH
) -> dict[date, DbnFile]:
    """One file per UTC day for a parent symbol. Jobs that repeat a day must cover the same
    part of it (the first root's file is used); backtests and ingestion read one file per day,
    so jobs covering different parts of a day are refused rather than half read."""
    out: dict[date, DbnFile] = {}
    for f in all_files(roots, schema):
        if parent not in f.parents or f.dataset != dataset:
            continue
        kept = out.setdefault(f.date, f)
        if kept.window != f.window:
            raise ValueError(
                f"{parent} {f.date}: jobs {kept.job_id} and {f.job_id} cover different parts of "
                "this day, but one file is read per day; download the day in a single job"
            )
    return out


@cache
def _digest(path: Path, size: int, mtime_ns: int) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def verify(file: DbnFile) -> None:
    stat = file.path.stat()
    if stat.st_size != file.size:
        raise ValueError(f"Size mismatch for {file.path.name}: {stat.st_size} != {file.size}")
    if _digest(file.path, stat.st_size, stat.st_mtime_ns) != file.sha256:
        raise ValueError(f"Checksum mismatch for {file.path.name}")


@cache
def outrights(path: Path, mtime_ns: int, root: str) -> tuple[str, ...]:
    from strategy_core.market import PRODUCTS

    product = PRODUCTS[root]
    store = db.DBNStore.from_file(path)
    return tuple(sorted(s for s in store.mappings if product.is_outright(s)))


def describe() -> list[dict]:
    """Products with data on disk, for the API catalog."""
    from strategy_core.market import PRODUCTS

    out = []
    files = discover()
    for root, product in PRODUCTS.items():
        days = [f for f in files if product.parent_symbol in f.parents]
        if not days and root == "MGC":
            continue
        out.append(
            {
                "root": root,
                "name": product.name,
                "tick_size": product.tick_size / 1e9,
                "tick_value": product.tick_value,
                "calendar": product.calendar,
                "dates": [
                    {
                        "date": f.date.isoformat(),
                        "condition": f.condition,
                        "present": f.present,
                        "contracts": list(outrights(f.path, f.path.stat().st_mtime_ns, root))
                        if f.present
                        else [],
                    }
                    for f in days
                ],
            }
        )
    return out


def unconfigured_parents() -> list[str]:
    """Parent symbols on disk without a `strategy_core.market.PRODUCTS` entry. Add a Product
    (tick size, tick value, exchange calendar) before using them."""
    from strategy_core.market import PRODUCTS

    known = {p.parent_symbol for p in PRODUCTS.values()}
    return sorted({parent for f in discover() for parent in f.parents} - known)


def verify_all() -> dict:
    """Check the size and SHA-256 of every present file against its job manifest."""
    from concurrent.futures import ThreadPoolExecutor

    files = [f for f in discover(schema=None) if f.present]

    def check(f: DbnFile) -> str | None:
        try:
            verify(f)
        except ValueError as error:
            return str(error)
        return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        failures = [e for e in pool.map(check, files) if e]
    conditions: dict[str, int] = {}
    for f in files:
        conditions[f.condition] = conditions.get(f.condition, 0) + 1
    return {
        "files": len(files),
        "gigabytes": round(sum(f.size for f in files) / 1e9, 2),
        "failures": failures,
        "conditions": conditions,
        "missing_from_disk": len([f for f in discover(schema=None) if not f.present]),
        "schemas": sorted({f.schema for f in files}),
    }
