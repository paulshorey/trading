"""Shared market data, feature, strategy, and execution logic for backtests and live sessions."""

from .engine import ChunkResult, Engine, MarketChunk
from .execution import ExecutionConfig, Simulator
from .features import FeatureConfig, FeatureFrame, FeatureSpec, Unit
from .market import PRODUCTS, Product, SessionCalendar, Trades
from .pipeline import Pipeline, StageFeatures
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
    "FeatureSpec",
    "MarketChunk",
    "Pipeline",
    "Product",
    "SessionCalendar",
    "Simulator",
    "StageFeatures",
    "Strategy",
    "Trades",
    "Unit",
    "make_strategy",
]
