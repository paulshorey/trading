# canonical candles schema

## Current source of truth

This app currently writes two canonical rolling tables:

- `candles_1m_1s`
- `candles_1h_1m`

The lower table is canonical trade-derived data.

The higher table is still canonical app-owned timeseries data, but it is
derived from the lower canonical table rather than directly from raw trades.

Each row represents:

### `candles_1m_1s`

- one ticker
- one second in time
- the fully aggregated trailing 60-second window ending at that second

That table stores **1-minute candles sampled every second**.

### `candles_1h_1m`

- one ticker
- one minute in time
- the fully aggregated trailing 60-minute window ending at that minute

That table stores **1-hour candles sampled every minute**.

## Write paths

Both ingest modes build `candles_1m_1s`:

- `src/stream/tbbo-stream.ts` -> live ingest
- `scripts/tbbo-1m-1s.ts` -> historical backfill

Both feed the same shared rolling-window engine in `src/lib/trade/rolling-window.ts`.

`candles_1h_1m` is then derived from the minute-boundary subset of
`candles_1m_1s`:

- `src/stream/candles-1h-1m-aggregator.ts` -> live derivation
- `scripts/candles-1h-1m.ts` -> historical rebuild

Those paths share `src/lib/trade/rolling-candle-window.ts`.

## Table columns

| Column             | Description |
| ------------------ | ----------- |
| `time`             | second-level timestamp for the rolling row |
| `ticker`           | stitched front-month ticker, such as `ES` |
| `symbol`           | most recent raw contract symbol contributing to the row |
| `open/high/low/close` | rolling 60-second price OHLC |
| `volume`           | total rolling volume |
| `ask_volume`       | rolling aggressive buy volume |
| `bid_volume`       | rolling aggressive sell volume |
| `cvd_open/high/low/close` | rolling CVD OHLC for the same 60-second window |
| `vd`               | `ask_volume - bid_volume` |
| `vd_ratio`         | normalized aggressor imbalance |
| `book_imbalance`   | normalized passive depth imbalance |
| `price_pct`        | percentage price change over the rolling window |
| `divergence`       | simple price-vs-delta disagreement signal |
| `trades`           | trade count in the rolling window |
| `max_trade_size`   | largest trade in the rolling window |
| `big_trades`       | count of trades above the configured threshold |
| `big_volume`       | volume from those large trades |
| `sum_bid_depth`    | additive raw accumulator for later aggregation |
| `sum_ask_depth`    | additive raw accumulator for later aggregation |
| `sum_price_volume` | additive raw accumulator for VWAP-style calculations |
| `unknown_volume`   | volume whose side could not be classified |

## Why raw accumulators are stored

The table stores both derived values and additive building blocks.

That keeps the current 1-minute-at-1-second pipeline simple while preserving
the inputs needed for future higher-timeframe writers, where a larger timeframe
will still be recalculated on a finer saved resolution.

## Future higher-timeframe model

This app is **not** moving toward traditional closed-bar aggregates only.

`candles_1h_1m` follows the same rolling-window pattern as `candles_1m_1s`:

- candle timeframe and saved resolution are distinct
- each row is a trailing rolling window
- both historical and live maintenance share the same aggregation logic
- the higher layer is derived from canonical lower-layer rows, not raw trade replay

## Downstream usage

These tables are meant to be canonical source-of-truth timeseries data for
downstream consumers.

A future `market-analyze-python` app is expected to read from these canonical
timeseries tables and write separate derived-feature tables for ML training and
inference workloads.

## SQL

See:

- `1s-base-1m-aggregate.sql` for `candles_1m_1s`
- `1m-base-1h-aggregate.sql` for `candles_1h_1m`
