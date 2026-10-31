"""Run orchestration: backtests, parity checks, paced rehearsals, and saved results."""

import hashlib
import json
import tempfile
import time
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from importlib.metadata import version
from pathlib import Path

import numpy as np
from strategy_core.bars import aggregate
from strategy_core.engine import ChunkResult, Engine, MarketChunk, split_by_second
from strategy_core.execution import ExecutionConfig, Simulator
from strategy_core.features import FeatureConfig, FeatureFrame
from strategy_core.labels import candidate_outcomes, summarize_candidates
from strategy_core.market import NS, PRODUCTS, SECOND, Product, SessionCalendar
from strategy_core.strategies import Strategy, make_strategy

from .calendars import load_sessions
from .catalog import ROOT, files_for
from .source import HistoricalSource

RUNS = ROOT / "data/runs"
SCHEMA_VERSION = 2
RUN_ID_LENGTH = 24


def code_digest() -> str:
    digest = hashlib.sha256()
    for base in (ROOT / "lib/strategy-core/src", ROOT / "apps/backtest-runner/src"):
        for path in sorted(base.rglob("*.py")):
            digest.update(str(path.relative_to(ROOT)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


LOADED_CODE_SHA256 = code_digest()


@dataclass(frozen=True)
class RunSpec:
    """A reproducible run definition. Strategy logic and metrics live in Python code; the spec
    selects data and sets parameters."""

    product: str
    start: date
    end: date
    contract: str | None = None
    warmup_sessions: int = 1
    strategy: str = "bias_pullback"
    strategy_params: dict = field(default_factory=dict)
    execution: dict = field(default_factory=dict)
    features: dict = field(default_factory=dict)

    KEYS = (
        "product",
        "start",
        "end",
        "contract",
        "warmup_sessions",
        "strategy",
        "strategy_params",
        "execution",
        "features",
    )

    @classmethod
    def parse(cls, body: dict) -> "RunSpec":
        if not isinstance(body, dict) or set(body) - set(cls.KEYS):
            raise ValueError(f"Run spec keys: {', '.join(cls.KEYS)}")
        spec = cls(
            **{
                **body,
                "start": date.fromisoformat(body["start"]),
                "end": date.fromisoformat(body["end"]),
            }
        )
        if spec.product not in PRODUCTS:
            raise ValueError(f"Unknown product {spec.product!r}; known: {sorted(PRODUCTS)}")
        if spec.contract is not None and not PRODUCTS[spec.product].is_outright(spec.contract):
            raise ValueError(f"{spec.contract!r} is not a {spec.product} outright contract")
        if type(spec.warmup_sessions) is not int or not 0 <= spec.warmup_sessions <= 10:
            raise ValueError("warmup_sessions must be an integer from 0 to 10")
        if (spec.end - spec.start).days > 400:
            raise ValueError("Run at most 400 days at a time")
        for name in ("strategy_params", "execution", "features"):
            if not isinstance(getattr(spec, name), dict):
                raise ValueError(f"{name} must be an object")
        return spec

    def to_dict(self) -> dict:
        d = {k: getattr(self, k) for k in self.KEYS}
        d["start"], d["end"] = self.start.isoformat(), self.end.isoformat()
        return d


@dataclass
class Prepared:
    spec: RunSpec
    product: Product
    calendar: SessionCalendar
    strategy: Strategy
    execution: ExecutionConfig
    features: FeatureConfig
    source: HistoricalSource

    def engine(self) -> Engine:
        return Engine(self.product, self.calendar, self.strategy, self.execution, self.features)


def prepare(spec: RunSpec) -> Prepared:
    product = PRODUCTS[spec.product]
    calendar, warmup, trading = load_sessions(product, spec.start, spec.end, spec.warmup_sessions)
    execution = ExecutionConfig(**spec.execution)
    files = files_for(product.parent_symbol, product.dataset)
    if not any(f.present for f in files.values()):
        raise ValueError(f"No {product.parent_symbol} TBBO files found under data/")
    source = HistoricalSource(product, files, warmup, trading, execution, spec.contract)
    return Prepared(
        spec,
        product,
        calendar,
        make_strategy(spec.strategy, spec.strategy_params),
        execution,
        FeatureConfig(**spec.features),
        source,
    )


def backtest(body: dict, *, save: bool = True) -> dict:
    """Run sessions as whole chunks, as fast as the data can be read."""
    if code_digest() != LOADED_CODE_SHA256:
        raise ValueError("Python source changed; restart the API before creating another run")
    spec = RunSpec.parse(body)
    p = prepare(spec)
    engine = p.engine()
    sim = Simulator(p.product, p.execution, p.strategy.bracket, p.calendar)
    candidates: list[dict] = []
    started = time.perf_counter()
    seconds = 0
    for chunk in p.source.chunks():
        result = engine.process(chunk)
        seconds += len(result.frame)
        if chunk.tradable:
            candidates += candidate_outcomes(
                sim, chunk.contract, result.frame, result.signals, result.view
            )
    out = engine.finish()
    elapsed = time.perf_counter() - started
    out["candidates"] = summarize_candidates(candidates)
    out["performance"] = {
        "seconds_processed": seconds,
        "elapsed_s": round(elapsed, 3),
        "market_seconds_per_s": round(seconds / elapsed) if elapsed else None,
    }
    for label, raw in p.source.quality.items():
        out["quality"].setdefault(label, {}).update({f"raw_{k}": v for k, v in raw.items()})
    identity = provenance(p)
    out.update(
        {
            "id": hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[
                :RUN_ID_LENGTH
            ],
            "schema_version": SCHEMA_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "spec": spec.to_dict(),
            "provenance": identity,
            "feature_specs": [
                {"name": s.name, "unit": s.unit.value, "description": s.description}
                for s in engine.pipeline.specs()
            ],
            "assumptions": assumptions(p),
        }
    )
    if save:
        write_run(out)
    return out


def provenance(p: Prepared) -> dict:
    return {
        "spec": p.spec.to_dict(),
        "strategy": {
            "name": p.strategy.name,
            "params": json.loads(json.dumps(p.strategy.params(), default=str)),
        },
        "execution": asdict(p.execution),
        "features": asdict(p.features),
        "calendar": p.calendar.name,
        "data_files": {
            name: {"sha256": f.sha256, "condition": f.condition, "job_id": f.job_id}
            for name, f in sorted(p.source.used_files.items())
        },
        "code_sha256": LOADED_CODE_SHA256,
        "packages": {
            name: version(name)
            for name in ("numpy", "numba", "databento", "pandas_market_calendars")
        },
        "schema_version": SCHEMA_VERSION,
    }


def assumptions(p: Prepared) -> list[str]:
    c = p.execution
    return [
        "Features, signals, and model inputs use only normalized units (bps, ATR multiples, "
        "ratios, RSI, elapsed time). Raw prices appear only in execution and P&L.",
        f"Each second is computed {c.close_delay_ms:g} ms after it ends; orders reach the "
        f"exchange {c.order_latency_ms:g} ms later; market data arrives {c.feed_latency_ms:g} ms "
        "after Databento receives it.",
        "Market orders fill at the first trade at or after arrival, at its pre-trade ask or bid; "
        f"size beyond the displayed size pays {c.depth_penalty_ticks} tick(s).",
        f"Targets fill only when a trade prints {'beyond' if c.limit_fill == 'through' else 'at'} "
        "the limit; stops trigger on a trade at or beyond them and fill at the next trade's book.",
        f"One position at a time, {c.contracts} contract(s), ${c.commission_per_contract:g} per "
        f"contract per side; flat {c.flat_before_close_s} s before each scheduled close.",
        "Contracts roll at a session open by previous-session volume unless a contract is set; "
        "features restart on the new contract after warmup sessions.",
        "Candidate statistics simulate every signal independently with the same rules; they are "
        "overlapping ML training rows, not a portfolio.",
        "No claim of strategy profitability follows from these runs.",
    ]


def write_run(result: dict) -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=RUNS, suffix=".tmp", delete=False) as out:
        json.dump(result, out, allow_nan=False)
        temp = Path(out.name)
    temp.replace(RUNS / f"{result['id']}.json")


def validate_run_id(run_id: str) -> str:
    if not (
        isinstance(run_id, str)
        and len(run_id) == RUN_ID_LENGTH
        and all(c in "0123456789abcdef" for c in run_id)
    ):
        raise ValueError("Invalid run id")
    return run_id


def read_run(run_id: str) -> dict:
    path = RUNS / f"{validate_run_id(run_id)}.json"
    if not path.is_file():
        raise FileNotFoundError(run_id)
    return json.loads(path.read_text())


def list_runs() -> list[dict]:
    rows = []
    for path in RUNS.glob("*.json"):
        r = json.loads(path.read_text())
        if r.get("schema_version") != SCHEMA_VERSION:
            continue
        rows.append(
            {
                "id": r["id"],
                "created_at": r["created_at"],
                "spec": r["spec"],
                "summary": r["summary"],
            }
        )
    return sorted(rows, key=lambda r: r["created_at"], reverse=True)


def session_chunks(p: Prepared, sessions: int | None) -> Iterator[MarketChunk]:
    tradable = 0
    for chunk in p.source.chunks():
        if chunk.tradable:
            if sessions is not None and tradable >= sessions:
                return
            tradable += 1
        yield chunk


def verify(body: dict, sessions: int | None = 1) -> dict:
    """Run the same sessions whole and second by second (the live path) and compare."""
    p = prepare(RunSpec.parse(body))
    chunks = list(session_chunks(p, sessions))
    whole, stepwise = p.engine(), p.engine()
    t0 = time.perf_counter()
    whole_frames = [whole.process(c).frame for c in chunks]
    t1 = time.perf_counter()
    step_frames = [
        stepwise.process(s).frame
        for c in chunks
        for s in split_by_second(c, p.calendar, p.execution)
    ]
    t2 = time.perf_counter()
    a, b = whole.finish(), stepwise.finish()
    fa, fb = FeatureFrame.concat(whole_frames), FeatureFrame.concat(step_frames)
    mismatched = [
        k for k in fa.features if not np.array_equal(fa.features[k], fb.features[k], equal_nan=True)
    ]
    return {
        "sessions": [c.session for c in chunks],
        "seconds": len(fa),
        "identical_features": not mismatched,
        "mismatched_features": mismatched,
        "identical_trades": a["trades"] == b["trades"],
        "trades": len(a["trades"]),
        "whole_session_s": round(t1 - t0, 3),
        "second_by_second_s": round(t2 - t1, 3),
    }


def rehearse(
    body: dict, speed: float, on_event: Callable[[str], None], sessions: int | None = 1
) -> dict:
    """Replay recorded sessions through the live path, one second at a time. `speed` 1 is real
    time, 60 is a minute per second, and 0 runs without waiting."""
    p = prepare(RunSpec.parse(body))
    engine = p.engine()
    wall0 = market0 = None
    seen_order = seen_position = None
    for chunk in session_chunks(p, sessions):
        for second in split_by_second(chunk, p.calendar, p.execution):
            if speed > 0:
                due = second.end + p.execution.close_delay
                wall0 = wall0 or time.monotonic()
                market0 = market0 or due
                delay = (due - market0) / NS / speed - (time.monotonic() - wall0)
                if delay > 0:
                    time.sleep(delay)
            result: ChunkResult = engine.process(second)
            order, position = engine.pending, engine.position
            if order is not None and order is not seen_order:
                seen_order = order
                on_event(
                    f"{stamp(order.decision_ns)} order "
                    f"{'BUY' if order.direction > 0 else 'SELL'} {second.contract}"
                )
            if position is not None and position is not seen_position:
                seen_position = position
                on_event(
                    f"{stamp(position.entry_ns)} filled at {position.entry_px / 1e9:g}, "
                    f"target {position.target_px / 1e9:g}, stop {position.stop_px / 1e9:g}"
                )
            for t in result.trades:
                on_event(
                    f"{stamp(int(t['exit_ns']))} exit {t['exit_reason']} "
                    f"{t['pnl_ticks']:+.1f} ticks ${t['pnl_usd']:+.2f}"
                )
    return engine.finish()["summary"]


def stamp(ns: int) -> str:
    return datetime.fromtimestamp(ns / NS, UTC).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def trade_window(run_id: str, index: int, before_s: int = 240, after_s: int = 120) -> dict:
    """One-second bars around a saved trade, rebuilt from the DBN files."""
    run = read_run(run_id)
    if not 0 <= index < len(run["trades"]):
        raise FileNotFoundError("trade")
    trade = run["trades"][index]
    spec = RunSpec.parse({**run["spec"], "contract": trade["contract"]})
    p = prepare(spec)
    signal, exit_ns = int(trade["signal_end_ns"]), int(trade["exit_ns"])
    sessions = [*p.source.warmup, *p.source.trading]
    session = next((s for s in sessions if s.open < signal <= s.close), None)
    if session is None:
        raise FileNotFoundError("session")
    trades, coverage = p.source.session_trades(trade["contract"], session)
    lo = max(session.open, (signal // NS - before_s) * NS)
    hi = min(session.close, (exit_ns // NS + after_s) * NS)
    ends = p.calendar.slot_ends(lo, hi, SECOND)
    c = p.execution
    bars = aggregate(
        trades, ends, SECOND, coverage, feed_latency=c.feed_latency, close_delay=c.close_delay
    ).bars
    observed = bars.status == 2
    return {
        "trade": trade,
        "bars": [
            {
                "time": int(e // NS) - 1,
                "open": o / 1e9,
                "high": h / 1e9,
                "low": lo_ / 1e9,
                "close": cl / 1e9,
                "volume": int(v),
            }
            if ok
            else {"time": int(e // NS) - 1}
            for e, o, h, lo_, cl, v, ok in zip(
                bars.end,
                bars.open,
                bars.high,
                bars.low,
                bars.close,
                bars.volume,
                observed,
                strict=True,
            )
        ],
    }
