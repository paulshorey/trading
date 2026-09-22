"""Pinned LEAN minute TradeBar ingestion. No rescaling, forward fill, or contract splicing."""
import csv
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.request import urlopen
from zipfile import ZipFile
from strategy_core import Bar, Instrument

ROOT = Path(__file__).resolve().parents[4]
MANIFESTS = ROOT / "data/manifests"
CACHE = ROOT / "data/lean"
ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}\Z")


def validate_id(value: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Invalid dataset or run id")
    return value


def manifest(dataset: str) -> dict:
    return json.loads((MANIFESTS / f"{validate_id(dataset)}.json").read_text())


def local_path(file: dict) -> Path:
    path = (CACHE / file["path"]).resolve()
    if not path.is_relative_to(CACHE.resolve()):
        raise ValueError("Data path escapes cache")
    return path


def verified_bytes(file: dict) -> bytes:
    path = local_path(file)
    if not path.exists():
        raise ValueError("Data is not downloaded. Run pnpm data:download first.")
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != file["sha256"]:
        raise ValueError(f"Checksum mismatch: {file['path']}")
    return body


def download(dataset: str) -> dict:
    m = manifest(dataset)
    for f in m["files"]:
        path = local_path(f)
        if path.exists():
            verified_bytes(f)
            continue
        # Only fetch this pinned public repository. Paid/vendor download is deliberately separate.
        if not f["url"].startswith("https://raw.githubusercontent.com/QuantConnect/Lean/"):
            raise ValueError("Unsupported download source; import licensed files locally")
        with urlopen(f["url"], timeout=60) as response:
            body = response.read(25_000_001)
        if len(body) > 25_000_000 or hashlib.sha256(body).hexdigest() != f["sha256"]:
            raise ValueError("Download size or checksum mismatch")
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_bytes(body)
        temp.replace(path)
    return analyze(dataset)


def parse_zip(body: bytes, day: str, symbol: str, contract: str | None) -> list[Bar]:
    midnight = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
    name = f"{day}_{symbol.lower()}_minute_trade" + (f"_{contract}" if contract else "") + ".csv"
    bars = []
    with ZipFile(io.BytesIO(body)) as archive:
        info = archive.getinfo(name)  # Explicit contract: never merge contracts in the same ZIP.
        if info.file_size > 100_000_000:
            raise ValueError("CSV exceeds the local importer size limit")
        with archive.open(name) as source:
            for index, row in enumerate(csv.reader(io.TextIOWrapper(source, encoding="utf-8-sig")), 1):
                if len(row) != 6:
                    raise ValueError(f"{name}:{index}: expected six TradeBar fields")
                try:
                    milliseconds = int(row[0])
                    if milliseconds < 0 or milliseconds >= 86400000 or milliseconds % 60000:
                        raise ValueError("Expected minute offsets within the UTC file date")
                    bar = Bar(int(midnight.timestamp()) + milliseconds // 1000, *map(float, row[1:]))
                    if bars and bar.time <= bars[-1].time:
                        raise ValueError("Duplicate or unordered source rows")
                    bars.append(bar)
                except ValueError as error:
                    raise ValueError(f"{name}:{index}: {error}") from error
    return bars


def load(dataset: str) -> tuple[dict, list[Bar]]:
    m = manifest(dataset)
    if m["resolution"] != "minute" or m["data_timezone"] != "UTC" or m["price_scale"] != 1:
        raise ValueError("Only UTC, unscaled minute crypto/futures TradeBars are supported")
    if m["asset"] == "future" and not m.get("contract"):
        raise ValueError("Futures require an explicit contract month")
    bars = []
    for file in sorted(m["files"], key=lambda f: f["date"]):
        bars.extend(parse_zip(verified_bytes(file), file["date"], m["symbol"], m.get("contract")))
    if not bars or any(b.time <= a.time for a, b in zip(bars, bars[1:])):
        raise ValueError("Empty, overlapping, duplicate, or out-of-order dataset")
    return m, bars


def quality(m: dict, bars: list[Bar]) -> dict:
    gaps = [(a, b) for a, b in zip(bars, bars[1:]) if b.time - a.time > 60]
    return {"dataset": m["id"], "bars": len(bars), "start": datetime.fromtimestamp(bars[0].time, timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(bars[-1].time + 60, timezone.utc).isoformat(), "volume": sum(b.volume for b in bars),
            "min_price": min(b.low for b in bars), "max_price": max(b.high for b in bars),
            "zero_volume_bars": sum(b.volume == 0 for b in bars), "gap_count": len(gaps),
            "unobserved_minutes": sum((b.time - a.time) // 60 - 1 for a, b in gaps),
            "largest_gap_minutes": max(((b.time - a.time) // 60 - 1 for a, b in gaps), default=0),
            "note": "Gaps may be closures or absent trades, not necessarily bad data. No bars are fabricated. No session calendar is applied."}


def analyze(dataset: str) -> dict:
    return quality(*load(dataset))


def catalog() -> list[dict]:
    result = []
    for path in sorted(MANIFESTS.glob("*.json")):
        m = json.loads(path.read_text())
        result.append({**m, "downloaded": all(local_path(f).exists() for f in m["files"])})
    return result


def instrument(m: dict) -> Instrument:
    return Instrument(m["symbol"] + ("-" + m["contract"] if m.get("contract") else ""), m["asset"], m["multiplier"], m["tick_size"])
