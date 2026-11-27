"""The first decision model, Part B: the policy in the engine (docs/project/yardstick-spec.md).

    uv run research policy RUN_ID GC SI

`ModelPolicy` is a strategy: at every second it reads the model's forecast of the move ahead
in R and decides. While flat it opens a long when the forecast is above the trade's cost and
a short when it is below the negative of it, unless a timeframe's trend is against that side.
While a position is open, its closing rule decides: `hold` never closes, `turn` closes when
the forecast no longer favours the position, `opposite` when it would open the other side.

`run` replays every policy cell of the spec on the test months, each month with the model
fitted before it (`research yardstick` keeps them), and reports results in R.
"""

import multiprocessing as mp
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field, replace
from datetime import date, timedelta

import joblib
import numpy as np
from psycopg.types.json import Jsonb
from psycopg.types.range import DateRange
from strategy_core.engine import Engine
from strategy_core.features import FeatureFrame
from strategy_core.market import PRODUCTS
from strategy_core.strategies import STRATEGIES, Bracket, Entry, trend_gate
from strategy_core.timeframes import SLOW

from . import dataset, db, service, yardstick
from .catalog import ROOT
from .periods import DEV_END, TEST_MONTHS

CLOSES = ("hold", "turn", "opposite")
FORECAST = "model.forecast"  # a forecast computed once for several policies on the same rows
BRACKET = Bracket(target_atr=dataset.R_ATR, stop_atr=dataset.R_ATR, max_hold_s=None, atr=SLOW.name)
ENTRIES = {
    "cross": Entry("market", cutoff_s=dataset.ENTRY_CUTOFF_S),
    "passive": Entry("passive", wait_s=5.0, cutoff_s=dataset.ENTRY_CUTOFF_S),
}
DAILY_LOSS_R = 4.0  # 2% of the account a day at 0.5% a trade (roadmap decision 36)
EXECUTIONS = {
    "base": {"daily_loss_r": DAILY_LOSS_R},
    "stressed": {
        "daily_loss_r": DAILY_LOSS_R,
        "order_latency_ms": 250.0,
        "adverse_ticks": 1,
        "passive_fill": "through",
    },
}
# closing rule, entry, gated: the spec's eight cells; the first is the headline
CELLS = [
    *((close, entry, True) for close in CLOSES for entry in ENTRIES),
    *(("hold", entry, False) for entry in ENTRIES),
]
MICRO_TICK_USD = {"GC": 1.0, "SI": 5.0}  # MGC and SIL: a stress, their books are not in the data
MICRO_COMMISSION = 1.25  # USD a contract a side (decision 27)
ACCOUNT_USD, RISK_PCT = 100_000.0, 0.5
BASE = date(2000, 1, 1)


@dataclass(frozen=True)
class ModelPolicy:
    """The decision rule on one fitted model (`artifact`: a file `research yardstick` wrote)."""

    artifact: str
    close: str = "hold"
    threshold: float = 1.0  # of the round trip's cost in R
    gate: tuple[str, ...] = yardstick.GATE
    spread_limit: float = dataset.SPREAD_LIMIT  # of R: a wider book is not traded
    bracket: Bracket = BRACKET
    entry: Entry = field(default_factory=lambda: ENTRIES["cross"])
    name: str = "model"
    # features that must have a value for the model to decide; None: those its artifact names
    ready: tuple[str, ...] | None = None
    loaded: dict = field(default_factory=dict, compare=False, repr=False)

    def __post_init__(self):
        if self.close not in CLOSES:
            raise ValueError(f"close must be one of {CLOSES}")
        if not 0 < self.threshold <= 100:
            raise ValueError("threshold must be in (0, 100]")

    def model(self) -> dict:
        if not self.loaded:
            self.loaded.update(joblib.load(ROOT / self.artifact))
        return self.loaded

    def required(self) -> tuple[str, ...]:
        return (*self.model()["names"], *self.gate)

    def decides(self, f, rows: int) -> np.ndarray:
        """Whether the model may decide at each row: every feature its training rows were
        required to have is there (the swing scales' confirmed high and low). On any other row
        the model was never fitted, so it opens nothing and closes nothing; the bracket and the
        forced exit still act."""
        names = self.ready
        if names is None:
            kept = self.model()
            names = kept["ready"] if "ready" in kept else dataset.readiness(kept["names"])
        out = np.ones(rows, bool)
        for name in names:
            out &= np.isfinite(f[name])
        return out

    def forecast(self, f) -> np.ndarray:
        """The model's forecast of the move ahead in R at each row."""
        if FORECAST in f:
            return f[FORECAST]
        kept = self.model()
        names = [kept["names"][i] for i in kept["columns"]]
        x = np.column_stack([f[n] for n in names]).astype(np.float32)
        return kept["model"].predict(x) if len(x) else np.zeros(0)

    def cost(self, f) -> tuple[np.ndarray, np.ndarray]:
        """The round trip's cost in R at each row, times the threshold (NaN without a usable
        book), and whether the book is narrow enough to trade."""
        cost = self.threshold * (f["exec.spread_r"] + f["exec.commission_r"])
        with np.errstate(invalid="ignore"):
            return cost, f["exec.spread_r"] <= self.spread_limit

    def signals(self, f) -> np.ndarray:
        forecast = self.forecast(f)
        cost, narrow = self.cost(f)
        long_ok, short_ok = trend_gate(f, self.gate, len(forecast))
        ready = self.decides(f, len(forecast))
        with np.errstate(invalid="ignore"):
            buy = ready & narrow & long_ok & (forecast > cost)
            sell = ready & narrow & short_ok & (forecast < -cost)
        return np.where(buy, 1, np.where(sell, -1, 0)).astype(np.int8)

    def closes(self, f) -> tuple[np.ndarray, np.ndarray]:
        forecast = self.forecast(f)
        if self.close == "hold":
            return np.zeros(len(forecast), bool), np.zeros(len(forecast), bool)
        ready = self.decides(f, len(forecast))
        with np.errstate(invalid="ignore"):
            if self.close == "turn":
                return ready & (forecast <= 0), ready & (forecast >= 0)
            cost, _ = self.cost(f)
            return ready & (forecast < -cost), ready & (forecast > cost)

    def params(self) -> dict:
        return {k: v for k, v in asdict(self).items() if k != "loaded"}


STRATEGIES["model"] = ModelPolicy


def month_dates(month: int) -> tuple[date, date]:
    first = date(2026, month, 1)
    last = date(2026 + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    return first, min(last, DEV_END)


def flagged(source, session) -> bool:
    """Whether a file of the session is not `available` (roadmap decision 23)."""
    return any(f is not None and f.condition != "available" for _, f in source.day_files(session))


def replay_month(product: str, month: int, artifact: str) -> dict:
    """Every policy cell under every execution setting on one product and test month: the
    features and the forecast are computed once, and each cell's engine decides on them."""
    start, end = month_dates(month)
    lead = service.prepare(
        service.RunSpec(
            product, start, end, strategy="model", strategy_params={"artifact": artifact}
        )
    )
    features = Engine(lead.product, lead.calendar, lead.strategy, lead.execution, lead.features)
    engines = {}
    for close, entry, gated in CELLS:
        for mode, execution in EXECUTIONS.items():
            policy = ModelPolicy(
                artifact, close, gate=yardstick.GATE if gated else (), entry=ENTRIES[entry]
            )
            config = replace(lead.execution, **execution)
            key = (close, entry, gated, mode)
            engines[key] = Engine(lead.product, lead.calendar, policy, config, lead.features)
    by_label = {f"{s.trade_date} ": s for s in lead.source.trading}
    sessions, skipped = [], []
    for chunk in lead.source.chunks():
        frame = features.process(replace(chunk, tradable=False, book=None)).frame
        if chunk.tradable:
            session = next(s for label, s in by_label.items() if chunk.session.startswith(label))
            if flagged(lead.source, session):
                skipped.append(session.trade_date.isoformat())
                chunk = replace(chunk, tradable=False)
            else:
                sessions.append(session.trade_date.isoformat())
                forecast = lead.strategy.forecast(frame.features)
                frame = FeatureFrame(
                    frame.end, frame.features | {FORECAST: forecast}, frame.context
                )
        for engine in engines.values():
            engine.process(chunk, frame)
    opens = np.array([s.open for s in lead.source.trading], np.int64)
    days = np.array([(s.trade_date - BASE).days for s in lead.source.trading], np.int64)
    tick = lead.product.tick_size / 1e9
    cells = {}
    for key, engine in engines.items():
        done = engine.finish()
        trades = done["trades"]
        at = np.searchsorted(opens, [int(t["entry_ns"]) for t in trades], side="right") - 1
        cells[key] = {
            "summary": {
                k: done["summary"][k]
                for k in (
                    "signal_rows",
                    "cancelled_orders",
                    "expired_orders",
                    "orders_with_unknown_outcome",
                    "sessions_at_daily_limit",
                    "exit_reasons",
                )
            },
            "day": days[at] if len(trades) else np.zeros(0, np.int64),
            "side": np.array([t["direction"] for t in trades], np.int8),
            "r": np.array([t["r_multiple"] for t in trades], float),
            "stop_ticks": np.array(
                [abs(t["entry_px"] - t["stop_px"]) / tick for t in trades], float
            ),
            "flagged_exit": np.array(["no_book" in t["flags"] for t in trades], bool),
        }
    return {
        "product": product,
        "month": month,
        "days": [(date.fromisoformat(d) - BASE).days for d in sessions],
        "flagged_sessions": skipped,
        "cells": cells,
    }


def _task(args: tuple) -> dict:
    return replay_month(*args)


def per_day(values: np.ndarray, day: np.ndarray, dates: np.ndarray) -> np.ndarray:
    """The sum of `values` on each of `dates` (zero on a date without a trade)."""
    out = np.zeros(len(dates))
    np.add.at(out, np.searchsorted(dates, day), values)
    return out


def describe(values: np.ndarray, day: np.ndarray, dates: np.ndarray) -> dict:
    daily = per_day(values, day, dates)
    return {
        "trades": len(values),
        "net_r": round(float(values.sum()), 3),
        "net_r_per_trade_date": {
            "mean": round(float(daily.mean()), 5) if len(dates) else None,
            "interval_95": yardstick.interval(daily, np.random.default_rng(yardstick.SEED)),
        },
    }


def cell_report(parts: list[dict], key: tuple, products: list[str]) -> dict:
    """One policy cell under one execution setting, over every product and test month."""
    names = ("day", "side", "net", "micro", "pct", "product", "flagged")
    rows: dict[str, list] = {k: [] for k in names}
    summary = {"signal_rows": 0, "cancelled_orders": 0, "expired_orders": 0,
               "orders_with_unknown_outcome": 0, "sessions_at_daily_limit": 0}  # fmt: skip
    reasons: dict[str, int] = {}
    flagged_exits = unsized = 0
    for part in parts:
        cell, product = part["cells"][key], part["product"]
        for k in summary:
            summary[k] += cell["summary"][k]
        for reason, count in cell["summary"]["exit_reasons"].items():
            reasons[reason] = reasons.get(reason, 0) + count
        full = cell["stop_ticks"] * PRODUCTS[product].tick_value
        micro = cell["stop_ticks"] * MICRO_TICK_USD[product]
        size = np.floor(ACCOUNT_USD * RISK_PCT / 100 / micro)  # whole micro contracts
        unsized += int((size == 0).sum())
        flagged_exits += int(cell["flagged_exit"].sum())
        rows["flagged"].append(cell["flagged_exit"].astype(float))
        rows["day"].append(cell["day"])
        rows["side"].append(cell["side"])
        rows["net"].append(cell["r"] - 2 * 2.5 / full)
        rows["micro"].append(cell["r"] - 2 * MICRO_COMMISSION / micro)
        rows["pct"].append(100 * size * (cell["r"] * micro - 2 * MICRO_COMMISSION) / ACCOUNT_USD)
        rows["product"].append(np.full(len(cell["day"]), products.index(product)))
    a = {k: np.concatenate(v) if v else np.zeros(0) for k, v in rows.items()}
    dates = np.unique(np.concatenate([np.asarray(p["days"], int) for p in parts]))
    out = summary | {"exit_reasons": reasons, "exits_priced_without_a_book": flagged_exits}
    out |= {"trade_dates": len(dates), "all": describe(a["net"], a["day"], dates)}
    # an exit priced without a book has an unknown result: also given with each one charged
    # one further stop distance (roadmap, how a policy is evaluated)
    charged = a["net"] - a["flagged"]
    worst = {"all": describe(charged, a["day"], dates)}
    for label, pick in (("buys", a["side"] > 0), ("sells", a["side"] < 0)):
        out[label] = describe(a["net"][pick], a["day"][pick], dates)
        worst[label] = describe(charged[pick], a["day"][pick], dates)
    for k, name in enumerate(products):
        pick = a["product"] == k
        own = np.unique(
            np.concatenate([np.asarray(p["days"], int) for p in parts if p["product"] == name])
        )
        out[name] = describe(a["net"][pick], a["day"][pick], own)
        worst[name] = describe(charged[pick], a["day"][pick], own)
    out["with_unpriced_exits_charged_1r"] = worst
    out["by_month"] = {}
    for month in TEST_MONTHS:
        lo, hi = yardstick.month_days(month)
        pick = (a["day"] >= lo) & (a["day"] < hi)
        out["by_month"][f"2026-{month:02d}"] = {
            "trades": int(pick.sum()),
            "net_r": round(float(a["net"][pick].sum()), 3),
        }
    out["micro_costs"] = describe(a["micro"], a["day"], dates)
    out["account_100k_whole_micro_contracts"] = {
        "net_pct": round(float(a["pct"].sum()), 3),
        "trades_too_large_for_the_risk": unsized,
    }
    out["daily"] = per_day(a["net"], a["day"], dates)
    return out


def settings() -> dict:
    return {
        "bracket": asdict(BRACKET),
        "entries": {k: asdict(v) for k, v in ENTRIES.items()},
        "executions": EXECUTIONS,
        "cells": [
            {"close": close, "entry": entry, "gated": gated} for close, entry, gated in CELLS
        ],
        "threshold_x_cost": 1.0,
        "spread_limit_r": dataset.SPREAD_LIMIT,
        "gate": list(yardstick.GATE),
        "micro": {"tick_usd": MICRO_TICK_USD, "commission_per_contract": MICRO_COMMISSION},
        "account_usd": ACCOUNT_USD,
        "risk_pct": RISK_PCT,
        "test_months": [f"2026-{m:02d}" for m in TEST_MONTHS],
    }


def run(
    model_run: int,
    products: list[str],
    workers: int | None = None,
    url: str | None = None,
    log=lambda line: None,
) -> dict:
    """Replay every policy cell with the models of yardstick run `model_run`."""
    products = list(dict.fromkeys(products))
    folder = yardstick.MODELS / f"run-{model_run}"
    tasks = []
    for month in TEST_MONTHS:
        artifact = folder / f"2026-{month:02d}.joblib"
        if not artifact.exists():
            raise ValueError(f"No model for 2026-{month:02d} in {folder}: run `research yardstick`")
        tasks += [(p, month, str(artifact.relative_to(ROOT))) for p in products]
    start, end = month_dates(TEST_MONTHS[0])[0], month_dates(TEST_MONTHS[-1])[1]
    with db.connect(url) as conn:  # recorded before anything is read
        run_id = conn.execute(
            """INSERT INTO research.run (kind, products, period, settings, code_sha256)
               VALUES ('yardstick-policy', %s, %s, %s, %s) RETURNING id""",
            (
                products,
                DateRange(start, end + timedelta(days=1)),
                Jsonb(settings() | {"model_run": model_run}),
                yardstick.code_digest(),
            ),
        ).fetchone()[0]
        conn.commit()
    workers = workers or max(1, min(8, (mp.cpu_count() or 2) - 2, len(tasks)))
    started, parts = time.time(), []
    log(f"Policy: {len(tasks)} product-months, {len(CELLS)} cells, {workers} workers")
    if workers == 1:
        results = map(_task, tasks)
        parts = list(results)
    else:
        with ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn")) as pool:
            for future in as_completed([pool.submit(_task, t) for t in tasks]):
                parts.append(future.result())
                log(f"  {len(parts)}/{len(tasks)} product-months, {time.time() - started:,.0f} s")
    parts.sort(key=lambda p: (products.index(p["product"]), p["month"]))
    out: dict = {
        "run_id": run_id,
        "model_run": model_run,
        "settings": settings(),
        "flagged_sessions": sorted({d for p in parts for d in p["flagged_sessions"]}),
        "cells": {},
    }
    daily = {}
    for close, entry, gated in CELLS:
        name = f"{close}/{entry}/{'gated' if gated else 'ungated'}"
        out["cells"][name] = {}
        for mode in EXECUTIONS:
            found = cell_report(parts, (close, entry, gated, mode), products)
            daily[name, mode] = found.pop("daily")
            out["cells"][name][mode] = found
    rng = np.random.default_rng(yardstick.SEED)
    out["closing_rules_against_hold"] = {}
    for close in ("turn", "opposite"):  # paired by trade date on the same entry and gate
        for entry in ENTRIES:
            for mode in EXECUTIONS:
                delta = daily[f"{close}/{entry}/gated", mode] - daily[f"hold/{entry}/gated", mode]
                out["closing_rules_against_hold"][f"{close}/{entry}/{mode}"] = {
                    "mean_net_r_per_trade_date": round(float(delta.mean()), 5),
                    "interval_95": yardstick.interval(delta, rng),
                }
    out["elapsed_s"] = round(time.time() - started, 1)
    with db.connect(url) as conn:
        conn.execute(
            "UPDATE research.run SET finished_at = now(), result = %s WHERE id = %s",
            (Jsonb(out), run_id),
        )
        conn.commit()
    return out
