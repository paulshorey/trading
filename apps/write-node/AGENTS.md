# write-node

Canonical futures timeseries write pipeline.

## Current scope

This app ingests TBBO trade data and maintains two canonical rolling timeseries
tables:

- **`candles_1m_1s`**: rolling 1-minute candles written at 1-second resolution
- **`candles_1h_1m`**: rolling 1-hour candles written at 1-minute resolution

`candles_1m_1s` is built directly from TBBO trades.

`candles_1h_1m` is built from the **minute-boundary subset** of
`candles_1m_1s`, not directly from raw trades.

Each `candles_1m_1s` row is the trailing 60-second window for a ticker at that
second:

- input resolution: individual TBBO trades
- output timeframe: 1 minute
- output write cadence: 1 second
- short no-trade gaps are forward-filled as zero-volume seconds
- extended open-market inactivity resets the rolling warmup instead of stitching distant seconds together
- scheduled closures from the configured session calendar are treated as paused time so rolling VWAP/CVD continuity carries across closes and reopens

Each `candles_1h_1m` row is the trailing 60-minute window for a ticker at that
minute:

- input resolution: canonical 1-minute rows
- output timeframe: 1 hour
- output write cadence: 1 minute
- the source rows are the minute-boundary subset produced by the shared 1m engine

The app has two ingest modes:

- `src/stream/tbbo-stream.ts` for live Databento TCP data
- `scripts/tbbo-1m-1s.ts` for historical TBBO -> `candles_1m_1s`
- `scripts/candles-1h-1m.ts` for historical `candles_1m_1s` -> `candles_1h_1m`

Both paths must stay aligned and should share aggregation logic whenever
possible.

## Project goal

`write-node` is responsible for producing and maintaining **canonical
financial timeseries data** from historical and live market data.

This data is intended to be a durable source of truth for downstream apps.
The writer pipeline should be deterministic, explainable, and conservative
about schema and logic changes.

## Timeframe model

Do not redesign this app around traditional end-of-period-only candles.

The intended write model is:

- `1m` candles written at `1s` resolution
- `1h` candles written at `1m` resolution

The saved resolution is therefore finer than the candle timeframe, because each
row represents a rolling window that is recalculated on a higher-frequency
schedule.

## Runtime architecture

```
src/index.ts
  -> src/stream/tbbo-stream.ts
  -> src/stream/tbbo-1m-aggregator.ts
  -> src/stream/candles-1h-1m-aggregator.ts
  -> src/lib/trade/*
  -> TimescaleDB candles_1m_1s
  -> TimescaleDB candles_1h_1m
```

Key rules:

- keep the runtime focused on writing data, not serving an API
- only `/health` exists; there is no `src/api/`
- use `TIMESCALE_DB_URL` through `@lib/db-timescale`
- keep front-month stitching and rolling-window aggregation deterministic
- prefer shared library code over duplicated live/batch logic
- treat written tables as source-of-truth data, not disposable intermediate output
- define market-session windows in local exchange time with an IANA time zone; do not hardcode fixed UTC close/reopen hours
- `1h@1m` must be derived from minute-boundary `1m@1s` rows
- do not derive `1h@1m` directly from raw trades
- do not compute `1h` every second unless the product intentionally changes to `1h@1s`
- keep column contracts aligned with `@lib/db-timescale` migrations, schema snapshot, and generated types
- `price_pct` is stored in basis points, not percent
- `sum_price_volume` is the stored VWAP accumulator; there is no canonical per-row `vwap` column
- do not create or alter Timescale tables manually; change `@lib/db-timescale/migrations`
- fresh empty DB: run `db:migrate`, not `db:migrate:baseline`
- existing pre-migration DB with baseline schema already present: run `db:migrate:baseline` once, then `db:migrate`
- after DB contract changes, run `pnpm --filter @lib/db-timescale db:migrate-and-verify`
- if a migration must change populated data, the migration SQL must backfill or convert existing rows explicitly

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
    candles-1h-1m-aggregator.ts
scripts/
  tbbo-1m-1s.ts
  candles-1h-1m.ts
docs/
  index.md
```

## Relationship to future apps

`write-node` should stop at **canonical timeseries writing**.

A downstream app, `backtest-python`, will consume this historical and live
timeseries data to:

- build multiple timeframes and lookback windows
- calculate indicators and derived features such as RSI, CVD, volume, and volatility
- write those model-ready parameters into separate downstream tables
- support both model training on historical data and inference on live data

That downstream feature-engineering and ML workflow should not be folded back
into `write-node`.

## Documentation

Only keep docs that match the current writer pipeline and near-term roadmap.
Remove or rewrite anything that still references:

- old `ohlcv_*` schemas
- `minute_index` / `second_index` query models
- nonexistent API layers
- unrelated backtesting experiments inside this app
- outdated roadmap assumptions beyond `1m@1s` and `1h@1m`
