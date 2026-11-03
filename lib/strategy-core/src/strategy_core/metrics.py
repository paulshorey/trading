"""Per-second TBBO metrics beyond OHLCV: aggressor flow detail, trade sizes, the price path,
sweeps, and the pre-trade book sampled at trades (TBBO handoff, sections 5-6 and
Appendix A; see docs/project/ingestion.md for the implemented list).

Each accepted trade is classified into the handoff's validity subsets:

- P (quote): bid and ask are defined and bid <= ask (crossed books are excluded).
- D (depth): P, displayed sizes are nonnegative, and bid size + ask size > 0.
- C (orders): D and displayed order counts sum to more than zero.
- K (known side): the aggressor is a buyer or a seller.

A trade with an unusable book still counts in OHLCV and CVD; each book statistic has its
own count. Every field is a mergeable statistic (a sum, an extreme, or a first or last
value), so seconds combine into minutes and rolling windows exactly; ratios are formed only
after merging, never by averaging per-second ratios. A field is undefined when its `valid`
count is zero in that slot (stored as NULL).

Prices and price differences stay in Databento fixed-point units here. Model features derived
from them are normalized in `indicators.py`.
"""

from dataclasses import dataclass

import numpy as np

from .bars import Aggregation
from .market import F_MAYBE_BAD_BOOK, UNDEF_PRICE, Trades

SUM, MAX, MIN, FIRST, LAST = "sum", "max", "min", "first", "last"


@dataclass(frozen=True)
class Field:
    name: str
    kind: str  # how slots merge: sum, max, min, first, or last
    dtype: type
    valid: str  # count that must be positive for the value to be defined ("" = always)
    description: str


INT, FLOAT = np.int64, np.float64
FIELDS = (
    # Trades and the price path within the slot
    Field("buy_trades", SUM, INT, "", "Buyer-aggressor trade records"),
    Field("sell_trades", SUM, INT, "", "Seller-aggressor trade records"),
    Field("size_sq", SUM, INT, "", "Sum of squared trade sizes, for size dispersion"),
    Field("max_size", MAX, INT, "trades", "Largest trade size"),
    Field("first_at", FIRST, INT, "trades", "Assignment time of the first trade (UTC ns)"),
    Field("last_at", LAST, INT, "trades", "Assignment time of the last trade (UTC ns)"),
    Field("path_abs", SUM, INT, "", "Sum of absolute price changes between consecutive trades"),
    Field("upticks", SUM, INT, "", "Consecutive-trade price increases"),
    Field("downticks", SUM, INT, "", "Consecutive-trade price decreases"),
    Field("side_pairs", SUM, INT, "", "Consecutive trade pairs with both aggressor sides known"),
    Field("side_switches", SUM, INT, "", "Known-side pairs whose aggressor side changed"),
    Field("first_side", FIRST, INT, "trades", "Side of the first trade: 1 buy, -1 sell, 0 unknown"),
    Field("last_side", LAST, INT, "trades", "Side of the last trade: 1 buy, -1 sell, 0 unknown"),
    # Sweeps: printed beyond the pre-trade opposite best
    Field("sweep_buy_volume", SUM, INT, "", "Buyer volume printed above the pre-trade ask"),
    Field("sweep_sell_volume", SUM, INT, "", "Seller volume printed below the pre-trade bid"),
    # Validity subsets
    Field("quote_trades", SUM, INT, "", "Trades with a usable pre-trade bid and ask (P)"),
    Field("quote_volume", SUM, INT, "", "Volume of P trades"),
    Field("known_quote_volume", SUM, INT, "", "Volume of P trades with a known side"),
    Field("depth_trades", SUM, INT, "", "Trades with usable displayed sizes (D)"),
    Field("depth_volume", SUM, INT, "", "Volume of D trades"),
    Field("known_depth_volume", SUM, INT, "", "Volume of D trades with a known side"),
    Field("order_trades", SUM, INT, "", "Trades with usable displayed order counts (C)"),
    # Quotes (P)
    Field("spread_sum", SUM, INT, "quote_trades", "Sum of quoted spreads (ask - bid)"),
    Field("spread_max", MAX, INT, "quote_trades", "Widest quoted spread"),
    Field("mid2_open", FIRST, INT, "quote_trades", "First sampled bid + ask (twice the midpoint)"),
    Field("mid2_high", MAX, INT, "quote_trades", "Highest sampled bid + ask"),
    Field("mid2_low", MIN, INT, "quote_trades", "Lowest sampled bid + ask"),
    Field("last_bid", LAST, INT, "quote_trades", "Last sampled bid"),
    Field("last_ask", LAST, INT, "quote_trades", "Last sampled ask"),
    Field(
        "quote_at",
        LAST,
        INT,
        "quote_trades",
        "Assignment time of the last trade with a usable book",
    ),
    Field(
        "eff_spread_sum",
        SUM,
        INT,
        "known_quote_volume",
        "Sum of size x side x (2 x price - bid - ask): volume-weighted effective spread numerator",
    ),
    # Displayed size (D)
    Field("bid_depth_sum", SUM, INT, "depth_trades", "Sum of displayed bid sizes at trades"),
    Field("ask_depth_sum", SUM, INT, "depth_trades", "Sum of displayed ask sizes at trades"),
    Field(
        "depth_at",
        LAST,
        INT,
        "depth_trades",
        "Assignment time of the last trade with usable displayed sizes",
    ),
    Field("last_bid_size", LAST, INT, "depth_trades", "Last displayed bid size"),
    Field("last_ask_size", LAST, INT, "depth_trades", "Last displayed ask size"),
    Field("imbalance_sum", SUM, FLOAT, "depth_trades", "Sum of bid / (bid + ask) displayed size"),
    Field(
        "imbalance_volume_sum", SUM, FLOAT, "depth_trades", "Sum of size x bid / (bid + ask) size"
    ),
    Field("imbalance_last", LAST, FLOAT, "depth_trades", "Last bid / (bid + ask) displayed size"),
    Field(
        "tilt_sum",
        SUM,
        FLOAT,
        "depth_trades",
        "Sum of weighted-midpoint minus midpoint, (ask - bid) x imbalance / 2",
    ),
    Field("buy_take_sum", SUM, FLOAT, "depth_trades", "Sum of buy size / displayed ask size"),
    Field("sell_take_sum", SUM, FLOAT, "depth_trades", "Sum of sell size / displayed bid size"),
    Field(
        "alignment_sum",
        SUM,
        FLOAT,
        "known_depth_volume",
        "Sum of size x side x (bid - ask) / (bid + ask) displayed size",
    ),
    # Displayed order counts (C)
    Field(
        "order_bid_size_sum",
        SUM,
        INT,
        "order_trades",
        "Sum of displayed bid sizes at trades with usable order counts",
    ),
    Field(
        "order_ask_size_sum",
        SUM,
        INT,
        "order_trades",
        "Sum of displayed ask sizes at trades with usable order counts",
    ),
    Field("bid_orders_sum", SUM, INT, "order_trades", "Sum of displayed bid order counts"),
    Field("ask_orders_sum", SUM, INT, "order_trades", "Sum of displayed ask order counts"),
    Field(
        "order_imbalance_sum", SUM, FLOAT, "order_trades", "Sum of bid / (bid + ask) order counts"
    ),
    # Quality
    Field("bad_book_trades", SUM, INT, "", "Trades flagged F_MAYBE_BAD_BOOK by Databento"),
    Field(
        "late_trades",
        SUM,
        INT,
        "",
        "Trades received after their event-time slot closed, so counted in a later slot",
    ),
)
BY_NAME = {f.name: f for f in FIELDS}
BIG = np.iinfo(np.int64).max


def empty_metrics(n: int) -> dict[str, np.ndarray]:
    return {f.name: np.zeros(n, f.dtype) for f in FIELDS}


def second_metrics(trades: Trades, agg: Aggregation) -> dict[str, np.ndarray]:
    """Metrics for every slot of `agg.bars`, from the trades `aggregate` assigned to them."""
    bars = agg.bars
    out = empty_metrics(len(bars))
    if not len(agg.order):
        return out
    t = trades.take(agg.order)
    row = np.searchsorted(bars.end, agg.slot_end)
    starts = np.flatnonzero(np.r_[True, row[1:] != row[:-1]])
    rows = row[starts]
    n = len(t)
    index = np.arange(n)
    p, q, side = t.price, t.size, t.side.astype(np.int64)

    quote = (t.bid != UNDEF_PRICE) & (t.ask != UNDEF_PRICE)
    quote[quote] &= t.bid[quote] <= t.ask[quote]
    bid = np.where(quote, t.bid, 0)
    ask = np.where(quote, t.ask, 0)
    bsz, asz = t.bid_size, t.ask_size
    depth = quote & (bsz >= 0) & (asz >= 0) & (bsz + asz > 0)
    orders = depth & (t.bid_count >= 0) & (t.ask_count >= 0) & (t.bid_count + t.ask_count > 0)
    known = side != 0

    def put(name: str, values: np.ndarray, ufunc=np.add) -> None:
        out[name][rows] = ufunc.reduceat(values, starts)

    def first(name: str, values: np.ndarray, mask: np.ndarray) -> None:
        i = np.minimum.reduceat(np.where(mask, index, BIG), starts)
        ok = i < BIG
        out[name][rows[ok]] = values[i[ok]]

    def last(name: str, values: np.ndarray, mask: np.ndarray) -> None:
        i = np.maximum.reduceat(np.where(mask, index, -1), starts)
        ok = i >= 0
        out[name][rows[ok]] = values[i[ok]]

    put("buy_trades", (side > 0).astype(np.int64))
    put("sell_trades", (side < 0).astype(np.int64))
    put("size_sq", q * q)
    put("max_size", q, np.maximum)
    first("first_at", agg.at, np.ones(n, bool))
    last("last_at", agg.at, np.ones(n, bool))

    same = np.r_[False, row[1:] == row[:-1]]  # the previous trade is in the same slot
    dp = np.r_[0, np.diff(p)]
    put("path_abs", np.where(same, np.abs(dp), 0))
    put("upticks", (same & (dp > 0)).astype(np.int64))
    put("downticks", (same & (dp < 0)).astype(np.int64))
    pair = same & known & np.r_[False, known[:-1]]
    put("side_pairs", pair.astype(np.int64))
    put("side_switches", (pair & (side != np.r_[0, side[:-1]])).astype(np.int64))
    first("first_side", side, np.ones(n, bool))  # windows bridge pairs across seconds with these
    last("last_side", side, np.ones(n, bool))

    put("sweep_buy_volume", np.where(quote & (side > 0) & (p > ask), q, 0))
    put("sweep_sell_volume", np.where(quote & (side < 0) & (p < bid), q, 0))

    put("quote_trades", quote.astype(np.int64))
    put("quote_volume", np.where(quote, q, 0))
    put("known_quote_volume", np.where(quote & known, q, 0))
    put("depth_trades", depth.astype(np.int64))
    put("depth_volume", np.where(depth, q, 0))
    put("known_depth_volume", np.where(depth & known, q, 0))
    put("order_trades", orders.astype(np.int64))

    spread = ask - bid
    mid2 = ask + bid
    put("spread_sum", spread)
    put("spread_max", np.where(quote, spread, 0), np.maximum)
    first("mid2_open", mid2, quote)
    put("mid2_high", np.where(quote, mid2, -BIG), np.maximum)
    put("mid2_low", np.where(quote, mid2, BIG), np.minimum)
    last("last_bid", bid, quote)
    last("last_ask", ask, quote)
    last("quote_at", agg.at, quote)
    put("eff_spread_sum", np.where(quote & known, q * side * (2 * p - bid - ask), 0))

    total = np.where(depth, bsz + asz, 1)
    share = np.where(depth, bsz / total, 0.0)  # bid / (bid + ask)
    imbalance = np.where(depth, (bsz - asz) / total, 0.0)
    put("bid_depth_sum", np.where(depth, bsz, 0))
    put("ask_depth_sum", np.where(depth, asz, 0))
    last("depth_at", agg.at, depth)
    last("last_bid_size", bsz, depth)
    last("last_ask_size", asz, depth)
    put("imbalance_sum", share)
    put("imbalance_volume_sum", q * share)
    last("imbalance_last", share, depth)
    put("tilt_sum", np.where(depth, spread * imbalance / 2, 0.0))
    take_buy = depth & (side > 0) & (asz > 0)
    take_sell = depth & (side < 0) & (bsz > 0)
    put("buy_take_sum", np.where(take_buy, q / np.where(take_buy, asz, 1), 0.0))
    put("sell_take_sum", np.where(take_sell, q / np.where(take_sell, bsz, 1), 0.0))
    put("alignment_sum", np.where(depth & known, q * side * imbalance, 0.0))

    nb, na = t.bid_count, t.ask_count
    put("order_bid_size_sum", np.where(orders, bsz, 0))  # same trades as the order counts
    put("order_ask_size_sum", np.where(orders, asz, 0))
    put("bid_orders_sum", np.where(orders, nb, 0))
    put("ask_orders_sum", np.where(orders, na, 0))
    put("order_imbalance_sum", np.where(orders, nb / np.where(orders, nb + na, 1), 0.0))

    put("bad_book_trades", ((t.flags & F_MAYBE_BAD_BOOK) > 0).astype(np.int64))
    step = bars.step  # late: assigned to a later slot than its event time's
    put("late_trades", (agg.at // step > t.ts_event // step).astype(np.int64))
    for f in FIELDS:  # sentinels of slots without a valid observation back to zero
        if f.kind in (MAX, MIN) and f.dtype is INT:
            v = out[f.name]
            v[(v == BIG) | (v == -BIG)] = 0
    return out
