from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class Bar:
    """One observed minute. time is UTC epoch seconds at OPEN; known at time + 60."""
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def __post_init__(self):
        values = (self.open, self.high, self.low, self.close, self.volume)
        if type(self.time) is not int or self.time % 60:
            raise ValueError("Expected minute-aligned UTC epoch seconds")
        if not all(isfinite(x) for x in values):
            raise ValueError("Non-finite OHLCV")
        if self.volume < 0 or self.low > min(self.open, self.close) or self.high < max(self.open, self.close) or self.high < self.low:
            raise ValueError("Invalid OHLCV bounds")


@dataclass(frozen=True)
class Instrument:
    symbol: str
    asset: str
    multiplier: float = 1.0
    tick_size: float = 0.01

    def __post_init__(self):
        if self.asset not in ("crypto", "future"):
            raise ValueError("Supported assets: crypto, future")
        if not self.symbol or not all(isfinite(x) and x > 0 for x in (self.multiplier, self.tick_size)):
            raise ValueError("Invalid instrument metadata")
