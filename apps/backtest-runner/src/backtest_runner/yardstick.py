"""The first decision model, Part A: the forecast and the horizon map
(docs/project/yardstick-spec.md).

    uv run research yardstick GC SI

A walk-forward forecast of the move ahead in R (`strategy_core.targets`) from the features the
engine holds, judged by its rank correlation with what happened over all test rows, with an
interval from resampled trade dates. The horizon
map fits the same model to the mid-price's move over fixed horizons, on all features and on
each kind of input alone, to show what is predictable, where, and from what. Every setting
below was frozen in the spec before any outcome was read; nothing is tuned.

The run is recorded in `research.run` before it starts. The fitted models are kept in
`data/models/` (derived, not in git) for the policy of Part B.
"""

import hashlib
import time
import warnings
from datetime import date, timedelta

import joblib
import numpy as np
from psycopg.types.json import Jsonb
from psycopg.types.range import DateRange
from scipy.stats import rankdata
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import QuantileTransformer
from strategy_core import targets
from strategy_core.pipeline import BY_NAME, StageFeatures

from . import dataset, db
from .catalog import ROOT
from .periods import DEV_END, DEV_START, TEST_MONTHS, check_period

SEED, RESAMPLES = 0, 1000
TREES = {
    "max_iter": 300,
    "learning_rate": 0.05,
    "max_leaf_nodes": 15,
    "min_samples_leaf": 500,
    "early_stopping": False,
    "random_state": SEED,
}
RIDGE_ALPHA = 100.0
MIN_ROWS = 30  # rows a trade date and product need for a rank correlation
THRESHOLDS = (0.5, 1.0, 2.0, 4.0)  # of the round trip's cost: 1 is the rule, the rest sensitivity
GATE = ("1m@1s.fast_atr_3.trend", "10m@10s.mid_atr_3.trend", "1h@1m.slow_atr_3.trend")
MODELS = ROOT / "data/models/yardstick"
BASE = date(2000, 1, 1)

# The kinds of input the horizon map fits alone. A feature belongs to the first that claims it.
BOOK = frozenset(
    [
        "spread_bps",
        "spread_max_bps",
        "eff_spread_bps",
        "imbalance_mean",
        "imbalance_vw",
        "depth_imbalance",
        "tilt_bps",
        "alignment",
        "take_ratio",
        "order_imbalance",
        "order_size_log_ratio",
        "quote_ratio",
        "bad_book_ratio",
        "trade_age_s",
        "book_age_s",
        "depth_age_s",
        "book_spread_bps",
        "book_imbalance",
        "rel_depth",
        "rel_spread",
        "spread_atr",
    ]
)
FLOW = frozenset(
    [
        "delta_ratio",
        "rel_volume",
        "active_ratio",
        "uptick_ratio",
        "known_ratio",
        "count_delta_ratio",
        "cvd_high_ratio",
        "cvd_low_ratio",
        "size_hhi",
        "max_size_ratio",
        "side_switch_ratio",
        "size_side_ratio",
        "sweep_ratio",
        "sweep_delta_ratio",
        "rel_trades",
        "cmf",
        "mfi",
        "delta_ratio_5",
        "delta_ratio_15",
        "flow_price_corr",
        "cvd_close_corr",
        "session_delta_ratio",
    ]
)
SESSION = frozenset(
    [
        "session_elapsed_s",
        "session_ret_bps",
        "session_high_bps",
        "session_low_bps",
        "session_vwap_atr",
        "prior_high_atr",
        "prior_low_atr",
        "prior_close_atr",
        "atr_tod_log",
        "day_atr_bps",
        "day_range_ratio",
        "day_high_dist",
        "day_low_dist",
        "day_atr_pct",
        "complete",
        "age_s",
    ]
)
VOLATILITY = frozenset(
    ["atr_bps", "range_bps", "rv_bps", "rv_atr", "ret_std_bps", "bb_width_bps", "vol_bps", "chop"]
)
GROUPS = ("price", "flow", "book", "volatility", "swings", "session")


def group_of(name: str) -> str:
    """The kind of input a feature is, by the engine's name of it."""
    stage, base = StageFeatures.sources()[name], name.rsplit(".", 1)[-1]
    if hasattr(BY_NAME[stage], "VARIANT"):
        return "swings"
    if base in SESSION:
        return "session"
    if base in BOOK:
        return "book"
    if base in FLOW:
        return "flow"
    if stage.startswith("vol_") or base in VOLATILITY:
        return "volatility"
    return "price"


def month_days(month: int) -> tuple[int, int]:
    """Days since 2000-01-01 of the first day of a 2026 month and of the next one."""
    first = date(2026, month, 1)
    after = date(2026 + month // 12, month % 12 + 1, 1)
    return (first - BASE).days, (after - BASE).days


def folds(day: np.ndarray) -> list[tuple[int, np.ndarray, np.ndarray]]:
    """One walk-forward fold per test month: the month, its training rows, and its test rows.
    A month is scored by a model fitted on every earlier session except the last one before it
    (the purge: a target is settled inside its own session)."""
    out = []
    for month in TEST_MONTHS:
        lo, hi = month_days(month)
        before = np.unique(day[day < lo])
        test = (day >= lo) & (day < hi)
        if len(before) < 2 or not test.any():
            continue
        out.append((month, day < before[-1], test))
    return out


def fit_trees(x: np.ndarray, y: np.ndarray):
    return HistGradientBoostingRegressor(**TREES).fit(x, y)


def fit_ridge(x: np.ndarray, y: np.ndarray):
    """Linear, on features ranked to a normal shape and scaled on the training rows; a missing
    value sits at the middle."""
    model = make_pipeline(
        QuantileTransformer(
            n_quantiles=256, output_distribution="normal", subsample=100_000, random_state=SEED
        ),
        SimpleImputer(strategy="constant", fill_value=0.0),
        Ridge(alpha=RIDGE_ALPHA),
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return model.fit(x, y)


def walk_forward(x, y, day, usable, fit, keep: bool = False) -> tuple[np.ndarray, dict]:
    """Out-of-sample forecasts for the usable rows of every test month (NaN elsewhere), and the
    fitted model of each month. A feature with no value in a month's training rows is left out
    of that month's model."""
    forecast = np.full(len(y), np.nan)
    models = {}
    for month, train, test in folds(day):
        train, test = train & usable, test & usable
        if not train.any() or not test.any():
            continue
        columns = np.flatnonzero(np.isfinite(x[train]).any(axis=0))
        model = fit(x[train][:, columns], y[train])
        forecast[test] = model.predict(x[test][:, columns])
        if keep:
            models[month] = {"model": model, "columns": columns}
    return forecast, models


def interval(values: np.ndarray, rng) -> list[float | None]:
    """95% interval of the mean of per-trade-date values, resampling whole trade dates."""
    if not len(values):
        return [None, None]
    draw = rng.integers(0, len(values), (RESAMPLES, len(values)))
    return [round(float(v), 5) for v in np.percentile(values[draw].mean(axis=1), [2.5, 97.5])]


def daily(values: np.ndarray, day: np.ndarray) -> np.ndarray:
    """The mean of `values` on each trade date, dates in order."""
    _, index = np.unique(day, return_inverse=True)
    return np.bincount(index, weights=values) / np.bincount(index)


def rank_correlation(forecast, y, day, product) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For each trade date and product with enough rows: the rank correlation between forecast
    and target over that date's rows. Returns the correlations with their dates and products."""
    out, days, products = [], [], []
    for d in np.unique(day):
        for p in np.unique(product[day == d]):
            rows = (day == d) & (product == p)
            f, t = forecast[rows], y[rows]
            if len(f) < MIN_ROWS or np.ptp(f) == 0 or np.ptp(t) == 0:
                continue
            out.append(float(np.corrcoef(rankdata(f), rankdata(t))[0, 1]))
            days.append(int(d))
            products.append(int(p))
    return np.array(out), np.array(days, int), np.array(products, int)


def pooled_correlation(forecast: np.ndarray, y: np.ndarray, day: np.ndarray) -> dict:
    """The rank correlation between forecast and target over all the rows together, with a
    95% interval from resampled trade dates. Ranks are taken over every row at once, never
    within a date: a target is the move from a row to a later point of the same session, so
    within one session it falls as the current price rises whatever the forecast knows, and a
    correlation taken date by date rewards any forecast that fades the session's move."""
    if len(y) < MIN_ROWS or np.ptp(forecast) == 0 or np.ptp(y) == 0:
        return {"trade_dates": len(np.unique(day)), "value": None, "interval_95": [None, None]}
    rf, ry = rankdata(forecast), rankdata(y)
    dates, index = np.unique(day, return_inverse=True)
    n = np.bincount(index).astype(float)
    sums = [np.bincount(index, weights=v) for v in (rf, ry, rf * rf, ry * ry, rf * ry)]

    def corr(weight: np.ndarray) -> float:
        count = (n * weight).sum()
        a, b, aa, bb, ab = ((v * weight).sum() for v in sums)
        spread = (aa - a * a / count) * (bb - b * b / count)
        return float((ab - a * b / count) / np.sqrt(spread)) if spread > 0 else np.nan

    rng = np.random.default_rng(SEED)
    draws = np.array(
        [
            corr(np.bincount(rng.integers(0, len(dates), len(dates)), minlength=len(dates)))
            for _ in range(RESAMPLES)
        ]
    )
    return {
        "trade_dates": len(dates),
        "value": round(corr(np.ones(len(dates))), 5),
        "interval_95": [round(float(v), 5) for v in np.nanpercentile(draws, [2.5, 97.5])],
    }


def summary(values: np.ndarray, day: np.ndarray) -> dict:
    """Mean of per-date values with its interval, dates weighted equally."""
    if not len(values):
        return {"trade_dates": 0, "mean": None, "interval_95": [None, None]}
    per_day = daily(values, day)
    return {
        "trade_dates": len(per_day),
        "mean": round(float(per_day.mean()), 5),
        "interval_95": interval(per_day, np.random.default_rng(SEED)),
    }


def skill(forecast, y, day, product, names: list[str]) -> dict:
    """The forecast's skill on the rows it scored: its rank correlation with the target over
    all rows, pooled, by product, and by month; and its squared error against a forecast of
    zero. The correlation taken within each trade date is kept beside them for the record; it
    is biased upward (`pooled_correlation`) and decides nothing."""
    rows = np.isfinite(forecast) & np.isfinite(y)
    f, t, d, p = forecast[rows], y[rows], day[rows], product[rows]
    out = {"rows": int(rows.sum()), "rank_correlation": pooled_correlation(f, t, d)}
    out["by_product"] = {
        name: pooled_correlation(f[p == k], t[p == k], d[p == k])
        for k, name in enumerate(names)
        if (p == k).any()
    }
    out["by_month"] = {}
    for month in TEST_MONTHS:
        lo, hi = month_days(month)
        pick = (d >= lo) & (d < hi)
        if pick.any():
            out["by_month"][f"2026-{month:02d}"] = pooled_correlation(f[pick], t[pick], d[pick])
    corr, cd, _ = rank_correlation(f, t, d, p)
    out["within_date_rank_correlation_biased"] = summary(corr, cd)
    if len(t):
        excess = (f - t) ** 2 - t**2  # against the flat forecast, per row
        out["squared_error_minus_flat"] = summary(excess, d)
        out["squared_error_ratio_to_flat"] = round(float(((f - t) ** 2).sum() / (t**2).sum()), 5)
    return out


def openings(forecast, y, cost, day, product, names, long_ok, short_ok) -> dict:
    """What the opening rule would have decided at the scored rows, row by row: at each
    threshold (a multiple of the round trip's cost in R), the rows where the forecast is beyond
    it, and the target less the cost on the side taken. Rows overlap and no position blocks
    another, so this is not a portfolio result: Part B gives that."""
    rows = np.isfinite(forecast) & np.isfinite(y) & np.isfinite(cost)
    out: dict = {"rows": int(rows.sum())}
    for gate in ("gated", "ungated"):
        allow_long = long_ok if gate == "gated" else np.ones(len(y), bool)
        allow_short = short_ok if gate == "gated" else np.ones(len(y), bool)
        out[gate] = {"rows_long_allowed": int((rows & allow_long).sum())}
        out[gate]["rows_short_allowed"] = int((rows & allow_short).sum())
        for k in THRESHOLDS:
            side = np.where(
                rows & allow_long & (forecast > k * cost),
                1,
                np.where(rows & allow_short & (forecast < -k * cost), -1, 0),
            )
            entry: dict = {}
            groups = {"all": side != 0, "buys": side > 0, "sells": side < 0}
            groups |= {name: (side != 0) & (product == i) for i, name in enumerate(names)}
            for label, pick in groups.items():
                value = side[pick] * y[pick] - cost[pick]
                entry[label] = {"rows": int(pick.sum())} | (
                    {"net_r_per_row": summary(value, day[pick])} if pick.any() else {}
                )
            out[gate][f"{k:g}x_cost"] = entry
    return out


def horizon_map(data: dict, usable: np.ndarray, log) -> dict:
    """Skill of the same trees model on each diagnostic target (the mid-price's move over each
    horizon, and the move ahead in R), fitted on all features and on each kind alone."""
    names, x, day, product = data["names"], data["x"], data["day"], data["product"]
    kinds = np.array([group_of(n) for n in names])
    columns = {"all": np.arange(len(names))} | {g: np.flatnonzero(kinds == g) for g in GROUPS}
    aims = {f"{h}s": data["moves"][:, j] for j, h in enumerate(dataset.HORIZONS_S)}
    aims["bracket"] = data["y"]
    out: dict = {"features": {g: len(c) for g, c in columns.items()}, "skill": {}}
    for aim, target in aims.items():
        known = usable & np.isfinite(target) if aim != "bracket" else usable
        out["skill"][aim] = {}
        for group, cols in columns.items():
            forecast, _ = walk_forward(x[:, cols], target, day, known, fit_trees)
            found = skill(forecast, target, day, product, data["products"])
            out["skill"][aim][group] = found["rank_correlation"]
        log(f"horizon map: {aim} done")
    return out


def counts(data: dict) -> dict:
    """What was left out, and why."""
    why, state = data["why"], data["state"]
    out = {"rows": len(why), "eligible": int((why == dataset.ELIGIBLE).sum())}
    out["ineligible"] = {
        name: int((why == code).sum()) for code, name in dataset.INELIGIBLE.items()
    }
    out["unknown_target"] = {
        name: int((state == code).sum()) for code, name in targets.REASONS.items()
    }
    known = (why == dataset.ELIGIBLE) & (state == targets.KNOWN)
    y = data["y"][known]
    out["known_target"] = {
        "rows": int(known.sum()),
        "upper_barrier": int((y == 1).sum()),
        "lower_barrier": int((y == -1).sum()),
        "neither_by_the_close": int((np.abs(y) < 1).sum()),
        "mean": round(float(y.mean()), 5) if len(y) else None,
    }
    return out


def settings() -> dict:
    return {
        "dataset": dataset.settings(),
        "test_months": [f"2026-{m:02d}" for m in TEST_MONTHS],
        "trees": TREES,
        "ridge_alpha": RIDGE_ALPHA,
        "min_rows_for_a_correlation": MIN_ROWS,
        "resamples": RESAMPLES,
        "thresholds_x_cost": list(THRESHOLDS),
        "gate": list(GATE),
    }


def code_digest() -> str:
    digest = hashlib.sha256()
    for base in (ROOT / "lib/strategy-core/src", ROOT / "apps/backtest-runner/src"):
        for path in sorted(base.rglob("*.py")):
            digest.update(str(path.relative_to(ROOT)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def run(
    products: list[str],
    start: date = DEV_START,
    end: date = DEV_END,
    workers: int | None = None,
    url: str | None = None,
    log=lambda line: None,
    rebuild: bool = False,
    horizons: bool = True,
) -> dict:
    check_period(start, end)
    products = list(dict.fromkeys(products))
    with db.connect(url) as conn:  # recorded before anything is read
        run_id = conn.execute(
            """INSERT INTO research.run (kind, products, period, settings, code_sha256)
               VALUES ('yardstick', %s, %s, %s, %s) RETURNING id""",
            (products, DateRange(start, end + timedelta(days=1)), Jsonb(settings()), code_digest()),
        ).fetchone()[0]
        conn.commit()
    started = time.time()
    data = dataset.cached(products, start, end, workers, url, log, rebuild)
    names, x, y, day, product = data["names"], data["x"], data["y"], data["day"], data["product"]
    usable = (data["why"] == dataset.ELIGIBLE) & (data["state"] == targets.KNOWN)
    out: dict = {
        "run_id": run_id,
        "period": data["period"],
        "settings": settings(),
        "sessions": data["sessions"],
        "features": len(names),
        "rows": counts(data),
        "models": {},
    }
    column = {n: i for i, n in enumerate(names)}
    with np.errstate(invalid="ignore"):  # an unknown trend forbids nothing
        long_ok = ~np.any([x[:, column[g]] < 0 for g in GATE], axis=0)
        short_ok = ~np.any([x[:, column[g]] > 0 for g in GATE], axis=0)
    flat = np.where(np.any([t for _, _, t in folds(day)], axis=0) & usable, 0.0, np.nan)
    out["models"]["flat"] = {"rows": int(np.isfinite(flat).sum())}
    for name, fit in (("ridge", fit_ridge), ("trees", fit_trees)):
        forecast, fitted = walk_forward(x, y, day, usable, fit, keep=name == "trees")
        log(f"{name}: fitted, {time.time() - started:,.0f} s")
        out["models"][name] = skill(forecast, y, day, product, products)
        out["models"][name]["openings"] = openings(
            forecast, y, data["cost_r"], day, product, products, long_ok, short_ok
        )
        if fitted:
            folder = MODELS / f"run-{run_id}"
            folder.mkdir(parents=True, exist_ok=True)
            for month, kept in fitted.items():
                joblib.dump(
                    kept | {"names": names, "settings": settings()},
                    folder / f"2026-{month:02d}.joblib",
                )
            out["models"][name]["artifacts"] = str(folder.relative_to(ROOT))
    if horizons:
        out["horizon_map"] = horizon_map(data, usable, log)
    out["elapsed_s"] = round(time.time() - started, 1)
    with db.connect(url) as conn:
        conn.execute(
            "UPDATE research.run SET finished_at = now(), result = %s WHERE id = %s",
            (Jsonb(out), run_id),
        )
        conn.commit()
    return out
