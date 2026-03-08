# Live Streaming Data Processing

Real-time TBBO trade data from Databento is aggregated into rolling
1-minute candles at 1-second resolution and written to `candles_1m_1s`.
Each row represents the trailing 60-second window for a ticker.

This live path is part of the canonical source-of-truth writer pipeline.
It should remain aligned with historical ingest and should not absorb
downstream feature-engineering or ML-specific logic.

## How It Works

- **`tbbo-stream.ts`** connects to Databento's Raw TCP API, authenticates, and subscribes to TBBO (Top of Book on Trade) data for configured symbols
  - Parses newline-delimited JSON messages from the socket
  - Builds an instrument_id-to-symbol lookup from symbol mapping messages (rtype=22)
  - Converts trade messages (action="T") into `TbboRecord` objects
  - Skips spread contracts (symbols containing "-") and trades during market closed hours
  - Passes each valid trade to the aggregator

- **`tbbo-1m-aggregator.ts`** is the live wrapper around the shared rolling-window engine
  - rejects late trades
  - classifies trade side
  - converts records into normalized trade input
  - finalizes stale seconds on a timer
  - writes pending rows to `candles_1m_1s`
  - loads latest `cvd_close` values on startup for continuity

- **`src/lib/trade/rolling-window.ts`** owns the shared rolling-window logic used by both live and historical ingest
  - front-month selection
  - per-second aggregation
  - 60-second warmup handling
  - trailing-window candle creation
  - pending candle queue management

## Configuration

Environment variables (all required):

| Variable            | Example          | Description                           |
| ------------------- | ---------------- | ------------------------------------- |
| `DATABENTO_API_KEY` | `db-abc...xyz`   | Databento API key                     |
| `DATABENTO_DATASET` | `GLBX.MDP3`      | Exchange dataset (CME Globex)         |
| `DATABENTO_SYMBOLS` | `ES.FUT,NQ.FUT`  | Comma-separated symbols               |
| `DATABENTO_STYPE`   | `parent`         | Symbol type: `parent` or `raw_symbol` |
| `TIMESCALE_URL`     | `postgres://...` | TimescaleDB connection                |

## Shared Libraries

The live path should stay intentionally thin. Shared libraries must carry the
behavior that batch and live ingest have in common:

- **`src/lib/trade/`** -- rolling window engine, candle aggregation, CVD tracking, front-month selection, trade side detection, DB writing, timestamp bucketing
- **`src/lib/metrics/`** -- metric helpers used during aggregation / persistence

Stream-specific code should only handle:

- TCP connection lifecycle
- Databento protocol details
- JSON parsing and symbol mapping
- market-hours gating
- retry / timer orchestration

## Roadmap

The current live writer supports `1m` candles at `1s` resolution.

The next planned write layer is `1h` candles at `1m` resolution.

## CVD Continuity

On startup, the aggregator queries `candles_1m_1s` for the latest `cvd_close` per ticker. This ensures CVD is continuous across server restarts. If the table is empty or unreachable, CVD starts from 0.
