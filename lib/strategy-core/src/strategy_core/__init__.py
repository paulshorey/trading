"""Shared market data, feature, strategy, and execution logic for backtests and live sessions."""

from .engine import ChunkResult, Engine, MarketChunk
from .execution import ExecutionConfig, Simulator
from .features import FeatureConfig, FeatureFrame, FeaturePipeline, FeatureSpec, Unit
from .market import PRODUCTS, Product, SessionCalendar, Trades
from .strategies import BiasPullback, Bracket, Strategy, make_strategy

__all__ = [
    "PRODUCTS",
    "BiasPullback",
    "Bracket",
    "ChunkResult",
    "Engine",
    "ExecutionConfig",
    "FeatureConfig",
    "FeatureFrame",
    "FeaturePipeline",
    "FeatureSpec",
    "MarketChunk",
    "Product",
    "SessionCalendar",
    "Simulator",
    "Strategy",
    "Trades",
    "Unit",
    "make_strategy",
]
