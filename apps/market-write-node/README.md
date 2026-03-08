# market-write-node

Canonical futures timeseries writer.

This app maintains:

- `candles_1m_1s`: rolling 1-minute candles written every second from TBBO trades
- `candles_1h_1m`: rolling 1-hour candles written every minute from the
  minute-boundary subset of `candles_1m_1s`

## What this app does

`market-write-node` is the source-of-truth write pipeline for canonical market
timeseries data.

It should:

- ingest historical and live TBBO data
- stitch front-month contracts
- classify aggressive trade side
- compute canonical 1-minute rolling rows
- derive canonical 1-hour rolling rows from canonical 1-minute rows

It should not own downstream feature engineering or ML workflows.

## Database setup

This app uses the `TIMESCALE_URL` database owned by `@lib/db-timescale`.

### 1. Ensure Timescale/Postgres is available

Set:

```bash
export TIMESCALE_URL="postgres://..."
```

The target database must support the TimescaleDB APIs used by the migrations,
including hypertables and compression policies.

### 2. Apply the DB migration

From the repo root:

```bash
pnpm --filter @lib/db-timescale db:migrate
```

This must create/update:

- `candles_1m_1s`
- `candles_1h_1m`

### 3. Refresh schema snapshot and generated DB artifacts

After the migration has been applied to the target database, refresh the DB
contract artifacts:

```bash
pnpm --filter @lib/db-timescale db:schema:snapshot
pnpm --filter @lib/db-timescale db:types:generate
```

Or run both after migration:

```bash
pnpm --filter @lib/db-timescale db:sync
```

## Historical rebuild flow

### TBBO -> canonical 1m@1s

```bash
pnpm --filter market-write-node historical:tbbo "/path/to/file1.json" "/path/to/file2.json"
```

### Canonical 1m@1s -> canonical 1h@1m

```bash
pnpm --filter market-write-node historical:1h1m --truncate
```

Notes:

- `historical:1h1m` reads only minute-boundary rows from `candles_1m_1s`
- `--truncate` is recommended for a full deterministic rebuild
- without `--truncate`, the script upserts into `candles_1h_1m`

## Live flow

Start the live writer:

```bash
pnpm --filter market-write-node start
```

Required env vars:

- `TIMESCALE_URL`
- `DATABENTO_API_KEY`
- `DATABENTO_DATASET`
- `DATABENTO_SYMBOLS`
- `DATABENTO_STYPE`

Live behavior:

1. raw TBBO trades -> `candles_1m_1s`
2. successful 1m writes at minute boundaries feed the hourly aggregator
3. minute-boundary rows -> `candles_1h_1m`

On startup, the hourly writer hydrates itself from the most recent
minute-boundary `candles_1m_1s` rows so it does not need a fresh 60-minute
warmup.

## Developer rules

- `1h@1m` must be derived from canonical `1m@1s` rows, not raw trades
- use only minute-boundary rows from `candles_1m_1s` as 1-hour source inputs
- do not average lower-timeframe ratios when building higher-timeframe rows
- recompute derived metrics from aggregated raw fields
- keep historical and live behavior aligned through shared library code

## Validation

```bash
pnpm --filter market-write-node build
pnpm build
```
