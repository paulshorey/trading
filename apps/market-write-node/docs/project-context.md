# Project context

## Purpose of `market-write-node`

`market-write-node` is the canonical write pipeline for detailed market
timeseries data.

Its job is to ingest historical and live market data, aggregate it, calculate
the core per-row values needed for storage, and persist a stable source of
truth for downstream systems.

## What this app should produce

Current:

- `1m` candles written at `1s` resolution

Planned next:

- `1h` candles written at `1m` resolution

Not planned here:

- model training
- model inference
- broad indicator research notebooks or experimental backtesting logic

## Core design idea

The saved cadence is finer than the candle timeframe.

Examples:

- a 1-minute candle can be recalculated and saved every second
- a 1-hour candle can be recalculated and saved every minute

So each stored row represents a **rolling window**, not just a traditional bar
that appears once after the timeframe closes.

## Why this data matters

The timeseries written here is intended to be durable source-of-truth data.

Downstream apps should rely on these tables rather than re-implementing the raw
trade aggregation rules independently.

That means changes in this app should prioritize:

- determinism
- consistency between historical and live ingest
- clear schema semantics
- minimal duplicated logic

## Downstream boundary

A future app, `market-analyze-python`, will sit downstream from this writer.

That app will consume the canonical historical and live timeseries to:

- build multiple timeframes
- apply multiple lookback periods
- calculate indicators and features such as RSI, CVD, volume, and volatility
- store model-ready parameters in separate tables for ML training and inference

`market-write-node` should remain focused on canonical timeseries writing, not
full feature engineering or ML workflows.
