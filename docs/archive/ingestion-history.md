# Ingestion history

Archived November 27, 2026 from `docs/project/ingestion.md` and `docs/project/data.md`. These
are dated measurements and decisions from building the stored rows and downloading the data.
They are kept for reference; the current rules are in [ingestion](../project/ingestion.md).
Names such as "run 3" or "PR B1" are the labels these notes used then. The build log
(`docs/project/build-log.md`) holds the evidence for most of them.

## Early ingest runs (TBBO-built rows, November 1 to 5, 2026)

Measured on rows built from TBBO files; they still describe the design and its costs.

- **Throwaway-database measurements (November 1).** About 0.35 s to compute, 0.5 s to encode, and
  1.4 s including writes for one 23-hour session per worker. An hour of
  `continuous_candle_1m_1s` queried in 7 ms; three sessions (248,400 rows) in 0.17 s. Features
  stay `double precision`, so stored features equal in-memory and live values exactly.
- **Run 1 (November 3, one builder, 5-session lead).** 46,503,000 rows per table in 11 min 2 s
  with 8 workers, 57.65 GB including indexes. Replaced by run 2.
- **Run 2 (November 4, stages, 40-session lead, `--rebuild`, 8 workers).** 12 contracts, 868
  contract-sessions, 71,559,900 rows per table in 1,423.9 s (23 min 44 s), about 1.6 s of wall time
  per contract-session per worker including deletes of the replaced rows. Compute alone is
  about 0.4 s per GC session for both stages. After compaction `bar_1s` was 20.11 GB and
  `candle_1m_1s` 60.73 GB including indexes, 80.84 GB total.
- **Baseline rebuild (completed November 4).** 12 contracts, 868 contract-sessions, 71,559,900
  rows per table, 257/257 front sessions per product. The 8-worker run took 14 min 47 s and
  ended `partial` after a stalled COPY connection was terminated; a 1-worker retry built
  only SIU6's remaining 84 sessions in 3 min 29 s and ended `done`. Fresh partitions used
  21.28 GB for `bar_1s` and 61.79 GB for `candle_1m_1s`, 83.07 GB total (decimal); no
  `VACUUM FULL` was needed.
- **Run 3 (minute stages).** `add`, 8 workers: 868 contract-sessions in 2 min 29 s, about 1.4 s
  of wall time per session per worker. `bar_1m` and `candle_1h_1m` hold 1,192,665 rows each
  (596,235 GC and 596,430 SI minutes) and use 0.62 GB and 1.05 GB including indexes.
- **Run 4 (`stats_1h_1m`).** 868 contract-sessions in 1 min 55 s; 1,192,665 rows, 0.35 GB.
- **Run 5 (`vol_1m`).** 868 contract-sessions in 1 min 55 s; 1,192,665 rows, 0.42 GB, plus 156 MB
  of checkpoints (the time-of-day buffer). The stage sets the required lead: 37 typical
  sessions (the daily percentile), inside the 40-session lead.
- **Run 6 (`vol_1s`).** 868 contract-sessions in 5 min 47 s; 71,559,900 rows, 24.05 GB
  including indexes, plus 159 MB of checkpoints. In live sessions the stage adds about
  0.08 ms per second (`research verify`).

## Rebuilt from MBP-1 (November 16, 2026)

GC and SI were rebuilt from the MBP-1 files in one run on a reset database: 12 contracts, 858
contract-sessions (2025-11-10 to 2026-11-06), 70,731,900 rows per second table, 24 min 48 s with 8
workers, 101 GB. The trade rows equal the TBBO-built ones on every day both have.

The six swing scales were then added (`add`) in 17 min 55 s: 212,195,700 `pivot_1s` rows at 316
bytes each with the index, 64 GB; the database was 168 GB. Every confirmed pivot equals an
independent replay of the trades.

## Outcome labels run (November 17, removed November 23)

Twelve label variants were added to the stored contracts (`add`, 8 workers): 858
contract-sessions in 3.5 minutes, writing 5,029,757 rows in `pivot_label_1s` and 197,721 in
`pivot_label_1m`, 1.3 GB including indexes. The labels and their tables were removed when the
reversal-prediction design was withdrawn (migration 0010).

## Sparse fast swing rows (applied November 19, 2026)

`TRUNCATE market.pivot_1s`, then `research ingest run GC SI --rebuild --workers 8`: the three
fast scales, their events, and their six label variants for 12 contracts and 858
contract-sessions, in 5 min 21 s. Each scale held 4,762,271 rows, 6.7% of the 70,731,900
seconds, and the table took 4.5 GB where it had taken 64 GB. The database went from 169 GB to
110 GB. No fast event row or minute end lacked a swing row, the three scales held one key
set, and a fresh `ingest plan GC SI` reported every contract `current`. The rule first kept
every row of a fast label as well; labels are gone, and the rule widened on November 20 for the
middle timeframe.

## Data downloads (verified November 15, 2026)

One year of Databento MBP-1, November 9, 2025 to November 5, 2026, for six products. The files
of PL, ES, YM, and RTY were removed from this machine on November 20, 2026 (they are kept in
cloud storage).

| Product | Exchange contract      | Tick, value  | Files | Size    | Records/day (median) | Trades/day (median) | Book changes per trade |
| ------- | ---------------------- | ------------ | ----- | ------- | -------------------- | ------------------- | ---------------------- |
| GC      | COMEX gold, 100 oz     | 0.10, $10    | 311   | 16.3 GB | 2.4 million          | 104,000             | 22                     |
| SI      | COMEX silver, 5,000 oz | 0.005, $25   | 311   | 12.9 GB | 1.7 million          | 36,000              | 41                     |
| PL      | NYMEX platinum, 50 oz  | 0.10, $5     | 311   | 5.7 GB  | 0.9 million          | 14,000              | 57                     |
| ES      | E-mini S&P 500         | 0.25, $12.50 | 311   | 51.1 GB | 8.7 million          | 441,000             | 19                     |
| YM      | E-mini Dow ($5)        | 1, $5        | 311   | 16.8 GB | 2.8 million          | 65,000              | 44                     |
| RTY     | E-mini Russell 2000    | 0.10, $5     | 311   | 20.1 GB | 3.4 million          | 94,000              | 34                     |

Counts cover all contracts and spreads of a product; medians are over days with more than
100,000 records.

- **Files.** All 1,878 files (1,866 data files and each job's three JSON files) present with the
  manifest's size and SHA-256.
- **Records.** Every data file decodes completely: 5.94 billion records, 222.8 million of them
  trades. Every file's schema is `mbp-1`, receive times are sorted in every file, and no trade
  has an undefined price or a zero size.
- **Equal to TBBO.** For four whole sessions (GCZ6 and SIZ6 on 2026-09-15, GCG6 on 2025-12-10,
  and SIK6 on 2026-03-16, a degraded day), the trade records give exactly the second rows
  stored earlier from the TBBO files: all 82,800 seconds each, with no difference.
- **Book quality.** A crossed book appears in 0.003% of GC and 0.006% of SI book records, mostly
  around the open. Databento's "book may be wrong" flag is set only on 2025-11-28, in RTY and YM.
- **Conditions.** Databento marks 2025-11-28 (a long CME Globex outage), 2026-03-16, 2026-04-10,
  and five weekend dates `degraded`. 2026-11-06, the last day requested, was `missing` when the
  jobs were made and has no file.
- **Checked on the TBBO files (November 1), unchanged.** Tick sizes implied by the prices equal
  the product specs in `strategy_core.market`; no outright trade falls outside the exchange
  calendar, including holidays, early closes, and the equity-only Good Friday session
  (2026-04-03); unknown-side volume is the outright legs of spread trades and stays out of CVD;
  front months by volume are GC G, J, M, Q, Z (rolling late in the month before), SI H, K, N, U,
  Z, PL F, J, N, V, and quarterly for the equity-index products, about the second Monday of the
  expiry month.
- **MBP-1 only (decided November 15, 2026, replacing TBBO).** The book between trades lets a
  simulated order fill at the price it would have met. The cost: 123 GB for six products
  against 7.3 GB, and about 20 to 60 book records for every trade to decode. The TBBO files were
  deleted.
- None of the 325 million trade records on disk was rejected (checked November 2, 2026).

## Decided but not done

- **Contract definitions.** Databento quoted $0.00 for a year of `definition` records for all
  parents. They would give each contract's expiration, tick size, and multiplier for
  `market.contract`. Download a batch job with the same settings as the MBP-1 jobs (`GLBX.MDP3`,
  schema `definition`, DBN, zstd, split by day) into `data/databento/definition/`; the catalog
  recognizes `definition` jobs and `research catalog --verify` checks them.
- **Roll rule.** Previous-session volume is the default. Open interest would need the
  `statistics` schema; a fixed number of days before expiry would need only definitions.
- Backtests could read stored rows when the builder matches the run: the values are already
  equal, and the warm-up takes about a third of a year's run.

## What the tests covered

The ingestion tests are `lib/strategy-core/tests/test_metrics.py`, `test_rows.py`,
`test_minutes.py`, `test_stages.py`, `test_hour_stats.py`, `test_volatility.py`,
`test_vol_seconds.py`, `test_swings.py`, and `apps/backtest-runner/tests/test_ingest.py`. They
check: windows against direct aggregation of their trades; identical rows and state for whole
sessions and second-by-second processing; exact checkpoint restore; scale invariance of every
feature; per-phase parity with plain references; the declared warm-ups; every stored statistic
against an independent recomputation; the schema and `market.column_registry` against the
registry; stages versioned on their own; and an end-to-end run with two contracts and a roll
(build, rerun, extend, repair, rebuild, stale detection). Read the test files for the current
list.
