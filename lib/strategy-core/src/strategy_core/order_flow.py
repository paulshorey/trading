"""Ports of write-node's pure metrics. Require real trades/quotes, never OHLCV proxies."""
from math import isfinite


def infer_side(price: float, bid: float, ask: float) -> str | None:
    """Midpoint quote test (not the complete Lee–Ready algorithm)."""
    if not all(isfinite(x) for x in (price, bid, ask)) or bid <= 0 or ask < bid:
        return None
    midpoint = (bid + ask) / 2
    return "buy" if price > midpoint else "sell" if price < midpoint else None


def book_imbalance(bid_depth: float, ask_depth: float) -> float | None:
    if not all(isfinite(x) and x >= 0 for x in (bid_depth, ask_depth)):
        raise ValueError("Depth must be finite and nonnegative")
    total = bid_depth + ask_depth
    return (bid_depth - ask_depth) / total if total else None


def divergence(price_bps: float, delta_ratio: float, min_price_bps: float = 0.5, min_delta_ratio: float = 0.1) -> int:
    """Experimental price/delta disagreement flag; no claim of predictive value."""
    if not all(isfinite(x) for x in (price_bps, delta_ratio, min_price_bps, min_delta_ratio)):
        raise ValueError("Inputs must be finite")
    if abs(delta_ratio) > 1 or min_price_bps < 0 or not 0 <= min_delta_ratio <= 1:
        raise ValueError("Invalid thresholds or delta ratio")
    if abs(price_bps) < min_price_bps or abs(delta_ratio) < min_delta_ratio:
        return 0
    return 1 if price_bps > 0 > delta_ratio else -1 if price_bps < 0 < delta_ratio else 0
