# Research storage

Status: a local PostgreSQL 18 database, `trading`, managed by the numbered migrations
in [`migrations/`](migrations/): `0001_foundation` (schemas `market`, `research`, `ml`,
and the Databento file registry `market.source_file`) and `0002_second_rows` (contracts,
rolls, ingestion bookkeeping, the one-second tables written by `research ingest`, and the
per-product continuous views), and `0003_side_bridges` (each second's first and last trade
side, so windows count side transitions across seconds); see
[ingestion](../../docs/project/ingestion.md). Runs and ML rows come next. The earlier
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
when one changes. Add a new migration instead. Agents apply migrations to the local
database when their code needs them ([AGENTS.md](../../AGENTS.md#local-database-agents-may-write-to-it)).

## One-second and one-minute rows

`market.bar_1s` (and `market.candle_1m_1s`, its rolling `1m@1s` candle and features) are
implemented; `market.bar_1m` and `market.candle_1h_1m` will follow the same design. There is
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
CREATE TABLE market.bar_1s (
    contract_id   bigint   NOT NULL,
    slot_ordinal  bigint   NOT NULL,     -- index counter: +1 per scheduled-open second
    end_ns        bigint   NOT NULL,     -- clock time: charts and joins, never windows
    -- OHLC, high/low times, volume by aggressor side, trade count, price x size sum,
    -- running-delta extremes, session CVD, and the TBBO metrics (strategy_core.rows)
    status        smallint NOT NULL,     -- 0 missing, 1 no trades, 2 observed
    phase         smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX bar_1s_end ON market.bar_1s USING brin (end_ns);
```

PostgreSQL requires a partitioned table's unique keys to include the partition key, so
the key is `(contract_id, slot_ordinal, end_ns)`; `slot_ordinal` is one-to-one with
`end_ns` per product, so it is unique by construction, and the one B-tree serves the
window arithmetic (`slot_ordinal BETWEEN o - 59 AND o`, `slot_ordinal % 60 = o % 60`).
Time ranges use partition pruning and the BRIN index. `phase` is virtual (no storage);
columns are ordered by width to avoid padding; there is no foreign key to
`market.contract`, so bulk `COPY` runs without per-row checks. Contracts of a product share
ordinals because they share the calendar. Each row also has a status (`observed`, `no_trades`,
`missing`), OHLC and the times of the high and low, volume split by aggressor side,
trade count, the price × size sum, running-delta extremes, and the per-slot metrics
from the research (CVD, spread, top-of-book size and imbalance at trades, and so on).

- Compute rows with `strategy-core` (`strategy_core.rows.SecondRowBuilder`), the code a
  live session runs. A new column means a registry entry in `strategy_core.rows`, a new
  migration, and a rebuild; tests compare the registry with the migrated tables. Never
  compute a metric in SQL.
- Store prices and fixed-point sums as `bigint` (Databento fixed point, 10⁻⁹), counts as
  `integer`, and ratios and features as `double precision`. Avoid `numeric` here. NULL
  means undefined; zero means none observed.
- `market.builder` records the builder version (code hash, `close_delay`, `feed_latency`,
  calendar version and phase origin, packages, columns); `market.ingest_slice` records it
  per contract and session with the source files and a checkpoint. A slice is reloaded by
  deleting its rows and copying them again.
- Stored raw aggregates may use price units; model features derived from them must
  be normalized (see `strategy_core.features.Unit`).
- Measured: about 325 bytes per `bar_1s` row and 951 per `candle_1m_1s` row with indexes,
  or about 27 GB per contract-year; 1.4 s per 23-hour session per worker, including
  binary `COPY`.

**Contracts and rolls** (implemented): `market.contract` has one row per contract keyed
by product, raw symbol, and delivery month (raw symbols repeat each decade); expirations
come from Databento `definition` records once they are loaded. Instrument IDs are resolved
per date from the files. `market.roll` holds the published front contract per session
(written by `research ingest run` once that contract's rows are stored) and
`market.session_volume` the volumes it was chosen from.

**Continuous series** (implemented): `market.front_session` maps each product session to its
front contract and that session's stored index counters; `market.continuous_bar_1s` and
`market.continuous_candle_1m_1s` select those rows, so each product reads as one series with
one row per scheduled second. They are views (`table.*` plus product columns): recreate them
in the migration that adds columns to the tables. Bound `slot_ordinal` in queries so the
primary key is used.

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
