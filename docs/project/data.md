# Historical data

Status: the DBN file catalog, contract selection, session calendars, one-second and
one-minute base bars, and per-session quality checks are implemented
(`apps/backtest-runner`). PostgreSQL holds the file catalog, and `research ingest` stores
one-second rows and `1m@1s` candle features ([ingestion](ingestion.md)). The bars feed the
window engine described in the [sliding-window design](../sliding-windows/design.md).

## What we have

One year of Databento **MBP-1** (every trade with its aggressor side, and every change to
the best bid and ask: price, displayed size, and order count on each side), November 9,
2025 to November 5, 2026. **GC and SI are the proof of concept** and the only products on
this machine. PL, ES, YM, and RTY were downloaded and verified with them, and their files
were removed on November 20, 2026 (Paul keeps them in cloud storage); they return, with NQ
and five more years of GC and SI, on a larger machine. What this page says about those four
describes the downloads as they were verified.

| Product | Exchange contract      | Tick, value  | Files | Size    | Records/day (median) | Trades/day (median) | Book changes per trade |
| ------- | ---------------------- | ------------ | ----- | ------- | -------------------- | ------------------- | ---------------------- |
| GC      | COMEX gold, 100 oz     | 0.10, $10    | 311   | 16.3 GB | 2.4 million          | 104,000             | 22                     |
| SI      | COMEX silver, 5,000 oz | 0.005, $25   | 311   | 12.9 GB | 1.7 million          | 36,000              | 41                     |
| PL      | NYMEX platinum, 50 oz  | 0.10, $5     | 311   | 5.7 GB  | 0.9 million          | 14,000              | 57                     |
| ES      | E-mini S&P 500         | 0.25, $12.50 | 311   | 51.1 GB | 8.7 million          | 441,000             | 19                     |
| YM      | E-mini Dow ($5)        | 1, $5        | 311   | 16.8 GB | 2.8 million          | 65,000              | 44                     |
| RTY     | E-mini Russell 2000    | 0.10, $5     | 311   | 20.1 GB | 3.4 million          | 94,000              | 34                     |

Counts cover all contracts and spreads of a product; medians are over days with more than
100,000 records (weekend files are small).

Layout: one Databento job folder per product, kept exactly as delivered (manifest,
metadata, condition, and daily `glbx-mdp3-YYYYMMDD.mbp-1.dbn.zst` files), under
`data/databento/mbp-1/<ROOT>--2025-11-08--2026-11-07/` (gitignored, 27 GB for GC and SI; back it up).
Every job is dataset `GLBX.MDP3`, schema `mbp-1`, parent symbology (`GC.FUT` and so on:
all contracts and calendar spreads), DBN with zstd, split by UTC day, requested for
2025-11-08 to 2026-11-07.

**What a record is.** Each record is one event at the best bid or ask of one instrument,
in the order Databento received it: an add, cancel, or modify of displayed size (`A`, `C`,
`M`), a book clear (`R`), or a trade (`T`). A non-trade record carries the best bid and ask
_after_ the event. A trade record carries them _just before_ the trade, with the trade's
price, size, and aggressor side; the next record shows what the trade left. The trade
records alone are exactly Databento's TBBO schema. Each file starts with snapshot records
that restate the book.

Verified on November 15, 2026:

- **Files.** All 1,878 files (1,866 data files and each job's three JSON files) are present
  with the manifest's size and SHA-256.
- **Records.** Every data file decodes completely: 5.94 billion records, 222.8 million of
  them trades. Every file's schema is `mbp-1`, receive times are sorted in every file, and no
  trade has an undefined price or a zero size.
- **Equal to TBBO.** For four whole sessions (GCZ6 and SIZ6 on 2026-09-15, GCG6 on
  2025-12-10, and SIK6 on 2026-03-16, a degraded day), the trade records give exactly the
  second rows stored earlier from the TBBO files: status, open, high, low, close, volume,
  buy and sell volume, and trade count of all 82,800 seconds each, with no difference.
- **Book quality.** A crossed book (bid above ask) appears in 0.003% of GC and 0.006% of SI
  book records, mostly around the open; simulated orders never fill at one. Databento's
  "book may be wrong" flag is set only on 2025-11-28, in RTY and YM.
- **Conditions.** Databento marks 2025-11-28 (a long CME Globex outage), 2026-03-16,
  2026-04-10, and five weekend dates `degraded`. 2026-11-06, the last day requested, was
  `missing` when the jobs were made and has no file: download it with the next extension.
- Checked on the TBBO files on November 1 and unchanged, since the trades are the same:
  tick sizes implied by the prices equal the product specs in `strategy_core.market`; no
  outright trade falls outside the exchange calendar, including holidays, early closes, and
  the equity-only Good Friday session (2026-04-03); unknown-side volume is the outright
  legs of spread trades and stays out of CVD; front months by volume are GC G, J, M, Q, Z
  (rolling late in the month before), SI H, K, N, U, Z, PL F, J, N, V, and quarterly for
  the equity-index products, about the second Monday of the expiry month.

**MBP-1 only, for every product (decided November 15, 2026, replacing TBBO).** The trades
are the same, and the book between trades lets a simulated order fill at the price it
would have met, so execution costs are measured instead of guessed; see
[data limits](engine.md#data-limits-mbp-1). The TBBO files were deleted. The price is
size: 123 GB for the six products against 7.3 GB, and about 20 to 60 book records for every trade to decode.

**Contract definitions (recommended, not yet downloaded):** Databento quoted $0.00 for
a year of `definition` records for all seven parents. They give each contract's
expiration, tick size, and multiplier for the contracts table, and distinguish raw
symbols that repeat each decade. Download a batch job with the same settings as the
MBP-1 jobs (`GLBX.MDP3`, parents above, schema `definition`, 2025-11-08 to 2026-11-07,
DBN, zstd, split by day) into `data/databento/definition/`. The catalog recognizes
`definition` jobs, and `research catalog --verify` checks them.

Choose DBN rather than JSON or CSV: integer prices (units of 10⁻⁹), nanosecond
timestamps, and a header with the query and the instrument ID of each contract on
each date. A CME session runs from 17:00 to 16:00 CT, so it spans two daily files;
the source reads both and never assumes a file is a session.

## Storage

**Decision (revised October 31, 2026): DBN files are the permanent tick archive, and
PostgreSQL holds everything derived from them, including one row per scheduled-open
second per contract.** There is no Parquet or DuckDB layer.

- **DBN files** keep every trade and every change to the best bid and ask. Fills and any
  rebuild read them. A year of GC and SI is 27 GB with zstd (123 GB for the six products first downloaded).
- **One-second rows** (OHLCV plus per-second metrics such as aggressor flow, CVD,
  spread, and top-of-book size and imbalance at trades) are computed by an ingestion
  job and stored for SQL research, ML exports, and fast backtests. **Every
  scheduled-open second gets a row, including seconds without trades** (status
  `no_trades`; decided November 1, 2026), and every row carries its index counter
  (`slot_ordinal`), so a sliding window is always exactly 60 consecutive rows with no
  skip logic and phases never depend on the clock. SI has trades in only 20% of its seconds. A
  contract-year is about 21 million scheduled seconds; with the stored metrics and the
  `1m@1s` features it takes about 27 GB (measured, [ingestion](ingestion.md#measured)).
  Each front contract is stored from a few sessions before it becomes front, not every
  listed month.
- **Relational data**: the file catalog with checksums, contracts, coverage, the roll
  schedule, quality reports, runs, trades, ML rows, models, predictions, and live
  decisions.

The ingestion job must compute rows with `strategy-core` code, the same code a live
session runs on the live feed; never reimplement a metric in SQL or a separate
script. Each stored row set records its builder version (code hash, assignment
settings such as `close_delay`, and source files). See the
[storage contract](../../lib/db-research/README.md) for the table design guidance.

## Ingestion pipeline

Each stage reads the output of the one before and can be rerun. Backtests run stages 1–6
in memory; `research ingest` runs them per contract and stores the one-second rows, the
roll schedule, and per-session quality reports ([ingestion](ingestion.md)).

1. **Register.** Verify each file against `manifest.json` (size and SHA-256). Dates
   whose `condition.json` entry is not `available` or `degraded` have no coverage, and a
   file covers only the part of its day inside the job's requested range.
2. **Contracts.** Resolve each raw symbol to its instrument ID per date from the file's
   symbol mappings; IDs are unique only within a day. Spreads are excluded. Loading
   `definition` records (expiration, tick size, multiplier) comes next.
3. **Calendar.** Scheduled-open sessions come from `pandas_market_calendars`
   (`CMEGlobex_GC`, `CMEGlobex_SI`, `CMEGlobex_PL`, and `CME Globex Equity` for the
   equity-index products), including early closes.
4. **Rolls.** The front contract is the outright with the most volume in the previous
   session, switching at the session open and only to a later delivery month, after warmup
   sessions on the new contract. An explicit contract overrides it. Stored rows give each
   product one continuous series that follows these rolls
   ([continuous series](ingestion.md#continuous-series-per-product)); delivery months are
   never merged, because their prices differ.
5. **Base bars.** One row per scheduled-open second (and minute) with status
   `observed`, `no_trades`, or `missing`. Late trades follow the
   [timing model](engine.md#timing-model).
6. **Quality report.** Per session: trades, volume, unknown-side share, late trades,
   trades outside the schedule or coverage, missing slots, event-time inversions,
   trades outside the pre-trade book, Databento quality flags, and rejected trade records
   (undefined price or no size; they are never aggregated). A session that trades in a
   backtest also reports its book events: how many, and how many show a one-sided or
   crossed book.

### Base bar fields

Each base bar (one second or one minute) stores OHLC and when the high and low occurred; volume split
into buy, sell, and unknown aggressor side; trade count; and the price × size sum
for VWAP. It also stores `delta_high` and `delta_low`: the highest and lowest
running buy − sell volume within the minute, measured from its start. Together with
the minute's net delta, these reproduce the exact CVD open, high, low, and close of
any window, clock-aligned or rolling, without rereading ticks.

CVD adds buyer-initiated volume and subtracts seller-initiated volume from an
explicit origin, such as the session open. Unknown-side volume is excluded and
reported separately; it is mostly spread legs. Classifying it from the
pre-trade bid and ask would be a separately named metric, not part of CVD.

Stored rows add the trade metrics of the [reference](trade-metrics-reference.md): sweeps,
trade sizes, the price path, and the book sampled at trades (spread, displayed size and
order counts, imbalance, effective spread), each with its validity count
(`strategy_core/metrics.py`).

## Open decisions

1. **Roll rule.** Previous-session volume is the default. Open interest requires the
   `statistics` schema; a fixed number of days before expiry needs only definitions.
   References: [MBP-1 fields](https://databento.com/docs/schemas-and-data-formats/mbp-1),
   [batch download options](https://databento.com/docs/portal/batch-download), and
   [DBN encoding](https://databento.com/docs/standards-and-conventions/databento-binary-encoding).
