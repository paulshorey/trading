# market-write-node

Canonical futures timeseries write pipeline.

## Current scope

This app ingests TBBO trade data and writes **rolling 1-minute candles at
1-second resolution** to `candles_1m_1s`.

Each stored row is the trailing 60-second window for a ticker at that second:

- input resolution: individual TBBO trades
- output timeframe: 1 minute
- output write cadence: 1 second

The app has two ingest modes:

- `src/stream/tbbo-stream.ts` for live Databento TCP data
- `scripts/tbbo-1m-1s.ts` for historical JSONL backfills

Both paths must stay aligned and should share aggregation logic whenever
possible.

## Project goal

`market-write-node` is responsible for producing and maintaining **canonical
financial timeseries data** from historical and live market data.

This data is intended to be a durable source of truth for downstream apps.
The writer pipeline should be deterministic, explainable, and conservative
about schema and logic changes.

## Timeframe model

Do not redesign this app around traditional end-of-period-only candles.

The intended write model is:

- `1m` candles written at `1s` resolution
- later: `1h` candles written at `1m` resolution

The saved resolution is therefore finer than the candle timeframe, because each
row represents a rolling window that is recalculated on a higher-frequency
schedule.

## Runtime architecture

```
src/index.ts
  -> src/stream/tbbo-stream.ts
  -> src/stream/tbbo-1m-aggregator.ts
  -> src/lib/trade/*
  -> TimescaleDB candles_1m_1s
```

Key rules:

- keep the runtime focused on writing data, not serving an API
- only `/health` exists; there is no `src/api/`
- use `TIMESCALE_URL` through `@lib/db-timescale`
- keep front-month stitching and rolling-window aggregation deterministic
- prefer shared library code over duplicated live/batch logic
- treat written tables as source-of-truth data, not disposable intermediate output
- prefer adding new write layers only when they are part of the canonical timeseries plan

## Source layout

```
src/
  index.ts
  lib/
    db.ts
    metrics/
    trade/
  stream/
    tbbo-stream.ts
    tbbo-1m-aggregator.ts
scripts/
  tbbo-1m-1s.ts
docs/
  index.md
```

## Relationship to future apps

`market-write-node` should stop at **canonical timeseries writing**.

A future app, `market-analyze-python`, will consume this historical and live
timeseries data to:

- build multiple timeframes and lookback windows
- calculate indicators and derived features such as RSI, CVD, volume, and volatility
- write those model-ready parameters into separate downstream tables
- support both model training on historical data and inference on live data

That downstream feature-engineering and ML workflow should not be folded back
into `market-write-node`.

## Documentation

Only keep docs that match the current writer pipeline and near-term roadmap.
Remove or rewrite anything that still references:

- old `ohlcv_*` schemas
- `minute_index` / `second_index` query models
- nonexistent API layers
- unrelated backtesting experiments inside this app
- outdated roadmap assumptions beyond `1m@1s` and `1h@1m`
