"""Disjoint base bars on the scheduled-open grid, built from TBBO trades.

Every scheduled-open slot gets a row: `OBSERVED` (trades), `NO_TRADES` (covered,
no trades), or `MISSING` (no data coverage). Scheduled closures get no row.

A trade is assigned by event time, unless it is received too late for its slot to
include it: the slot ending at `T` closes at `T + close_delay` (live sessions cannot
wait longer), so a later arrival joins the slot open when it was received. Trades are
released slot by slot, in receive order within a slot. Historical replay applies the
same rules, which keeps backtests and live sessions identical.
"""

from dataclasses import dataclass, fields
from typing import NamedTuple

import numpy as np

from .market import PX, Trades

MISSING, NO_TRADES, OBSERVED = 0, 1, 2


@dataclass(frozen=True)
class BaseBars:
    """One row per scheduled-open slot `[end - step, end)`. Prices are fixed-point integers and
    are zero when no trade was observed. `delta_high`/`delta_low` are the extremes of running
    buy - sell volume from the slot start (including the starting zero)."""

    step: int
    end: np.ndarray
    status: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    high_at: np.ndarray
    low_at: np.ndarray
    volume: np.ndarray
    buy: np.ndarray
    sell: np.ndarray
    trades: np.ndarray
    pv: np.ndarray  # sum of quoted price x size, the VWAP numerator
    delta_high: np.ndarray
    delta_low: np.ndarray

    ARRAYS = (
        "end",
        "status",
        "open",
        "high",
        "low",
        "close",
        "high_at",
        "low_at",
        "volume",
        "buy",
        "sell",
        "trades",
        "pv",
        "delta_high",
        "delta_low",
    )

    def __len__(self) -> int:
        return len(self.end)

    def take(self, index) -> "BaseBars":
        return BaseBars(self.step, *(getattr(self, a)[index] for a in self.ARRAYS))

    @classmethod
    def concat(cls, step: int, parts: list["BaseBars"]) -> "BaseBars":
        if not parts:
            return cls.empty(step)
        return cls(step, *(np.concatenate([getattr(p, a) for p in parts]) for a in cls.ARRAYS))

    @classmethod
    def empty(cls, step: int) -> "BaseBars":
        return cls.blank(step, np.empty(0, np.int64), np.empty(0, np.int8))

    @classmethod
    def blank(cls, step: int, end: np.ndarray, status: np.ndarray) -> "BaseBars":
        n = len(end)
        z = np.zeros(n, np.int64)
        return cls(
            step,
            end,
            status,
            z,
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            z.copy(),
            np.zeros(n),
            z.copy(),
            z.copy(),
        )


@dataclass
class AggregationReport:
    trades: int = 0
    volume: int = 0
    unknown_side_volume: int = 0
    late_trades: int = 0  # received after their event-time slot had closed
    outside_schedule: int = 0  # assigned to no scheduled-open slot of this chunk
    in_missing_slots: int = 0  # trades inside slots without data coverage
    slots: int = 0
    observed_slots: int = 0
    missing_slots: int = 0

    def add(self, other: "AggregationReport") -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


def covered(ends: np.ndarray, step: int, coverage: np.ndarray) -> np.ndarray:
    """True for slots fully inside one of the `[start, end)` coverage intervals."""
    if len(coverage) == 0:
        return np.zeros(len(ends), bool)
    starts = ends - step
    i = np.searchsorted(coverage[:, 1], starts, side="right")
    i = np.minimum(i, len(coverage) - 1)
    return (coverage[i, 0] <= starts) & (ends <= coverage[i, 1])


def assignment_ns(
    ts_event: np.ndarray, ts_recv: np.ndarray, feed_latency: int, close_delay: int
) -> np.ndarray:
    """Time used to place each trade in a slot: its event time, or the time it became
    available minus the slot close delay when it arrived after its slot had closed."""
    return np.maximum(ts_event, ts_recv + feed_latency - close_delay)


def assignment_times(trades: Trades, feed_latency: int, close_delay: int) -> np.ndarray:
    return assignment_ns(trades.ts_event, trades.ts_recv, feed_latency, close_delay)


class Aggregation(NamedTuple):
    bars: BaseBars
    report: AggregationReport
    order: np.ndarray  # indices of the trades used, by slot, then receive order
    slot_end: np.ndarray  # end of each used trade's slot
    at: np.ndarray  # assignment time of each used trade (see `assignment_ns`)


def aggregate(
    trades: Trades,
    ends: np.ndarray,
    step: int,
    coverage: np.ndarray,
    *,
    feed_latency: int,
    close_delay: int,
) -> Aggregation:
    """Aggregate one contract's trades into base bars for the given slot ends."""
    report = AggregationReport(slots=len(ends))
    status = np.where(covered(ends, step, coverage), NO_TRADES, MISSING).astype(np.int8)
    bars = BaseBars.blank(step, ends.astype(np.int64), status)
    report.missing_slots = int(np.sum(status == MISSING))
    none = np.empty(0, np.int64)
    if len(trades) == 0 or len(ends) == 0:
        report.outside_schedule = len(trades)
        return Aggregation(bars, report, none, none, none)

    assign = assignment_times(trades, feed_latency, close_delay)
    # late: assigned to a later slot than its event time's (a small delay within the slot is not)
    report.late_trades = int(np.sum(assign // step > trades.ts_event // step))
    slot = np.searchsorted(ends, assign, side="right")
    inside = slot < len(ends)
    inside[inside] &= ends[slot[inside]] - step <= assign[inside]
    report.outside_schedule = int(np.sum(~inside))
    in_missing = inside.copy()
    in_missing[inside] = status[slot[inside]] == MISSING
    report.in_missing_slots = int(np.sum(in_missing))
    keep = inside & ~in_missing

    order = np.flatnonzero(keep)
    order = order[np.argsort(slot[order], kind="stable")]  # receive order within each slot
    s = slot[order]
    price, size, side = trades.price[order], trades.size[order], trades.side[order]
    at = assign[order]
    report.trades = len(order)
    report.volume = int(size.sum())
    report.unknown_side_volume = int(size[side == 0].sum())
    if not len(order):
        return Aggregation(bars, report, none, none, none)

    starts = np.flatnonzero(np.r_[True, s[1:] != s[:-1]])
    stops = np.r_[starts[1:], len(s)]
    rows = s[starts]
    bars.status[rows] = OBSERVED
    bars.open[rows] = price[starts]
    bars.close[rows] = price[stops - 1]
    high = np.maximum.reduceat(price, starts)
    low = np.minimum.reduceat(price, starts)
    bars.high[rows], bars.low[rows] = high, low
    seg = np.repeat(np.arange(len(starts)), stops - starts)
    index = np.arange(len(s))
    big = np.iinfo(np.int64).max
    bars.high_at[rows] = at[np.minimum.reduceat(np.where(price == high[seg], index, big), starts)]
    bars.low_at[rows] = at[np.minimum.reduceat(np.where(price == low[seg], index, big), starts)]
    bars.volume[rows] = np.add.reduceat(size, starts)
    bars.buy[rows] = np.add.reduceat(np.where(side > 0, size, 0), starts)
    bars.sell[rows] = np.add.reduceat(np.where(side < 0, size, 0), starts)
    bars.trades[rows] = stops - starts
    bars.pv[rows] = np.add.reduceat(price / PX * size, starts)
    signed = np.cumsum(side.astype(np.int64) * size)
    base = np.r_[0, signed][starts]
    running = signed - base[seg]
    bars.delta_high[rows] = np.maximum(np.maximum.reduceat(running, starts), 0)
    bars.delta_low[rows] = np.minimum(np.minimum.reduceat(running, starts), 0)
    report.observed_slots = len(starts)
    return Aggregation(bars, report, order, ends[s], at)


class Rollup:
    """Combine consecutive base bars into coarser complete bars (for example seconds into
    minutes), carrying an unfinished group to the next call."""

    def __init__(self, step: int, group: int):
        if group % step:
            raise ValueError("Rollup group must be a multiple of the base step")
        self.step, self.group = step, group
        self.pending = BaseBars.empty(step)

    def update(self, bars: BaseBars) -> BaseBars:
        if bars.step != self.step:
            raise ValueError("Rollup received bars of a different step")
        b = BaseBars.concat(self.step, [self.pending, bars])
        if not len(b):
            return BaseBars.empty(self.group)
        group_end = -(-b.end // self.group) * self.group
        complete = b.end == group_end  # a group is finished once its last slot arrives
        if not complete.any():
            self.pending = b
            return BaseBars.empty(self.group)
        cut = int(np.flatnonzero(complete)[-1]) + 1
        self.pending = b.take(slice(cut, None))
        return combine(b.take(slice(0, cut)), group_end[:cut], self.group)


def combine(b: BaseBars, keys: np.ndarray, step: int) -> BaseBars:
    """Aggregate base bars sharing a group end (`keys`) into one bar per group."""
    starts = np.flatnonzero(np.r_[True, keys[1:] != keys[:-1]])
    stops = np.r_[starts[1:], len(keys)]
    count = stops - starts
    obs = b.status == OBSERVED
    n_obs = np.add.reduceat(obs.astype(np.int64), starts)
    n_miss = np.add.reduceat((b.status == MISSING).astype(np.int64), starts)
    full = count == step // b.step
    status = np.where(
        (n_miss > 0) | ~full, MISSING, np.where(n_obs > 0, OBSERVED, NO_TRADES)
    ).astype(np.int8)
    out = BaseBars.blank(step, keys[starts], status)
    has = n_obs > 0
    index = np.arange(len(keys))
    big = np.iinfo(np.int64).max
    first = np.minimum.reduceat(np.where(obs, index, big), starts)
    last = np.maximum.reduceat(np.where(obs, index, -1), starts)
    out.open[has] = b.open[first[has]]
    out.close[has] = b.close[last[has]]
    high = np.maximum.reduceat(np.where(obs, b.high, np.iinfo(np.int64).min), starts)
    low = np.minimum.reduceat(np.where(obs, b.low, big), starts)
    out.high[has], out.low[has] = high[has], low[has]
    seg = np.repeat(np.arange(len(starts)), count)
    hi_i = np.minimum.reduceat(np.where(obs & (b.high == high[seg]), index, big), starts)
    lo_i = np.minimum.reduceat(np.where(obs & (b.low == low[seg]), index, big), starts)
    out.high_at[has] = b.high_at[hi_i[has]]
    out.low_at[has] = b.low_at[lo_i[has]]
    for name in ("volume", "buy", "sell", "trades", "pv"):
        getattr(out, name)[:] = np.add.reduceat(getattr(b, name), starts)
    net = b.buy - b.sell
    before = np.cumsum(net) - net  # running delta at each slot start, from the series start
    base = before[starts][seg]
    out.delta_high[:] = np.maximum(np.maximum.reduceat(before - base + b.delta_high, starts), 0)
    out.delta_low[:] = np.minimum(np.minimum.reduceat(before - base + b.delta_low, starts), 0)
    if np.any(~has & (out.status == OBSERVED)):
        raise AssertionError("Observed group without an observed slot")
    return out
