"""Causal indicators: update once per completed observed bar, with explicit warmup."""
from collections import deque
from typing import Protocol
from .models import Bar


class Strategy(Protocol):
    def on_bar(self, bar: Bar) -> int | None:
        """Return desired direction (-1, 0, 1), or None while warming up."""


class MovingAverageCross:
    def __init__(self, fast: int, slow: int, allow_short: bool):
        self.fast, self.slow, self.allow_short = fast, slow, allow_short
        self.closes: deque[float] = deque(maxlen=slow)

    def on_bar(self, bar: Bar) -> int | None:
        self.closes.append(bar.close)
        if len(self.closes) < self.slow:
            return None
        spread = sum(list(self.closes)[-self.fast:]) / self.fast - sum(self.closes) / self.slow
        return 1 if spread > 0 else -1 if spread < 0 and self.allow_short else 0


class RsiReversion:
    """Wilder RSI, entering below 30 and exiting above 50; symmetric shorts if enabled."""
    def __init__(self, period: int, allow_short: bool):
        self.period, self.allow_short = period, allow_short
        self.previous: float | None = None
        self.count = 0
        self.gain = self.loss = 0.0
        self.target = 0

    def on_bar(self, bar: Bar) -> int | None:
        previous, self.previous = self.previous, bar.close
        if previous is None:
            return None
        change = bar.close - previous
        gain, loss = max(change, 0), max(-change, 0)
        self.count += 1
        if self.count <= self.period:
            self.gain += gain / self.period
            self.loss += loss / self.period
        else:
            self.gain = (self.gain * (self.period - 1) + gain) / self.period
            self.loss = (self.loss * (self.period - 1) + loss) / self.period
        if self.count < self.period:
            return None
        rsi = 50 if self.gain == self.loss == 0 else 100 if self.loss == 0 else 100 - 100 / (1 + self.gain / self.loss)
        if self.target == 1 and rsi >= 50 or self.target == -1 and rsi <= 50:
            self.target = 0
        elif self.target == 0:
            self.target = 1 if rsi < 30 else -1 if rsi > 70 and self.allow_short else 0
        return self.target
