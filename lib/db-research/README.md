# Research storage

Status: a local PostgreSQL 18 database, `trading`, managed by the numbered migrations
in [`migrations/`](migrations/). Applied: `0001_foundation` (schemas `market`,
`research`, `ml`, and the Databento file registry `market.source_file`). Tables for
contracts, one-second rows, metrics, runs, and ML rows come next. The earlier
full-schema proposal ([`schema.sql`](schema.sql) and its queries) is reference only;
its clock-based `phase_index` is superseded by trading-time ordinals (below).

## Local setup

The database runs on the Homebrew `postgresql@18` service at `127.0.0.1:5432` with
local trust authentication (no password). The app reads `TRADING_DATABASE_URL`,
defaulting to `postgresql://trading@127.0.0.1:5432/trading`.

```sh
brew services start postgresql@18
psql -d postgres -c "CREATE ROLE trading LOGIN CREATEDB"
psql -d postgres -c "CREATE DATABASE trading OWNER trading"
uv run research db migrate      # apply pending migrations
uv run research db status       # applied, pending, or changed files
uv run research db register     # record downloaded Databento files
```

Server settings for bulk loads were applied with `ALTER SYSTEM` (`postgresql.auto.conf`):
`shared_buffers` 4GB, `effective_cache_size` 16GB, `maintenance_work_mem` 2GB,
`work_mem` 64MB, `max_wal_size` 16GB, `checkpoint_timeout` 15min, zstd WAL
compression, lz4 TOAST compression, and SSD page costs. Tests create and drop
throwaway `trading_test_*` databases; CI runs them against a `postgres:18` service.

## Migrations

Add `NNNN_short_name.sql` with the next number. `research db migrate` applies each
pending file once, in order, in a transaction, and records its SHA-256 in
`meta.schema_migration`. Never edit an applied file; the runner refuses to continue
when one changes. Add a new migration instead.

## Design guidance for the next tables

**One-second and one-minute rows** (for example `market.bar_1s` and `market.bar_1m`):
one row for every scheduled-open slot per contract, including slots without trades or
with missing data, so every sliding window is exactly 60 consecutive rows (decided
November 1, 2026). Closures have no rows.

The defining column is the row's **index counter**, `slot_ordinal` (`bigint`): the
number of scheduled-open slots of that step since the product calendar's fixed origin
(`SessionCalendar.slot_ordinals`, origin `PHASE_ORIGIN` in
`apps/backtest-runner/src/backtest_runner/calendars.py`). It increases by exactly one
per row and ignores closures and clock time. Everything about windows is arithmetic on
it ([concept](../../docs/sliding-windows/README.md#rows-and-index-counters)):

```text
rolling candle of row o      rows o − 59 … o
phase (minute_index, second_index)   o % 60
same-phase candles for indicators    o − 60, o − 120, …
previous step                        o − 1
seconds inside minute m              60m − 59 … 60m
```

```sql
CREATE TABLE market.bar_1m (            -- the same shape for market.bar_1s
    contract_id   bigint   NOT NULL,
    slot_ordinal  bigint   NOT NULL,     -- index counter: +1 per scheduled-open minute
    phase         smallint GENERATED ALWAYS AS (slot_ordinal % 60) STORED,
    end_ns        bigint   NOT NULL,     -- clock time: charts and joins, never windows
    status        smallint NOT NULL,     -- observed, no trades, missing
    -- OHLC, high/low times, volume by aggressor side, trade count, price x size sum,
    -- running-delta extremes, and the researched per-slot metrics
    PRIMARY KEY (contract_id, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX ON market.bar_1m (contract_id, slot_ordinal);
CREATE INDEX ON market.bar_1m (contract_id, phase, slot_ordinal DESC);
```

PostgreSQL requires a partitioned table's unique keys to include the partition key, so
the key is `(contract_id, end_ns)`; `slot_ordinal` is one-to-one with `end_ns` per
product, so it stays unique by construction. Contracts of a product share ordinals
because they share the calendar. Each row also has a status (`observed`, `no_trades`,
`missing`), OHLC and the times of the high and low, volume split by aggressor side,
trade count, the price × size sum, running-delta extremes, and the per-slot metrics
from the research (CVD, spread, top-of-book size and imbalance at trades, and so on).

- Compute rows with `strategy-core` (`bars.aggregate` and its extensions), the code a
  live session runs. Extend `BaseBars` and `Rollup` with new per-second fields and
  keep the chunk-invariance tests passing; never compute a metric in SQL.
- Key on `(contract_id, end_ns)`; range-partition by `end_ns` per month; add a BRIN
  index on `end_ns` if scans need it. Store prices and sizes as `bigint` (Databento
  fixed-point, 10⁻⁹) and metrics as `double precision`. Avoid `numeric` here.
- Record the builder version per contract and session (code hash, `close_delay`,
  `feed_latency`, calendar version and phase origin, source files), and reload a slice
  by deleting and copying it again.
- Stored raw aggregates may use price units; model features derived from them must
  be normalized (see `strategy_core.features.Unit`).
- Measured: binary `COPY` of 44-column rows ran at about 400,000 rows per second and
  took about 400 bytes per row before indexes, or about 8 GB per contract-year.

**Contracts and rolls**: one row per contract (product, raw symbol, expiration, tick
size, multiplier) from Databento `definition` records; raw symbols repeat each decade,
so key on symbol plus expiration. Resolve instrument IDs per date. Store the roll
schedule per session.

**Runs, trades, and ML rows**: a run row with the spec and provenance (code hash,
data files, calendar version); closed trades; and one ML row per signal, holding the
feature-set version, the features as typed columns, the simulated outcome, and
`decision_ns`/`exit_ns` for purged splits.

## Principles kept from the earlier proposal

- Market times are UTC `bigint` nanoseconds; administrative times are `timestamptz`.
  Nanoseconds and IDs cross JSON as decimal strings.
- No-trade, missing, closed, and warming-up are distinct states; missing values are
  NULL with a status, never zero.
- A value is stored at the time it became available; a pivot keeps its origin time
  separately and is never backdated.
- Labels stay separate from features, with their horizon end; splits purge labels
  that cross them.
- Corrected inputs or changed definitions create new versions; never overwrite rows
  that past runs used.
