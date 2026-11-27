# Ingestion: market data files and stored rows

The full text before it was shortened on November 27, 2026 is
[archived](../archive/ingestion-original-2026-11-27.md).

The one reference for how the Databento files on this machine become the rows in PostgreSQL:
what data exists, how files are registered and checked, what `research ingest` does, which
tables it fills, and how to change or rebuild them. Metric definitions are in the
[metrics reference](trade-metrics-reference.md); the stage design (tiers, warm-up, what a change
costs) is in the [feature pipeline](feature-pipeline.md). Dated measurements of early runs and the
original download checks are archived in [ingestion-history](../archive/ingestion-history.md).

## The data on this machine

One year of Databento **MBP-1** (every trade with its aggressor side, and every change to the
best bid and ask: price, displayed size, and order count on each side), November 9, 2025 to
November 5, 2026, for **GC (gold) and SI (silver) only**: 311 daily files each, about 27 GB together.
Other products (PL, ES, YM, RTY) were downloaded and verified, then removed from this machine on
November 20, 2026; the owner keeps them in cloud storage. They return, with NQ and five more
years of GC and SI, on a larger machine.

The files are in `data/databento/mbp-1/<ROOT>--2025-11-08--2026-11-07/` (gitignored; back them
up), one folder per product, kept exactly as delivered: a manifest, metadata, `condition.json`,
and daily `glbx-mdp3-YYYYMMDD.mbp-1.dbn.zst` files. Every job is dataset `GLBX.MDP3`, schema
`mbp-1`, parent symbology (`GC.FUT`: all contracts and calendar spreads), DBN with zstd, split by
UTC day. See [data/README.md](../../data/README.md) for the folder rules. DBN has integer prices
(units of 10⁻⁹), nanosecond timestamps, and the instrument ID of each contract per date. A CME
session runs 17:00 to 16:00 CT, so it spans two daily files; the source reads both and never
assumes a file is a session.

**A record** is one event at the best bid or ask of one instrument, in the order Databento
received it: an add, cancel, or modify of displayed size (`A`, `C`, `M`), a book clear (`R`), or a
trade (`T`). A non-trade record carries the best bid and ask _after_ the event. A trade record
carries them _just before_ the trade, with its price, size, and aggressor side. The trade
records alone are exactly Databento's TBBO schema. Each file starts with snapshot records that
restate the book.

Known conditions: Databento marks 2025-11-28 (a long CME Globex outage), 2026-03-16, 2026-04-10,
and five weekend dates `degraded`. 2026-11-06 was `missing` when the jobs were made and has no
file. A crossed book (bid above ask) appears in 0.003% of GC and 0.006% of SI book records,
mostly around the open; simulated orders never fill at one. Unknown-side trade volume is mostly
the outright legs of spread trades and stays out of CVD.

### Storage

DBN files are the permanent tick archive. PostgreSQL (database `trading`) holds everything
derived: the file catalog with checksums, contracts, the roll schedule, quality reports, one row
per scheduled-open second and minute per contract, runs, trades, and models. There is no Parquet
or DuckDB layer. Every derived row can be rebuilt from the files, so any statistic can be added
later. Rows are computed with `strategy-core`, the code live sessions run, and record their
builder version. The storage design is in [lib/db-research/README.md](../../lib/db-research/README.md).

## From files to rows

Each step reads the one before it and can be rerun.

1. **Register.** `research catalog` verifies each file against `manifest.json` (size and
   SHA-256). Dates whose `condition.json` entry is not `available` or `degraded` have no coverage.
   A file covers its UTC day only inside its job's requested range, so a job that starts or ends
   partway through a day leaves the rest of that day missing, not quiet. Two jobs covering
   different parts of the same day are refused.
2. **Contracts.** Each raw symbol resolves to its instrument ID per date from the file's symbol
   mappings (IDs are unique only within a day). Spreads are excluded. Contracts are keyed by symbol
   and delivery month, since one-digit-year symbols repeat each decade (GCZ6 is December 2016 and
   December 2026).
3. **Calendar.** Scheduled-open sessions come from `pandas_market_calendars` (`CMEGlobex_GC`,
   `CMEGlobex_SI`), including early closes.
4. **Rolls.** The front contract is the outright with the most volume in the previous complete
   session, switching at a session open and only to a later delivery month. Delivery months are
   never merged ([continuous series](#continuous-series)).
5. **Base rows.** One row per scheduled-open second with status `observed`, `no_trades`, or
   `missing`; larger steps merge from them. Trades are assigned by the engine's
   [timing model](engine.md#timing-model).
6. **Stage rows.** Each stage computes its table from the rows before it.
7. **Quality report.** Per session: trades, volume, unknown-side share, late trades, trades
   outside the schedule or coverage, missing slots, event-time inversions, trades outside the
   pre-trade book, Databento quality flags, and rejected trade records. It is stored in
   `market.ingest_slice.report`.

Backtests run steps 4 to 6 in memory with the same code, so a backtest warmed for the stored
lead computes exactly the stored rows (`test_a_backtest_warmed_for_the_lead_computes_the_stored_rows`).

## Row rules

- **Every scheduled-open second is a row**, including seconds without trades (`status` 1) or
  without data coverage (`status` 0). Closures have no rows. Windows are 60 consecutive rows with
  no skip logic; see [sliding windows](../sliding-windows/README.md#rows-and-index-counters).
- **Accepted trades only.** A trade needs a defined price and a positive, defined size (zero and
  negative prices are valid futures prices). A displayed size or order count equal to
  Databento's undefined value is not a book observation. Rejected records never reach rows or
  roll volumes; each session counts them (`rejected_trades`).
- **Trade assignment** uses the engine's timing model with the backtest defaults (`close_delay`
  100 ms, `feed_latency` 5 ms): event time, or the slot open when the trade arrived after its
  slot had closed.
- **NULL, never zero, when undefined.** Missing seconds have NULL volume; seconds without trades
  have NULL prices; a book statistic is NULL when no trade in the second had a usable book (the
  validity subsets P, D, C, K of the [metrics reference](trade-metrics-reference.md#24-validity-subsets)).
  Features are NULL unless the candle is complete (60 covered seconds with a trade), with these
  exceptions:
  - **Price indicators** (RSI, ATR, EMA distances, MACD, ADX, midpoint RSI, and lookbacks such as
    stochastic, Bollinger, Donchian, Aroon) are also defined on an empty window (covered, no
    trades) with a known last price: they advance with a flat candle at that price, and its flows
    are zero. Nothing is carried across missing data. Activity baselines (`rel_volume`,
    `rel_trades`, `rel_depth`, `rel_spread`) use windows with trades only.
  - **Latest-book features** (`trade_age_s`, `book_age_s`, `depth_age_s`, `book_spread_bps`,
    `book_imbalance`) are defined for windows without trades, but after a missing second they are
    NULL until the next trade.
- **CVD.** `session_cvd` runs from the session's open and is NULL from the first missing second of
  that session on. `cvd` is the same running total from the contract's first stored second, never
  restarted, so a swing of it can cross the daily break; it is NULL only on a missing row, and a
  reader starts a new segment there. Unknown-side volume stays out of both.
- **Exact base statistics.** Prices, spreads, depth sums, and times are integers; every field
  merges into minutes and windows by sums, extremes, first and last values, or path rules, and
  ratios are formed after merging. Sums are added oldest first, so a minute equals the rolling
  window that ends with it to the bit.
- **Path within the second** (`drawdown`, `drawup`, `extreme_order`): the largest drop and rise from
  a trade to any later trade, and whether the low or the high came first. They show what the
  high and low cannot (99, 105, 100 falls 5 in a second that closes up).
- **Larger steps.** A step row merges its seconds by the rules of the metrics reference. A
  `1m` row with any missing second is missing (`status` 0). `observed_seconds` counts seconds
  with trades. Indicators on a candle follow the
  [per-phase rule](../sliding-windows/design.md#4-indicators-per-phase): recursive ones keep one
  state per phase; lookback ones read the same-phase candles `o, o − 60, o − 120, …`, so RSI(14)
  on `1m@1s` is a 14-minute RSI updated every second.
- **Swings** replay the released trades, not rows: a running extreme is confirmed by a reversal of
  `max(k × ATR, 2 × spread)` frozen when the extreme was set, using the ATR and spread of the row
  before the extreme's own. A row is published after its trades, so it never holds a later
  trade; an event carries the row of the trade that produced it. `state` 0 (all values NULL)
  means missing data or an undefined threshold, and a new segment starts afterwards. Ages count
  rows × the row's seconds. Design: [pivot-structure-design](pivot-structure-design.md).

## Stored tables

Each stage has its own table, builder version, and per-session checkpoint. Tables exist for
each timeframe (`1m@1s`, `10m@10s`, `1h@1m`); the step rows are seconds (`1s`), ten seconds
(`10s`), or minutes (`1m`).

| Table (tier)                                    | One row per          | Holds                                                           |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `bar_1s` (0)                                    | second               | The second's exact statistics: OHLC, side volumes, CVD extremes, path fields, book at trades |
| `bar_10s`, `bar_1m` (0)                         | 10-second row, minute | The same statistics merged exactly from their seconds, plus observed seconds |
| `candle_1m_1s`, `candle_10m_10s`, `candle_1h_1m` (1) | step row         | The rolling window of 60 step rows and its normalized features (indicators per phase) |
| `stats_1m_1s`, `stats_10m_10s`, `stats_1h_1m` (1) | step row           | Window statistics: realized volatility, return moments, path, session levels, price-flow correlation |
| `vol_1s`, `vol_10s`, `vol_1m` (1)               | step row             | Volatility: ATR horizons, bullish and bearish ATR, adverse excursion, extremes, time of day, daily ATR |
| `pivot_1s`, `pivot_10s`, `pivot_1m` (2)         | step row and scale   | Price swings: the open leg, latest confirmed high and low, trend, structure, breaks, `progress` |
| `pivot_rsi_1s`, `pivot_rsi_10s`, `pivot_rsi_1m` (2) | step row and scale | The same swing features for the RSI series, in its own ATR      |
| `pivot_cvd_1s`, `pivot_cvd_10s`, `pivot_cvd_1m` (2) | step row and scale | The same for CVD (net volume flow), in its own ATR              |
| `pivot_event`                                   | swing event          | Confirmed highs and lows, breaches, and reclaims of every scale of every kind, with the trade's row |

Rows are keyed by `(contract_id, slot_ordinal, end_ns)`. `slot_ordinal` is the row's index counter
at its own resolution, and `phase` is a virtual column, `slot_ordinal % 60`. Minute `m` holds the
seconds with ordinals `60m − 59 … 60m`, so the second row at `60m` ends with minute `m`; a
ten-second row `k` ends at second `10k`. Partitions are monthly on `end_ns`. Join tables of one
resolution on `(contract_id, slot_ordinal)`, and a minute to its last second on
`second.slot_ordinal = 60 * minute.slot_ordinal`. Column descriptions and units are PostgreSQL
comments (`\d+ market.candle_1h_1m`); `market.column_registry` lists each stored column's role.

**Swing scales are variants.** The pivot tables hold one row per slot _and scale_; their key adds
`variant_id` (`market.variant` names each scale and holds its parameters), so always filter on
it. The scales are 0.5, 1, 2, and 3 × the ATR of the timeframe. Price scales are named
`fast_atr_0p5`, `mid_atr_1`, `slow_atr_2` (and so on); RSI scales `<stream>_rsi_mean_atr_<k>`
(the RSI is the mean of the last 60 rows' RSI); CVD scales `<stream>_cvd_atr_<k>`. The earlier RSI
variants `<stream>_rsi_atr_<k>` are retired and their rows deleted. Each scale is a stage of its
own (`pivot_1s:fast_atr_1`, …) with its own builder, checkpoint, and `market.stage_slice`
records (`stage` = the table, `variant_id` = the scale), so adding a scale adds rows and
rebuilding one touches no other. A scale's events are replaced with its rows, session by session.
A scale's parameters are fixed under its name (a changed scale needs a new name); a scale no stage
defines any more is marked retired and left out of the continuous views, never deleted by the
planner.

### Fast swing rows are stored sparsely

The fast scales (`pivot_1s`) are computed for every second, in ingestion as in backtests and live
sessions, but stored only for:

- the last second of every ten-second row (`slot_ordinal % 10 = 0`, which includes every minute's),
  so a decision on a slower timeframe finds the fast scales at its own row;
- every second in which a fast scale emitted an event.

All fast scales keep the same seconds, so any scale can be joined to any other there. Any other
second is recomputed by the engine from the DBN files; `pivot_event` holds every confirmed swing,
breach, and reclaim. The fast RSI and CVD scales (`pivot_rsi_1s`, `pivot_cvd_1s`) keep only the
first kind, the last second of every ten-second row (`pipeline.STORED_STEPS`,
[spec](series-structure-spec.md#what-is-stored)). The middle and slow scales store every step row.
This made `pivot_1s` 4.5 GB instead of 64 GB.

The rule is `pipeline.stored_rows`, and its name (`pipeline.STORED_ROWS`) is part of each fast
scale's builder identity: changing it makes them `stale`. Because every fast scale's events are
among the kept seconds, ingestion writes all the fast scales again whenever it writes one, in the
same transaction per session. A stage that needs swing state at other seconds must read it in
memory or extend the rule.

## Run it

Once, after pulling this code:

```sh
brew services start postgresql@18
uv run research db migrate              # applies pending migrations
uv run research ingest plan GC SI       # what would be built; stores no rows
uv run research ingest run GC SI        # build; progress on stderr, summary as JSON
uv run research ingest status           # series coverage, contracts, sizes, recent runs
```

`plan` reads every session's outright volumes from the DBN files once (about 15 s for a year of GC
and SI) and caches them, and computes the roll schedule without publishing it, so a plan changes
nothing that queries read. `run` does the same planning and then builds one process per contract
(`--workers`, default cores − 2). Every stage is computed in memory from the DBN files; only the
stages that are not current are written. Each session commits its rows and checkpoints together,
so `run` can be interrupted and rerun at any time: it continues where it stopped and never adds a
session twice.

**After downloading new MBP-1 files** (a later month, or a re-delivered file), put the job folder
under `data/databento/mbp-1/` as delivered, then:

```sh
uv run research catalog --verify        # checksums of every file
uv run research ingest plan GC SI       # shows extend, new, or repair per contract
uv run research ingest run GC SI
```

The plan extends the current front contract from its last checkpoint, adds contracts that became
front (with their lead sessions), and rebuilds any stored session whose files changed, from the
checkpoint before it.

| Need                                     | Command                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Another product                          | `research ingest run PL` (its files must be on the machine)          |
| A specific contract, such as a far month | `research ingest run GC --contract GCV6` (every session it traded)   |
| Only part of the range                   | `--start 2026-06-01 --end 2026-09-30` (trade dates)                  |
| A different lead before each roll        | `--lead-sessions 50` (default: derived, at least 40; see below)      |
| Rows built by older code or settings     | `research ingest run GC SI --rebuild` replaces those contracts' rows |

`--start` and `--end` limit which new sessions are added; a repair or rebuild always covers the
contract's whole stored chain, so no stored session is dropped.

Do not edit Python source while `research ingest` runs: its workers import the code again, and a
run records and checks the hash of the source it started with.

### What the plan decides

Stored sessions are replaced one at a time, each in one transaction, so a failed or interrupted
build leaves the remaining sessions on their previous, readable rows.

| Action          | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `new`           | Nothing stored: build every session of the span                                          |
| `extend`        | Stored sessions are current; build the new ones from the last checkpoints                |
| `add`           | A stage has no rows yet (a new stage): build it from the span start; nothing is replaced |
| `repair`        | A stored session's files changed: rebuild it and later sessions from the checkpoint before |
| `current`       | Nothing to do                                                                            |
| `stale`         | A stage or the source was stored by other code or settings: needs `--rebuild`            |
| `needs_rebuild` | New sessions before the first stored one, or its files changed: needs `--rebuild`        |
| `rebuild`       | With `--rebuild`: rebuild from the first session that is not current; resumes if interrupted |

`--rebuild` rewrites only the stages that depend on what changed.

**Spans.** Every contract that is ever the front contract (`market.roll`) is stored from
`--lead-sessions` sessions before it first becomes front through its last front session, so its
indicators are warm when the continuous series switches to it. Spans cover every scheduled
session between the first and last downloaded ones: a session in a gap between downloads is
stored as rows without data coverage (`status` 0), never skipped, and rebuilt once the gap is
downloaded. The first session after a gap chooses its front contract afresh. The first stored
session of a contract is where its indicator states start, so adding earlier sessions later
changes every later value: the plan reports `needs_rebuild` and waits for `--rebuild`.

### Builder identities and when a stage is stale

Each stage has its own identity in `market.builder` (column `stage`): a SHA-256 of its `MODULES`
(its calculations in `strategy-core`), the row codec (`codec.py`), its settings and columns,
numeric package versions, and the identities of its inputs. The market source has one too (`stage`
= `source`): the calendar, file, and source modules, the trade-assignment timing, the calendar and
phase origin, and the Databento and calendar package versions. Changing a stage's code makes that
stage and every stage that reads it `stale`; the others stay current, and a new stage is simply
added. Ingestion's orchestration (`ingest.py`, `store.py`) is in no identity, since it computes
and encodes no values; the end-to-end tests prove that stored rows equal the pipeline's output.

**Records.** `market.ingest_slice` keeps one row per stored contract session: its source builder,
its source files with checksums and covered windows, its quality report (including
`history_limited`), and the row bounds the continuous series reads. `market.stage_slice` keeps
one row per stage (and variant) and session: the stage builder, its checkpoint, and `warm`. Cached
session volumes carry their own digest (`scan_sha256`: the modules in `SCAN_FILES`, the timing
settings, and the Databento and calendar package versions) and are read again from the DBN files
when it changes, so rolls always come from current code and calendars.

### Checkpoints, lead, and warm-up

The **lead** is the number of sessions stored before a contract first becomes front. It is derived
from the stages' warm-ups, which follow from their indicator parameters
([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)), and is at least 40 sessions
(`LEAD_FLOOR`). `plan` reports `lead_sessions`, `required_lead` (the stage that needs most), and
`warm_sessions` per stage; a `--lead-sessions` shorter than a stage needs is refused. A stage's
session is `warm` once the contract has run its warm-up; a contract whose downloads start too
late for the full lead is reported `history_limited`. A longer indicator that raises the required
lead makes the plan prepend sessions, which shows as `needs_rebuild`. Swing structure depends on
arbitrarily old swings, so no lead makes it history-complete: `warm` there says whether every row
of the last chunk had a confirmed high and low.

Each stage's state is checkpointed per session (`market.stage_slice`), so extending a contract
resumes exactly where the last session ended.

## Continuous series

Rows are stored per contract. Each product also reads as **one permanent series** through the
views `market.continuous_<table>` for every table above (`continuous_bar_1s`,
`continuous_candle_10m_10s`, `continuous_pivot_rsi_1m`, `continuous_pivot_event`, and so on, with
each scale's name). They have the columns of the stored tables plus `product`, `trade_date`,
`contract` (the source contract), `roll_basis`, and `rolled`, and take no storage:
`market.front_session` maps sessions to contracts. `run` publishes each session's front contract to
`market.roll` only once that contract's rows for the session are stored, so a failed or
interrupted build never removes a readable session or points it at missing rows.

- **One contract per session, never merged.** Delivery months trade at different prices (gold's
  months differ by the cost of carry, often hundreds of ticks), so mixing their trades would
  create false ranges and moves, and their books differ.
- **The roll rule is the backtest's** (`source.next_front`). The opening sessions of each
  downloaded range have no usable previous session: they use their own volume, even if partial,
  or with none the range's first front (`roll_basis` = `same_session`, not causal). Sessions
  without any volume get no front; `plan` and `run` list them as `unresolved_sessions`.
- **One row per scheduled second (or step).** Contracts of a product share the calendar, so
  `slot_ordinal` continues across rolls. A session's minutes are the whole minutes inside its
  seconds `first_ordinal … last_ordinal`: `(first_ordinal + 59) / 60 … last_ordinal / 60`.
- **No artificial roll moves in features.** Each row's candle and features come from its own
  contract's history, and the new front contract was stored from the lead before its roll, so no
  feature sees the price difference between months. Raw prices (OHLC, VWAP) do jump at a roll:
  `contract` names the source, and `rolled` is true on each new contract's first session. Compute
  anything from raw prices within one contract; a window over `continuous_bar_1s` would mix
  contracts across a roll, while the stored candles never do.
- **Coverage.** `research ingest status` reports, per product, the front sessions stored and the
  first missing ones.

```sql
-- The last hour of GC 1m@1s features, whichever contract was front
SELECT end_ns, contract, rsi, ema21_atr, spread_bps
FROM market.continuous_candle_1m_1s
WHERE product = 'GC' AND slot_ordinal BETWEEN :o - 3599 AND :o
ORDER BY slot_ordinal;

-- One contract's same-phase candles. Bound the range so the primary key is used;
-- an unbounded `slot_ordinal % 60` filter scans.
SELECT slot_ordinal, close FROM market.candle_1m_1s
WHERE contract_id = :c AND slot_ordinal BETWEEN :o - 60 * 14 AND :o
  AND slot_ordinal % 60 = :o % 60
ORDER BY slot_ordinal;
```

## Adding a stage or a metric

Every stored value is computed from the DBN files, so any statistic can be added later. What a
change rebuilds is in the [feature pipeline](feature-pipeline.md#what-a-change-costs).

1. **Per-second statistic:** add a `Field` to `metrics.FIELDS` (how it merges: sum, max, min,
   first, last, or a path rule, and which count makes it valid) and compute it in `second_metrics`.
   **Candle feature:** add it to `indicators.FEATURES` with a normalized unit and compute it in
   `CandleIndicators.update`; a price indicator also joins `PRICE_FEATURES`.
   **New stage:** a `Stage` subclass in its own module (`stage_<name>.py`) with its columns,
   inputs, `MODULES`, settings, and `warmup()`, registered in `pipeline.STAGES`.
2. The stage's column registry picks it up. Add a numbered migration with
   `ALTER TABLE ... ADD COLUMN` (or `CREATE TABLE` for a stage), and recreate the
   `market.continuous_*` views of changed tables in it (they select `table.*`).
3. Existing tests cover the new value automatically: windows against direct aggregation, scale
   invariance, chunking and checkpoints, the declared warm-up, and the registry against the
   migrated tables. Add a hand-checked case for the formula.
4. `uv run research db migrate`, then `uv run research ingest plan GC SI`: the changed stage and
   the stages that read it show `stale` (run with `--rebuild`); a new stage shows `add`. If a
   longer indicator raised the required lead, the plan says so with `needs_rebuild`.

Apply a migration to `trading` only once the code that needs it is final: an applied migration
can never change (see AGENTS.md).

### What a build costs

Rules of thumb for GC and SI (one year, 12 contracts, about 858 contract-sessions, 70.7 million
rows per second table, 8 workers):

- A rebuild of the base, window, and volatility stages from the MBP-1 files took 24 min 48 s;
  adding the swing scales (`add`) took 17 min 55 s the first time, and rebuilding the sparse fast
  scales took 5 min 21 s.
- Compute alone is about 0.4 s per GC session for the base stages; with writes about 1.4 to 1.6 s
  of wall time per contract-session per worker.
- The database is about 375 GB for this year of GC and SI. The per-second tables are the bulk
  (`candle_1m_1s` alone is about 60 GB); swing rows of the fast scales are sparse for that reason.
- `plan` takes about 15 s.

The earlier measurements are in [ingestion-history](../archive/ingestion-history.md).

## Fingerprint: comparing two databases

`scripts/db-fingerprint.sh [database] > fingerprint.txt` prints, for every table of the `market`
schema, per contract (and scale), the row count and an order-free hash of every column but the
builder, contract, and variant ids. Two databases built from the same files by the same code print
the same lines, so a rebuild on this machine or another can be compared with `diff`. Contracts are
named by symbol, since their ids differ between databases. The default database is `trading`.

## Troubleshooting

**Confirm completion after an interrupted run.** Check the JSON `status`, not just the exit code:
ingestion exits 0 even when the result is `partial`. Rerun the same command to resume committed
session checkpoints. If the rerun builds sessions, require `status: done`; a successful no-op
returns `run_id: null`, empty `results`, and no `status` field. Either way, finish with a fresh
`plan` reporting every contract `current`. An uncommitted session rolls back if its connection is
closed; completed sessions remain readable. A stalled COPY was recovered this way; bounded
transfer timeouts and a nonzero exit for incomplete runs are still to be built.

**Every contract shows `stale` after a code change.** Expected: the stage and everything that
reads it must be rebuilt (`--rebuild`). Check that only the stages you changed show it; if all do,
the source's identity changed (calendar, file, or timing code, or a package version).

**`needs_rebuild`.** Sessions were added before the first stored one, or the required lead grew.
Run with `--rebuild`.

**A session is `missing`.** The files for that date are not on the machine or `condition.json`
marks it unavailable (2026-11-06 is such a date). Download it, then `plan` and `run` again.

**`research db` or `research ingest` fails on a branch.** A migration applied to `trading` is not
in this branch's `migrations/`; merge or rebase onto the branch that added it.

**Slow queries.** Bound `slot_ordinal` so the primary key is used, and filter pivot tables on
`variant_id`.
