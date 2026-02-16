# Market Write (NodeJS service)

Multi-timeframe financial data pipeline for futures and crypto. Ingests live trades data, calculates metrics and indicators such as RSI/CVD/VWAP, aggregates raw trade data into candles time buckets.

Aggregates raw data into 1-minute bars, calculated and written every second using rolling window sampling. Every 1-minute bar is a full legitimate 1-minute bar with a high/low value and total volume caculated over the past 60 seconds. But each candle is written every second, so every second in time has its own candle with its own close value. Instead of a new candle waiting for the previous one to close, a new candle is started every second, and an old canlde is written every second.

TODO: Aggregate 1-minute data into higher timeframes such as 15-minutes, 60-minutes, and even 1-day, but calculate and update every minute also using rolling window sampling.

TODO: Indicators must be calculated per each candle, sampling candles of the same second_index (for minute candles) and same minute_index (for higher timeframes).

## Core Innovation: Rolling-Window Sampling

Standard platforms calculate a 60-minute candle once per hour. This platform calculates it **every minute** using a sliding window over the previous 60 minutes. This means:

- A 60m table has one row per minute (not per hour), each representing the trailing 60-minute window
- `minute_index` cycles 0-59, identifying which phase of the timeframe the row represents
- Indicators like RSI are calculated per minute_index independently (60 separate RSI calculators for a 60m timeframe)
- Backtesting can evaluate any timeframe at any minute, not just at period boundaries

**Example**: To get RSI-14 on 60m data at 10:31 (minute_index=31), query 14 rows where `minute_index=31` ordered by timestamp DESC. Each row is 60 minutes apart (9:31, 8:31, 7:31...).

```sql
SELECT close FROM candles_60m_1m
WHERE symbol = 'ES' AND minute_index = 31 -- IMPORTANT: when querying from higher-timeframe tables, minute_index should always be set!
ORDER BY ts DESC LIMIT 14;
```

**Example**: To get RSI-14 on 1m data at 10:31:47 (second_index:47), query 14 rows where `second_index:47` ordered by timestamp DESC. Each row is 60 seconds apart (10:30:47, 10:29:47, 10:28:47...).

```sql
SELECT close FROM candles_1m_1s
WHERE symbol = 'ES' AND second_index = 47 -- IMPORTANT: when querying from 1m_1s table, second_index should always be set!
ORDER BY ts DESC LIMIT 14;
```

Same indicator calculation as in a typical system except here the current candle is always fully closed. A new candle is always written every second (for candles_1m_1s) and every minute (for higher timeframes).

## Tech Stack

- **Runtime**: Node.js / TypeScript (strict mode)
- **API**: Express
- **Database**: PostgreSQL via `pg` (raw SQL, no ORM in production)
- **Data feed**: Databento Raw TCP API (TBBO schema)
- **Deployment**: Railway

## Database Conventions

- Table names: `candles_{interval}m` (e.g., `candles_60m`). One table per timeframe, all sharing the same schema.
- Primary key: `(symbol, ts)`. All symbols share one table, differentiated by `symbol` column.
- Critical index: `(symbol, minute_index, ts DESC)` for indicator lookups.
- `minute_index` cycles 0 to N-1 for an N-minute timeframe.
- Column names: snake_case in DB, camelCase in TypeScript.
- Indicators stored in same row as OHLCV (no JOINs needed).

## Project Structure

```
src/
  index.ts                  # Express server entry point
  api/                      # REST endpoints (health, tables, historical candles)
  lib/
    db.ts                   # PostgreSQL connection pool
    candles.ts              # Candle querying + timeframe selection
    trade/                  # TBBO processing (aggregation, side detection, thresholds)
    metrics/                # 10 order flow metric calculators (VD, CVD, EVR, SMP, etc.)
  stream/                   # Databento live TCP client + aggregator
scripts/                    # Data import and analysis tools
docs/                       # Architecture docs, examples, research notes
```

## Documentation

See [docs/index.md](docs/index.md) for the full map. Key sections:

- **data-storage/**: Database schema, partitioning, optimization, Databento ingestion
- **data-indicators/**: Indicator calculation with rolling windows, RSI reference implementation, pivot detection research
- **data-backtesting/**: Backtesting architecture, order flow patterns, optimization
