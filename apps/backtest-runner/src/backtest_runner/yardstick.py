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
import subprocess
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
from strategy_core import targets, venue_clock
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
COARSE_DATES = 10  # `coarse`: a leaf holds at least this many trade dates' worth of rows
SHRINK_BLOCKS = 4  # `shrunk`: blocks of training dates forecast by the others
YARDSTICK = "trees_coarse_calibrated"  # the model the policy of Part B is replayed with
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
GROUPS = ("price", "flow", "book", "volatility", "swings", "series", "session", "clock")
# The newest inputs: the forecast is fitted with and without each set, and the difference in
# skill is reported with its interval (yardstick-spec.md#what-counts). Each set is the features
# of the stages that pass its test. Earlier sets (the swings of RSI and of CVD: runs 11 and 12)
# are no longer refitted; `added` still answers for them.
SETS = {
    "clock": lambda stage: stage.NAME == "clock_1s",
    "series": lambda stage: getattr(stage, "SOURCE", None) in ("rsi", "cvd"),
    "rsi_swings": lambda stage: getattr(stage, "SOURCE", None) == "rsi",
}
ADDED = ("clock",)
# the newest set is also judged where the first run found its only predictability
ADDED_HORIZON_S = 60


def added(names: list[str], kind: str) -> np.ndarray:
    """Which features belong to a set of `SETS`."""
    stage = StageFeatures.sources()
    return np.array([bool(SETS[kind](BY_NAME[stage[n]])) for n in names])


def group_of(name: str) -> str:
    """The kind of input a feature is, by the engine's name of it."""
    stage, base = StageFeatures.sources()[name], name.rsplit(".", 1)[-1]
    if hasattr(BY_NAME[stage], "SOURCE"):  # the swings of RSI and of CVD
        return "series"
    if stage == "clock_1s":
        return "clock"
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


def fit_trees(x: np.ndarray, y: np.ndarray, day: np.ndarray):
    return HistGradientBoostingRegressor(**TREES).fit(x, y)


def fit_coarse(x: np.ndarray, y: np.ndarray, day: np.ndarray):
    """`trees` whose leaves each hold at least as many rows as `COARSE_DATES` trade dates have
    on average, so that no leaf can belong to one session."""
    leaf = round(COARSE_DATES * len(y) / len(np.unique(day)))
    return HistGradientBoostingRegressor(**(TREES | {"min_samples_leaf": leaf})).fit(x, y)


def fit_ridge(x: np.ndarray, y: np.ndarray, day: np.ndarray):
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


class Shrunk:
    """A model whose forecast is multiplied by a slope fitted on its training rows. `slopes`
    holds the slope under each way of fitting it, for the record."""

    def __init__(self, model, slope: float, slopes: dict[str, float] | None = None):
        self.model, self.slope, self.slopes = model, slope, slopes or {}

    def raw(self, x: np.ndarray) -> np.ndarray:
        return self.model.predict(x)

    def predict(self, x: np.ndarray) -> np.ndarray:
        return self.slope * self.model.predict(x)


def blocks(
    day: np.ndarray, count: int = SHRINK_BLOCKS, forward: bool = False
) -> list[tuple[np.ndarray, np.ndarray]]:
    """The training dates cut into `count` blocks in time order: for each, the rows to fit on
    and the block's rows. A full date is always left out between the two.

    - `forward`: a block is forecast from earlier dates only, as it would have been on its own
      dates. The first block has no history and is not forecast.
    - otherwise: from every other block, earlier and later (the variant first run)."""
    dates = np.unique(day)
    out = []
    for part in np.array_split(np.arange(len(dates)), count):
        if not len(part):
            continue
        inside = np.isin(day, dates[part])
        if forward:
            train = day < dates[part[0] - 1] if part[0] >= 2 else np.zeros(len(day), bool)
        else:
            near = dates[np.clip([part[0] - 1, part[-1] + 1], 0, len(dates) - 1)]
            train = ~inside & ~np.isin(day, near)
        if train.any():
            out.append((train, inside))
    return out


def held_out(fit, x, y, day, forward: bool) -> np.ndarray:
    """A forecast for each training row from a model that was not fitted on its block (NaN for
    a block without one)."""
    outside = np.full(len(y), np.nan)
    for train, block in blocks(day, forward=forward):
        if forward:  # a full date lies between the fit and its forecast
            last, first = day[train].max(), day[block].min()
            if not ((day > last) & (day < first)).any():
                raise AssertionError("a full date must lie between the fit and its forecast")
        outside[block] = fit(x[train], y[train], day[train]).predict(x[block])
    return outside


def slope_of(outside: np.ndarray, y: np.ndarray, day: np.ndarray, by_date: bool) -> float:
    """The least-squares slope, through zero, of the target on held-out forecasts, between 0
    (the flat forecast) and 1. `by_date`: each trade date counts once, as in the score the
    slope serves (the mean excess squared error per trade date); otherwise each row does, so a
    date with twice the rows counts twice."""
    known = np.isfinite(outside)
    if not known.any():
        return 0.0
    f, t, d = outside[known], y[known], day[known]
    if by_date:
        cross, square = float(daily(f * t, d).sum()), float(daily(f * f, d).sum())
    else:
        cross, square = float((f * t).sum()), float((f * f).sum())
    return float(np.clip(cross / square, 0.0, 1.0)) if square > 0 else 0.0


CALIBRATIONS = {  # name: (forward, by date); the first is the one the yardstick uses
    "forward_by_date": (True, True),
    "forward_by_row": (True, False),
    "two_sided_by_date": (False, True),
    "two_sided_by_row": (False, False),  # the variant first run
}


def shrink(fit, calibration: str = "forward_by_date", every: bool = False):
    """`fit` with its forecast multiplied by how much of it holds on training dates it was not
    fitted on (`held_out`, `slope_of`), under the named calibration. `every`: also fit the
    slope under every other calibration, kept in `slopes` for the record."""

    def fitted(x: np.ndarray, y: np.ndarray, day: np.ndarray) -> Shrunk:
        wanted = CALIBRATIONS if every else {calibration: CALIBRATIONS[calibration]}
        outside = {
            forward: held_out(fit, x, y, day, forward)
            for forward in {f for f, _ in wanted.values()}
        }
        slopes = {
            name: slope_of(outside[forward], y, day, by_date)
            for name, (forward, by_date) in wanted.items()
        }
        return Shrunk(fit(x, y, day), slopes[calibration], slopes)

    return fitted


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
        model = fit(x[train][:, columns], y[train], day[train])
        forecast[test] = model.predict(x[test][:, columns])
        if keep:
            models[month] = {"model": model, "columns": columns}
    return forecast, models


def spread(forecast: np.ndarray) -> list[float]:
    """The forecast at its 1st, 50th, and 99th percentile: how far it ventures from zero."""
    known = forecast[np.isfinite(forecast)]
    return [round(float(v), 4) for v in np.percentile(known, [1, 50, 99])] if len(known) else []


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
    dates, corr = weighted_correlation(forecast, y, day)
    rng = np.random.default_rng(SEED)
    draws = np.array([corr(w) for w in date_weights(rng, dates)])
    return {
        "trade_dates": dates,
        "value": round(corr(np.ones(dates)), 5),
        "interval_95": [round(float(v), 5) for v in np.nanpercentile(draws, [2.5, 97.5])],
    }


def weighted_correlation(forecast: np.ndarray, y: np.ndarray, day: np.ndarray):
    """Prepare the value ordering once. Each draw ranks the rows it actually sampled,
    giving all copies of a tied value their shared midrank."""
    dates, index = np.unique(day, return_inverse=True)
    forecast_groups = np.unique(forecast, return_inverse=True)[1]
    target_groups = np.unique(y, return_inverse=True)[1]

    def centered_ranks(groups, row_weight, total):
        counts = np.bincount(groups, weights=row_weight)
        # Midrank of a tie minus the pooled mean rank (total + 1) / 2.
        return (np.cumsum(counts) - (counts + total) / 2)[groups]

    def corr(weight: np.ndarray) -> float:
        row_weight = weight[index]
        total = row_weight.sum()
        a = centered_ranks(forecast_groups, row_weight, total)
        b = centered_ranks(target_groups, row_weight, total)
        wa, wb = row_weight * a, row_weight * b
        spread = (wa * a).sum() * (wb * b).sum()
        return float((wa * b).sum() / np.sqrt(spread)) if spread > 0 else np.nan

    return len(dates), corr


def date_weights(rng: np.random.Generator, dates: int):
    """`RESAMPLES` resamples of the trade dates, each as a count per date."""
    for _ in range(RESAMPLES):
        yield np.bincount(rng.integers(0, dates, dates), minlength=dates)


def paired_difference(a: np.ndarray, b: np.ndarray, y: np.ndarray, day: np.ndarray) -> dict:
    """The pooled rank correlation of forecast `a` less that of forecast `b`, over the rows both
    scored, with a 95% interval from resampled trade dates: each resample scores both forecasts
    on the same dates, so what the dates share cancels."""
    rows = np.isfinite(a) & np.isfinite(b) & np.isfinite(y)
    a, b, y, day = a[rows], b[rows], y[rows], day[rows]
    if len(y) < MIN_ROWS or np.ptp(a) == 0 or np.ptp(b) == 0 or np.ptp(y) == 0:
        return {"trade_dates": len(np.unique(day)), "value": None, "interval_95": [None, None]}
    dates, of_a = weighted_correlation(a, y, day)
    _, of_b = weighted_correlation(b, y, day)
    rng = np.random.default_rng(SEED)
    draws = np.array([of_a(w) - of_b(w) for w in date_weights(rng, dates)])
    one = np.ones(dates)
    return {
        "trade_dates": dates,
        "value": round(of_a(one) - of_b(one), 5),
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
        known = (
            ((data["why"] == dataset.ELIGIBLE) & np.isfinite(target))
            if aim != "bracket"
            else usable
        )
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
        "coarse_leaf_trade_dates": COARSE_DATES,
        "shrink_blocks": SHRINK_BLOCKS,
        "calibration": "forward_by_date",
        "yardstick": YARDSTICK,
        "min_rows_for_a_correlation": MIN_ROWS,
        "resamples": RESAMPLES,
        "thresholds_x_cost": list(THRESHOLDS),
        "gate": list(GATE),
    }


def source_revision() -> dict:
    """The commit of the working tree and whether it has uncommitted changes (None outside a
    git checkout)."""

    def git(*args: str) -> str | None:
        try:
            done = subprocess.run(
                ["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=10
            )
        except OSError:
            return None
        return done.stdout.strip() if done.returncode == 0 else None

    status = git("status", "--porcelain", "--untracked-files=no")
    return {"commit": git("rev-parse", "HEAD"), "dirty": None if status is None else bool(status)}


def code_digest() -> str:
    digest = hashlib.sha256(venue_clock.edition_digest().encode())
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

    def report(name: str, forecast: np.ndarray) -> None:
        out["models"][name] = skill(forecast, y, day, product, products)
        out["models"][name]["forecast_percentiles_1_50_99"] = spread(forecast)
        out["models"][name]["openings"] = openings(
            forecast, y, data["cost_r"], day, product, products, long_ok, short_ok
        )

    forecast, _ = walk_forward(x, y, day, usable, fit_ridge)
    report("ridge", forecast)
    log(f"ridge: fitted, {time.time() - started:,.0f} s")
    forecast, _ = walk_forward(x, y, day, usable, fit_trees)
    report("trees", forecast)
    log(f"trees: fitted, {time.time() - started:,.0f} s")
    # the newest kind of input earns its place when the skill with it is above the skill
    # without it: the same model on the other features, and the paired difference
    kept_forecasts = {"trees": forecast}
    out["added_inputs"] = {}
    for kind in ADDED:
        new = added(names, kind)
        if not new.any() or new.all():
            continue
        without, _ = walk_forward(x[:, ~new], y, day, usable, fit_trees)
        report(f"trees_without_{kind}", without)
        kept_forecasts[f"trees_without_{kind}"] = without
        out["added_inputs"][kind] = {
            "features": int(new.sum()),
            "trees_less_trees_without": paired_difference(forecast, without, y, day),
        }
        log(f"trees without {kind}: fitted, {time.time() - started:,.0f} s")
        # the same comparison on the mid-price's move over the short horizon
        move = data["moves"][:, dataset.HORIZONS_S.index(ADDED_HORIZON_S)]
        known = (data["why"] == dataset.ELIGIBLE) & np.isfinite(move)
        both, _ = walk_forward(x, move, day, known, fit_trees)
        fewer, _ = walk_forward(x[:, ~new], move, day, known, fit_trees)
        scored = known & np.isfinite(both) & np.isfinite(fewer)  # the test months' rows
        out["added_inputs"][kind][f"at_{ADDED_HORIZON_S}s"] = {
            "trees": pooled_correlation(both[scored], move[scored], day[scored]),
            "trees_without": pooled_correlation(fewer[scored], move[scored], day[scored]),
            "trees_less_trees_without": paired_difference(both, fewer, move, day),
        }
        log(f"{kind} at {ADDED_HORIZON_S} s: fitted, {time.time() - started:,.0f} s")
    # one fit of the coarse trees serves them as they are and under every calibration: a
    # calibration only multiplies the forecast
    calibrated, fitted = walk_forward(
        x, y, day, usable, shrink(fit_coarse, "forward_by_date", every=True), keep=True
    )
    raw = np.full(len(y), np.nan)
    first_run = np.full(len(y), np.nan)
    for month, _, test in folds(day):
        test = test & usable
        if month in fitted and test.any():
            kept = fitted[month]
            raw[test] = kept["model"].raw(x[test][:, kept["columns"]])
            first_run[test] = kept["model"].slopes["two_sided_by_row"] * raw[test]
    report("trees_coarse", raw)
    report("trees_coarse_shrunk", first_run)  # as first run: two-sided blocks, each row once
    report(YARDSTICK, calibrated)
    out["models"][YARDSTICK]["slopes_by_month"] = {
        f"2026-{month:02d}": {k: round(v, 5) for k, v in kept["model"].slopes.items()}
        for month, kept in fitted.items()
    }
    log(f"trees_coarse: fitted, {time.time() - started:,.0f} s")
    folder = MODELS / f"run-{run_id}"
    folder.mkdir(parents=True, exist_ok=True)
    for month, kept in fitted.items():
        joblib.dump(
            kept
            | {
                "names": names,
                "ready": dataset.readiness(names),
                "venue_clock_revision": venue_clock.EDITION,
                "settings": settings(),
                # what reproduces it: the commit its code was (with uncommitted changes or
                # not), the hash of that code, and the dataset file its rows came from
                "source": source_revision() | {"code_sha256": code_digest()},
                "dataset": data.get("cache_key"),
            },
            folder / f"2026-{month:02d}.joblib",
        )
    out["models"][YARDSTICK]["artifacts"] = str(folder.relative_to(ROOT))
    # the forecasts of each row, so that a later run's can be paired with them row for row
    np.savez_compressed(
        folder / "forecasts.npz",
        end=data["end"], product=product, day=day, y=y, usable=usable, **kept_forecasts,
    )  # fmt: skip
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
