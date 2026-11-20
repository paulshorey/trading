"""After-cost replay of the stored fast candidates, under the rules frozen in
docs/project/roadmap.md#after-cost-replay and docs/project/replay.md.

    uv run research replay GC SI

Every candidate of a fast label variant on a warm front session of the development period is
sent as a would-be market entry at its decision row, on its own side (sell at a candidate high,
buy at a candidate low), through the engine's simulator: the book the order meets when it
arrives, and a bracket fixed at the fill. Each is simulated under every bracket and execution
setting below, independently of any portfolio. Policies are then compared on the candidates of
the walk-forward test months: per candidate, and as one portfolio that holds one position at a
time. On the slow bracket the candidates are also split by whether the slower timeframe's swing
state, at the latest completed minute, points the same way as the entry (`agreement`). The
command reads stored rows and the DBN files and stores nothing.
"""

import multiprocessing as mp
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict
from datetime import date, timedelta

import numpy as np
from strategy_core import labels, swings
from strategy_core.engine import session_view
from strategy_core.execution import ExecutionConfig, Simulator, merged
from strategy_core.market import NS, PRODUCTS
from strategy_core.stage_pivot_1m import SCALES as SLOW_STAGES
from strategy_core.stage_pivot_label import FAST_LABELS
from strategy_core.strategies import Bracket

from . import benchmark, db, store
from .benchmark import DEV_END, DEV_START, HIGH, MINUTE_REACH_NS, SEED, TEST_MONTHS
from .calendars import load_sessions
from .ingest import ProductData
from .source import DayCache, HistoricalSource

# Frozen before any outcome was read (replay.md). A bracket is sized by the ATR of one stored
# row of the candidate's decision second: its own 1m@1s row (the engine's default bracket, kept
# as the control) or the latest completed 1h@1m row.
BRACKETS = {
    "fast": ("candle_1m_1s", Bracket(target_atr=1.5, stop_atr=1.0, max_hold_s=180)),
    "slow": ("candle_1h_1m", Bracket(target_atr=1.5, stop_atr=1.0, max_hold_s=10_800)),
}
EXECUTIONS = {
    "base": ExecutionConfig(),
    "stressed": ExecutionConfig(order_latency_ms=250.0, adverse_ticks=1),
}
MARGIN_S = 60  # between the end of the longest hold and the forced exit before the close
HOLD_S = max(b.max_hold_s for _, b in BRACKETS.values()) + MARGIN_S
ELIGIBLE, NO_ATR, NO_ROOM = 0, 1, 2  # why a candidate is or is not replayed
INELIGIBLE = {NO_ATR: "no_atr", NO_ROOM: "hold_does_not_fit_the_session"}
UNCOVERED = "uncovered"  # data coverage ends between the entry and the exit: unknown
STATES = (*labels.STATES, UNCOVERED)
CLOSED, LATE = STATES.index(labels.CLOSED), STATES.index(labels.LATE)
TRADES = tuple(STATES.index(s) for s in (labels.CLOSED, labels.EXIT_NO_BOOK, UNCOVERED))
REASONS = ("", "target", "stop", "time", "session_close")
MIN_TRAIN = 500  # known values a product needs before a block to fit the displacement rule
SESSIONS_PER_TASK = 4
# Agreement with the slower timeframe, frozen before any outcome was read (replay.md). Each
# rule reads one slow swing scale's row of the latest completed minute and gives a direction:
# 1 up, -1 down, 0 none. A candidate is `with` the rule when that direction is its entry's side
# and `against` it when it is the opposite side.
SLOW_SCALES = tuple(s.VARIANT for s in SLOW_STAGES)
RULES = ("leg", "trend", "fresh")
FRESH_S = 3_600  # `fresh`: the open leg's starting pivot was confirmed within one 1h window
AGREEMENT_BRACKET = "slow"  # the fast bracket cannot pay (replay.md), so it is not split
QUERY = """
    SELECT l.variant_id, l.end_ns, l.kind, coalesce(l.prov, 0), l.displacement,
           c.atr_bps, c.close, h.atr_bps, h.close, l.slot_ordinal
    FROM market.pivot_label_1s l
    JOIN market.candle_1m_1s c ON c.contract_id = l.contract_id
     AND c.slot_ordinal = l.slot_ordinal AND c.end_ns = l.end_ns
    LEFT JOIN market.candle_1h_1m h ON h.contract_id = l.contract_id
     AND h.slot_ordinal = l.slot_ordinal / 60 AND h.end_ns <= l.end_ns AND h.end_ns > l.end_ns - %s
    WHERE l.contract_id = %s AND l.slot_ordinal BETWEEN %s AND %s AND l.end_ns > %s
      AND l.end_ns <= %s AND l.variant_id = ANY(%s) AND l.outcome <> 0
    ORDER BY l.end_ns, l.variant_id, l.seq"""
SLOW_QUERY = """
    SELECT variant_id, slot_ordinal, end_ns, state, dir, trend, high_conf_age_s, low_conf_age_s
    FROM market.pivot_1m
    WHERE contract_id = %s AND variant_id = ANY(%s) AND slot_ordinal BETWEEN %s AND %s
      AND end_ns > %s AND end_ns <= %s
    ORDER BY variant_id, slot_ordinal"""


def stop_ticks(bracket: Bracket, atr: np.ndarray, tick: int) -> np.ndarray:
    """The entry-to-stop distance `Simulator.fill` gives an order with this ATR, in ticks."""
    return np.maximum(np.round(bracket.stop_atr * atr * 1e9 / tick), 1.0)


def simulate(
    product, calendar, symbol: str, chunk, view, end: np.ndarray, rows: np.ndarray
) -> dict:
    """Every candidate of one session under every bracket and execution setting. `rows` are
    the columns of `QUERY` (NaN for NULL); `end` is their decision row's end, exact."""
    base = EXECUTIONS["base"]
    direction = np.where(rows[:, 2].astype(int) == HIGH, -1, 1)
    with np.errstate(invalid="ignore"):
        atr = {
            "fast": rows[:, 5] / 1e4 * rows[:, 6] / 1e9,
            "slow": rows[:, 7] / 1e4 * rows[:, 8] / 1e9,
        }
        defined = np.all([np.isfinite(a) & (a > 0) for a in atr.values()], axis=0)
    room = end + HOLD_S * NS <= calendar.close_after(end) - base.flat_before_close
    why = np.where(~defined, NO_ATR, np.where(room, ELIGIBLE, NO_ROOM)).astype(np.int8)
    n, cover = len(rows), merged(chunk.coverage)
    out = {
        "variant": rows[:, 0].astype(np.int16),
        "end": end,
        "kind": rows[:, 2].astype(np.int8),
        "prov": rows[:, 3].astype(np.int8),
        "disp": rows[:, 4].astype(np.float64),
        "why": why,
    }
    for name, (_, bracket) in BRACKETS.items():
        out[f"stop:{name}"] = stop_ticks(
            bracket, np.where(defined, atr[name], np.nan), product.tick_size
        )
        for mode, config in EXECUTIONS.items():
            sim = Simulator(product, config, bracket, calendar)
            state = np.full(n, -1, np.int8)
            ticks, known = np.full(n, np.nan), np.zeros(n, np.int64)
            reason = np.zeros(n, np.int8)
            spread, slip = np.full(n, np.nan), np.full(n, np.nan)
            for i in np.flatnonzero(why == ELIGIBLE):
                pos = sim.order(
                    int(direction[i]), symbol, int(end[i]), float(atr[name][i]), {}, view
                )
                s, trade, known[i] = labels.attempt(sim, view, pos)
                if trade is not None:
                    k = int(np.searchsorted(cover[:, 0], pos.entry_ns, side="right")) - 1
                    if k < 0 or int(trade["exit_ns"]) >= cover[k, 1]:
                        s = UNCOVERED
                    ticks[i] = trade["pnl_ticks"]
                    if trade["entry_slip_ticks"] is not None:  # the engine held a usable book
                        spread[i] = trade["decision_spread_ticks"]
                        slip[i] = trade["entry_slip_ticks"]
                    reason[i] = REASONS.index(trade["exit_reason"])
                state[i] = STATES.index(s)
            out[f"state:{name}:{mode}"], out[f"ticks:{name}:{mode}"] = state, ticks
            out[f"known:{name}:{mode}"], out[f"reason:{name}:{mode}"] = known, reason
            out[f"spread:{name}:{mode}"], out[f"slip:{name}:{mode}"] = spread, slip
    return out


def slow_direction(
    ordinal: np.ndarray,
    end: np.ndarray,
    minute: np.ndarray,
    minute_end: np.ndarray,
    values: np.ndarray,
) -> dict[str, np.ndarray]:
    """Each rule's direction (1, -1, or 0 for none) for candidates decided at the second rows
    `ordinal` ending at `end`, from one slow scale's minute rows: their index counters, ends,
    and the columns state, dir, trend, high_conf_age_s, low_conf_age_s (NaN for NULL). A
    candidate reads the latest completed minute, the row `ordinal // 60`, as its hourly ATR does,
    and nothing when that row is absent.

    - `leg`: the direction of the open leg, so the last confirmed pivot was a low (up) or a
      high (down);
    - `trend`: the stored trend (a higher high and a higher low, or the mirror);
    - `fresh`: `leg`, while the pivot that started the leg was confirmed at most `FRESH_S`
      scheduled-open seconds before the decision row."""
    n = len(ordinal)
    if not len(minute):
        return {rule: np.zeros(n, np.int8) for rule in RULES}
    want = ordinal // 60
    at = np.minimum(np.searchsorted(minute, want), len(minute) - 1)
    ok = (minute[at] == want) & (minute_end[at] <= end) & (minute_end[at] > end - MINUTE_REACH_NS)
    state, direction, trend, high_age, low_age = values[at].T
    leg = np.where(ok & (state == swings.ACTIVE) & np.isfinite(direction), direction, 0.0)
    with np.errstate(invalid="ignore"):  # an unknown age is not fresh
        age = np.where(leg > 0, low_age, high_age) + (end - minute_end[at]) / NS
        fresh = (leg != 0) & (age <= FRESH_S)
    return {
        "leg": leg.astype(np.int8),
        "trend": np.where(ok & np.isfinite(trend), trend, 0.0).astype(np.int8),
        "fresh": np.where(fresh, leg, 0.0).astype(np.int8),
    }


def replay_sessions(
    root: str, sessions: list[tuple], variants: list[int], slow: dict[str, int], url: str | None
) -> dict:
    """One worker's task: consecutive front sessions (trade date, contract id, symbol, first and
    last second ordinal, open, close) of one product. `slow` maps each slow swing scale to its
    variant id."""
    data = ProductData.load(root)
    product, base = data.product, EXECUTIONS["base"]
    calendar, _, spans = load_sessions(product, sessions[0][0], sessions[-1][0], 0)
    by_date = {s.trade_date: s for s in spans}
    cache = DayCache(size=3, book=True)
    parts = []
    with db.connect(url) as conn:
        for day, cid, symbol, first, last, open_ns, close_ns in sessions:
            found = conn.execute(
                QUERY, (MINUTE_REACH_NS, cid, first, last, open_ns, close_ns, variants)
            ).fetchall()
            conn.rollback()
            if not found:
                continue
            rows = np.array(found, dtype=np.float64)  # NULL becomes NaN
            end = np.array([r[1] for r in found], np.int64)  # nanoseconds do not fit a float
            session = by_date[day]
            source = HistoricalSource(product, data.files, [], [session], base, symbol, cache)
            chunk = source.stored_chunk(symbol, session)[0]
            if not len(chunk.coverage) or not len(chunk.book):
                raise ValueError(f"No MBP-1 records for {symbol} on {day}: are its files present?")
            view = session_view(chunk, calendar, base)
            part = simulate(product, calendar, symbol, chunk, view, end, rows)
            part["day"] = np.full(len(rows), (day - date(2000, 1, 1)).days, np.int32)
            ordinal = np.array([r[9] for r in found], np.int64)
            minutes = conn.execute(
                SLOW_QUERY,
                (cid, list(slow.values()), first // 60, last // 60,
                 open_ns - MINUTE_REACH_NS, close_ns),
            ).fetchall()  # fmt: skip
            conn.rollback()
            for scale, variant in slow.items():
                own = [r for r in minutes if r[0] == variant]
                signals = slow_direction(
                    ordinal,
                    end,
                    np.array([r[1] for r in own], np.int64),
                    np.array([r[2] for r in own], np.int64),
                    np.array([r[3:] for r in own], np.float64).reshape(len(own), 5),
                )
                for rule, signal in signals.items():
                    part[f"slow:{scale}:{rule}"] = signal
            parts.append(part)
    return {"root": root, "parts": parts}


def _task(args: tuple) -> dict:
    return replay_sessions(*args)


def interval(values: np.ndarray, rng) -> list[float | None]:
    """95% interval of the mean of per-trade-date values, resampling whole trade dates.
    With no values it is undefined: [None, None], never a zero-width interval."""
    if not len(values):
        return [None, None]
    draw = rng.integers(0, len(values), (benchmark.RESAMPLES, len(values)))
    return [round(float(v), 2) for v in np.percentile(values[draw].mean(axis=1), [2.5, 97.5])]


def finite_mean(values: np.ndarray, digits: int) -> float | None:
    """Mean of the finite values, or None when there are none (JSON has no NaN)."""
    values = values[np.isfinite(values)]
    return round(float(values.mean()), digits) if len(values) else None


def drawdown(pnl: np.ndarray) -> float:
    curve = np.r_[0.0, np.cumsum(pnl)]
    return float(np.max(np.maximum.accumulate(curve) - curve))


def portfolio(decision, known, state, cooldown: int) -> tuple[np.ndarray, int, int]:
    """One position at a time over orders sorted by decision time, as `Engine.execute` takes
    them: the next order is the first decided after the last outcome is known and the cooldown
    has passed. Returns the orders that became trades, and the numbers cancelled and placed."""
    held, cancelled, placed = [], 0, 0
    now, cooldown_until, n = 0, 0, len(decision)
    trades = np.isin(state, TRADES)
    while True:
        i = int(np.searchsorted(decision, max(now, cooldown_until), side="right"))
        if i >= n:
            break
        placed += 1
        now = max(int(decision[i]), int(known[i]))
        if trades[i]:
            held.append(i)
            cooldown_until = now + cooldown
        else:
            cancelled += 1
    return np.array(held, dtype=int), cancelled, placed


class Frame:
    """Every replayed candidate, one row each, with the helpers the report shares."""

    def __init__(self, products: list[str], parts: list[tuple[int, dict]], days: list[list[int]]):
        self.products, self.days = products, days
        keys = parts[0][1].keys() if parts else ()
        self.a = {k: np.concatenate([p[k] for _, p in parts]) for k in keys}
        self.a["product"] = (
            np.concatenate([np.full(len(p["end"]), k, np.int8) for k, p in parts])
            if parts
            else np.zeros(0, np.int8)
        )
        self.n = len(self.a["product"])
        tick = np.array([PRODUCTS[p].tick_value for p in products])
        self.tick_usd = tick[self.a["product"]] if self.n else np.zeros(0)
        base = date(2000, 1, 1)
        self.month = (
            np.array([(base + timedelta(days=int(d))).month for d in self.a["day"]], np.int8)
            if self.n
            else np.zeros(0, np.int8)
        )

    def money(self, bracket: str, mode: str) -> dict[str, np.ndarray]:
        """Per candidate under one bracket and execution setting: R after fills and before
        commission, net dollars, the commission in R, and the two values kept apart: the trade
        result (NaN unless a trade closed at book prices) and the value of attempting (the
        result, zero for a known non-trade, NaN when unknown)."""
        config = EXECUTIONS[mode]
        state, ticks = self.a[f"state:{bracket}:{mode}"], self.a[f"ticks:{bracket}:{mode}"]
        risk = self.a[f"stop:{bracket}"] * self.tick_usd * config.contracts
        commission = 2 * config.contracts * config.commission_per_contract
        usd = ticks * self.tick_usd * config.contracts - commission
        closed = state == CLOSED
        return {
            "state": state,
            "closed": closed,
            "known": closed | (state == LATE),
            "r": np.where(closed, ticks / self.a[f"stop:{bracket}"], np.nan),
            "usd": np.where(closed, usd, np.nan),
            "value_r": np.where(
                closed, ticks / self.a[f"stop:{bracket}"], np.where(state == LATE, 0.0, np.nan)
            ),
            "value_usd": np.where(closed, usd, np.where(state == LATE, 0.0, np.nan)),
            "ledger_usd": usd,  # also at a fallback price: only the portfolio reads it
            "risk_usd": risk,
            "cost_r": commission / risk,
            "reason": self.a[f"reason:{bracket}:{mode}"],
            # the costs of the entry in R: the spread held at the decision, and the fill against
            # that book's mid-price (half the spread plus the move while the order travelled)
            "spread_r": self.a[f"spread:{bracket}:{mode}"] / self.a[f"stop:{bracket}"],
            "slip_r": self.a[f"slip:{bracket}:{mode}"] / self.a[f"stop:{bracket}"],
            "exit_known": self.a[f"known:{bracket}:{mode}"],
        }

    def candidate_stats(self, rows: np.ndarray, m: dict) -> dict:
        """Trade statistics and the value of attempting over `rows`, by product and pooled."""
        out = {}
        groups = {"all": rows} | {
            p: rows & (self.a["product"] == k) for k, p in enumerate(self.products)
        }
        for name, sel in groups.items():
            if not sel.any():
                continue
            closed, known = sel & m["closed"], sel & m["known"]
            entry: dict = {
                "candidates": int(sel.sum()),
                "states": {
                    STATES[s]: int(c)
                    for s, c in enumerate(np.bincount(m["state"][sel], minlength=len(STATES)))
                    if c
                },
                "trades": int(closed.sum()),
            }
            if closed.any():
                r, usd = m["r"][closed], m["usd"][closed]
                entry |= {
                    "win_rate": round(float((usd > 0).mean()), 4),
                    "avg_r_before_commission": round(float(r.mean()), 4),
                    "avg_r_net": round(float((usd / m["risk_usd"][closed]).mean()), 4),
                    "avg_net_usd": round(float(usd.mean()), 2),
                    "avg_commission_r": round(float(m["cost_r"][closed].mean()), 4),
                    "avg_decision_spread_r": finite_mean(m["spread_r"][closed], 4),
                    "avg_entry_slip_r": finite_mean(m["slip_r"][closed], 4),
                    "exit_reasons": {
                        REASONS[k]: int(c)
                        for k, c in enumerate(
                            np.bincount(m["reason"][closed], minlength=len(REASONS))
                        )
                        if c
                    },
                }
            if known.any():
                value, day = m["value_usd"][known], self.a["day"][known]
                entry["value_of_attempting"] = {
                    "known": int(known.sum()),
                    "mean_r_before_commission": round(float(m["value_r"][known].mean()), 4),
                    "mean_net_usd": round(float(value.mean()), 2),
                    "mean_net_usd_interval_95": benchmark.interval(
                        value, day, np.random.default_rng(SEED)
                    ),
                }
            out[name] = entry
        return out

    def ledger(self, taken: np.ndarray, m: dict, mode: str, dates: np.ndarray) -> dict:
        """One portfolio over the taken candidates of every product: one position at a time."""
        order = np.flatnonzero(taken)
        decision = self.a["end"][order] + EXECUTIONS[mode].close_delay
        order = order[np.lexsort((self.a["product"][order], decision))]
        decision = self.a["end"][order] + EXECUTIONS[mode].close_delay
        held, cancelled, placed = portfolio(
            decision, m["exit_known"][order], m["state"][order], EXECUTIONS[mode].cooldown
        )
        rows = order[held]
        usd, flagged = m["ledger_usd"][rows], m["state"][rows] != CLOSED
        charged = usd - np.where(flagged, m["risk_usd"][rows], 0.0)
        daily = {"fallback": np.zeros(len(dates)), "charged": np.zeros(len(dates))}
        at = np.searchsorted(dates, self.a["day"][rows])
        np.add.at(daily["fallback"], at, usd)
        np.add.at(daily["charged"], at, charged)
        rng = np.random.default_rng(SEED)
        out = {
            "candidates_taken": int(taken.sum()),
            "orders": placed,
            "fills": len(rows),
            "cancelled": cancelled,
            "skipped_while_occupied": int(taken.sum()) - placed,
            "flagged_trades": {
                "count": int(flagged.sum()),
                "net_usd": round(float(usd[flagged].sum()), 2),
            },
            "net_usd": round(float(usd.sum()), 2),
            "max_drawdown_usd": round(drawdown(usd), 2),
            "net_usd_flagged_charged": round(float(charged.sum()), 2),
            "max_drawdown_usd_flagged_charged": round(drawdown(charged), 2),
            "mean_daily_net_usd": round(float(daily["fallback"].mean()), 2) if len(dates) else None,
            "mean_daily_net_usd_interval_95": interval(daily["fallback"], rng),
            "by_month": {
                f"2026-{mo:02d}": {
                    "fills": int(pick.sum()),
                    "net_usd": round(float(usd[pick].sum()), 2),
                }
                for mo in TEST_MONTHS
                if (pick := self.month[rows] == mo).any()
            },
            "by_product": {
                p: {"fills": int(pick.sum()), "net_usd": round(float(usd[pick].sum()), 2)}
                for k, p in enumerate(self.products)
                if (pick := self.a["product"][rows] == k).any()
            },
        }
        return out | {"daily": daily}


def displacement_rule(
    frame: Frame, eligible: np.ndarray, m: dict
) -> tuple[np.ndarray, np.ndarray, list]:
    """The displacement rule's choices on the test months. For each month and product: a linear
    fit (one coefficient and an intercept) of the value of attempting, in R before commission,
    on displacement, over the product's earlier sessions except the last one before the month;
    a candidate is taken when its predicted value is above its own commission in R. Returns the
    candidates taken, the candidates of the months that had a fit for every product, and the
    fits."""
    a = frame.a
    taken, scored, fits = np.zeros(frame.n, bool), np.zeros(frame.n, bool), []
    base = date(2000, 1, 1)
    usable = eligible & m["known"] & np.isfinite(a["disp"])
    for month in TEST_MONTHS:
        lo = (date(2026, month, 1) - base).days
        hi = (date(2026 + month // 12, month % 12 + 1, 1) - base).days
        block = eligible & (a["day"] >= lo) & (a["day"] < hi)
        models = {}
        for k in range(len(frame.products)):
            before = np.array([d for d in frame.days[k] if d < lo])
            train = (
                usable & (a["product"] == k) & (a["day"] < before[-1]) if len(before) > 1 else None
            )
            if train is None or train.sum() < MIN_TRAIN or np.ptp(a["disp"][train]) == 0:
                break
            slope, intercept = np.polyfit(a["disp"][train], m["value_r"][train], 1)
            models[k] = (float(slope), float(intercept), int(train.sum()))
        else:
            scored |= block
            for k, (slope, intercept, rows) in models.items():
                pick = block & (a["product"] == k) & np.isfinite(a["disp"])
                with np.errstate(invalid="ignore"):
                    taken |= pick & (slope * a["disp"] + intercept > m["cost_r"])
                fits.append(
                    {
                        "month": f"2026-{month:02d}",
                        "product": frame.products[k],
                        "train_rows": rows,
                        "slope_r_per_theta": round(slope, 5),
                        "intercept_r": round(intercept, 5),
                    }
                )
            continue
        fits.append(
            {
                "month": f"2026-{month:02d}",
                "skipped": "a product has too few known values before it",
            }
        )
    return taken, scored, fits


def agreement(frame: Frame, eligible: np.ndarray, m: dict, mode: str) -> dict:
    """The eligible candidates split by each slow scale and rule into those the slower
    timeframe is `with` and `against`. No rule is fitted, so each is reported on the whole
    development period, on the months before the test months, and on the test months, where
    each also runs as one portfolio."""
    a = frame.a
    side = np.where(a["kind"] == HIGH, -1, 1)
    lo = (date(2026, TEST_MONTHS[0], 1) - date(2000, 1, 1)).days
    periods = {
        "development_period": eligible,
        "before_test_months": eligible & (a["day"] < lo),
        "test_months": eligible & (a["day"] >= lo),
    }
    every = np.unique(np.concatenate([np.asarray(d, dtype=int) for d in frame.days]))
    dates = every[every >= lo]
    out: dict = {}
    for scale in SLOW_SCALES:
        out[scale] = {}
        for rule in RULES:
            signal = a[f"slow:{scale}:{rule}"]
            entry = {}
            for name, pick in (("with", signal == side), ("against", signal == -side)):
                book = frame.ledger(periods["test_months"] & pick, m, mode, dates)
                entry[name] = {
                    period: frame.candidate_stats(sel & pick, m) for period, sel in periods.items()
                } | {"test_months_portfolio": {k: v for k, v in book.items() if k != "daily"}}
            out[scale][rule] = entry
    return out


def report(frame: Frame, variant: int, provisional: bool) -> dict:
    """One label variant's candidates: what was left out, then every bracket and execution
    setting, with the policies compared on the test months."""
    a = frame.a
    rows = a["variant"] == variant
    if provisional:
        rows = rows & (a["prov"] == 1)
    eligible = rows & (a["why"] == ELIGIBLE)
    out: dict = {
        "candidates": int(rows.sum()),
        "ineligible": {
            name: int((rows & (a["why"] == code)).sum()) for code, name in INELIGIBLE.items()
        },
        "eligible": int(eligible.sum()),
        "brackets": {},
    }
    for bracket in BRACKETS:
        base = frame.money(bracket, "base")
        taken, scored, fits = displacement_rule(frame, eligible, base)  # chosen at base costs
        dates = np.zeros(0, int)
        if months := [int(f["month"][-2:]) for f in fits if "skipped" not in f]:
            # every warm session of the scored months, with or without a candidate
            base = date(2000, 1, 1)
            lo = (date(2026, min(months), 1) - base).days
            hi = (date(2026 + max(months) // 12, max(months) % 12 + 1, 1) - base).days
            every = np.unique(np.concatenate([np.asarray(d, dtype=int) for d in frame.days]))
            dates = every[(every >= lo) & (every < hi)]
        entry: dict = {
            "displacement_rule_fits": fits,
            "null_displacement": int((scored & ~np.isfinite(a["disp"])).sum()),
        }
        for mode in EXECUTIONS:
            m = frame.money(bracket, mode)
            policies = {"take_all": scored, "displacement_rule": scored & taken}
            ledgers = {name: frame.ledger(sel, m, mode, dates) for name, sel in policies.items()}
            entry[mode] = {
                "development_period": {"take_all": frame.candidate_stats(eligible, m)},
                "test_months": {
                    "trade_dates": len(dates),
                    "per_candidate": {
                        name: frame.candidate_stats(sel, m) for name, sel in policies.items()
                    },
                    "portfolio": {
                        name: {k: v for k, v in led.items() if k != "daily"}
                        for name, led in ledgers.items()
                    },
                    "displacement_rule_minus_take_all_daily_net_usd": {
                        price: {
                            "mean": round(float(delta.mean()), 2) if len(delta) else None,
                            "interval_95": interval(delta, np.random.default_rng(SEED)),
                        }
                        for price in ("fallback", "charged")
                        for delta in [
                            ledgers["displacement_rule"]["daily"][price]
                            - ledgers["take_all"]["daily"][price]
                        ]
                    },
                },
            }
            if bracket == AGREEMENT_BRACKET:
                entry[mode]["agreement"] = agreement(frame, eligible, m, mode)
        out["brackets"][bracket] = entry
    return out


def settings() -> dict:
    return {
        "brackets": {name: {"atr_of": table} | asdict(b) for name, (table, b) in BRACKETS.items()},
        "executions": {name: asdict(c) for name, c in EXECUTIONS.items()},
        "side": "sell at a candidate high, buy at a candidate low",
        "eligibility": f"both ATRs defined; decision row end + {HOLD_S} s is not after the "
        "forced exit before the close",
        "portfolio": "one position at a time across the products; one contract a trade",
        "policies_chosen_at": "base execution; the stressed replay keeps the same choices",
        "agreement": {
            "bracket": AGREEMENT_BRACKET,
            "slow_scales": list(SLOW_SCALES),
            "read_at": "the slow scale's row of the latest completed minute",
            "rules": {
                "leg": "direction of the open leg",
                "trend": "the stored trend",
                "fresh": f"leg, its starting pivot confirmed at most {FRESH_S} s ago",
            },
            "with": "the rule's direction is the entry's side; against: the opposite side",
        },
    }


def run(
    products: list[str],
    start: date = DEV_START,
    end: date = DEV_END,
    names: list[str] | None = None,
    workers: int | None = None,
    url: str | None = None,
    log=lambda line: None,
) -> dict:
    benchmark.check_period(start, end)
    products = list(dict.fromkeys(products))
    chosen = [v for v in FAST_LABELS if not names or v.VARIANT in names]
    if unknown := sorted(set(names or ()) - {v.VARIANT for v in FAST_LABELS}):
        raise ValueError(f"Unknown fast label variants {unknown}")
    tasks, days, sessions = [], [], {}
    with db.connect(url) as conn:
        ids = benchmark.variant_ids(conn)
        pivot = store.STAGE_TABLE[chosen[0].SCALE.NAME]
        variants = {v.VARIANT: ids[v.TABLE, v.VARIANT] for v in chosen}
        needed = [("candle_1m_1s", 0), ("candle_1h_1m", 0)]
        needed += [(pivot, ids[pivot, v.SCALE.VARIANT]) for v in chosen]
        needed += [(v.TABLE, variants[v.VARIANT]) for v in chosen]
        slow = {scale: ids[SLOW_STAGES[0].TABLE, scale] for scale in SLOW_SCALES}
        needed += [(SLOW_STAGES[0].TABLE, variant) for variant in slow.values()]
        for root in products:
            found = benchmark.front_sessions(conn, root, start, end, sorted(set(needed)))
            symbols = dict(
                conn.execute(
                    "SELECT contract_id, contract FROM market.front_session WHERE product = %s",
                    (root,),
                ).fetchall()
            )
            warm = [(s[0], s[1], symbols[s[1]], *s[2:6]) for s in found if s[6]]
            sessions[root] = {"used": len(warm), "not_warm": len(found) - len(warm)}
            days.append(sorted((s[0] - date(2000, 1, 1)).days for s in warm))
            tasks += [
                (root, warm[i : i + SESSIONS_PER_TASK], list(variants.values()), slow, url)
                for i in range(0, len(warm), SESSIONS_PER_TASK)
            ]
    workers = workers or max(1, min(8, (mp.cpu_count() or 2) - 2))
    started, parts, done = time.time(), [], 0
    log(
        f"Replay: {sum(s['used'] for s in sessions.values())} sessions, {len(tasks)} tasks, "
        f"{workers} workers"
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
    parts.sort(key=lambda p: (p[0], int(p[1]["day"][0])))  # the same rows in the same order
    frame = Frame(products, parts, days)
    if not frame.n:
        raise ValueError(
            f"No candidates to replay for {products} from {start} to {end}: "
            f"{sessions}. Are the stored rows built (`research ingest plan`)?"
        )
    out = {
        "period": [start.isoformat(), end.isoformat()],
        "test_months": [f"2026-{m:02d}" for m in TEST_MONTHS],
        "settings": settings(),
        "sessions": sessions,
        "candidates_replayed": frame.n,
        "labels": {},
    }
    for name, variant in variants.items():
        out["labels"][name] = {
            "all_candidates": report(frame, variant, False),
            "provisional": report(frame, variant, True),
        }
        log(f"{name}: done")
    return out
