# Handoff

As of November 15, 2026 (after the move from TBBO to MBP-1). Start here, then read
[AGENTS.md](../../AGENTS.md). The [roadmap](roadmap.md) is the map of what is computed and in
what order; tasks are tracked in [todo.md](todo.md); this page explains the architecture, the
decisions behind it, where the work stands, and exactly how to continue.

## Start here (next session)

1. **Rebuild the stored rows from MBP-1.** The rows in `trading` were built from the TBBO
   files, which are gone, and the source code changed, so `ingest plan GC SI` reports every
   stage stale. The rebuild needs Paul's go-ahead because it must reset the database first:
   the disk has too little free space to replace 102 GB of rows in place
   ([how](#rebuilding-from-mbp-1)). MBP-1 trades give the same rows
   ([checks](#the-move-to-mbp-1-november-15-2026)), so nothing else waits on this except
   stored-row research.
2. **The swing structure (PR D) is next**: directional-change pivots at 0.5, 1, and 2 ATRs on
   both resolutions, sized by the volatility tier (`vol_1s`, `vol_1m`). The design is the
   [plan, section 3](plan-1h-and-pivots.md#3-pivot-and-structure-design) and the
   [pivot/structure contract](pivot-structure-design.md); the procedure that worked for B and C
   is in [PR C](#pr-c-volatility-tier) ("How"). Size it from measured rows: `vol_1s` takes 307
   bytes per row with its index, so three `pivot_1s` variant rows per second would be roughly
   50–75 GB for GC and SI. The disk cannot hold that today (47 GB free on November 15), so
   decide the storage first: fewer stored scales, sparse events only, or more disk.
3. **Then the reversal model and structure signals** ([roadmap](roadmap.md#layers-3-and-4-predictions-that-later-layers-read)):
   labels and the benchmark (PR F), a walk-forward model stage
   ([rules](feature-pipeline.md#model-stages)), and signals that read both (PR E).
4. **Alongside:** the book stage `book_1s`
   ([metrics](../research/pivots/2026-11-06-second-scale-and-mbp1.md)) and paired products
   ([pair-design.md](pair-design.md): GC + SI first; ES + NQ after NQ is downloaded).
5. **Backtests equal storage; keep it so.** A backtest warms each contract for the stored lead
   by default and computes exactly the stored rows from every roll on. A new stage needs no
   extra work for this as long as its warm-up fits the lead.

How to work in this repository:

How to work in this repository:

- **The plan** is [plan-1h-and-pivots.md](plan-1h-and-pivots.md) (order of PRs A–F,
  decisions, the volatility tier), the [feature pipeline](feature-pipeline.md) (tiers,
  stages, database rules, derived warm-up), and the
  [pivot/structure contract](pivot-structure-design.md) (swings, higher lows and lower
  highs, tier-3 signals). Paul's decisions are recorded there; derived technical details
  (lead counts, thresholds needed for correctness) are decided and reported, not asked.
- **Paul's view of price data:** windows, not candles. The high and low path matters; open,
  close, and wick shapes are not signals ([principle](feature-pipeline.md#principle-windows-not-candles)).
- **Git:** the main checkout is shared and branches can switch under you; work in a
  worktree (`git worktree add ../trading-wt-<name> -b <branch> origin/main`), check the branch
  before committing, and push with an explicit refspec. DBN files are not in a worktree: link
  them with `ln -s ~/git/trading/data/databento data/databento`, and make sure
  `/data/databento` is listed in `$(git rev-parse --git-common-dir)/info/exclude` (a symlink
  is not matched by `.gitignore`'s directory rule).
- **Pull requests** are opened ready for review, never as drafts; Codex reviews every push
  automatically (never mention its handle in a comment). Within 30 minutes, read every
  finding (`gh api ... --paginate`), fix valid ones, reply on each thread, and resolve it.
  Paul merges, or authorizes a merge.
- **Database:** agents apply migrations and run ingest on `trading` without asking, test
  schema changes on throwaway `trading_test_*` databases first, and ask before dropping or
  truncating anything. A branch that applies a migration to `trading` must be merged
  promptly, since `main` cannot run `research db` until it has the same files.

## Goal

A platform to research short-horizon futures strategies and machine-learning models on
history, then run them live on the same code. Metrics are computed in layers, each reading
only the ones below ([roadmap](roadmap.md#the-layers)): trade flow such as CVD, indicators
and volatility on rolling windows, swing structure, a model's reversal predictions, and
finally one model trained on all of them, for one product and for pairs that move together
(GC with SI, ES with NQ). In today's baseline strategy a rolling `1h@1m` candle (the last 60
one-minute rows, every minute) sets a direction bias that only rules out a direction;
rolling `1m@1s` features (the last 60 one-second rows, every second) time entries; a bracket
sized in ATRs exits within minutes. Models train on at least a year of history.

## Architecture

```text
data/databento/mbp-1/*.dbn.zst     Permanent tick archive: Databento MBP-1, one file per day
        │                          and product, gitignored (data/README.md)
        │  catalog.py (files, checksums), source.py (one contract's trades, and for
        ▼  sessions that trade its book events, per session)
lib/strategy-core                  The same code for history and live sessions
  bars.py, metrics.py              Trades → one row per scheduled second, exact statistics
  windows.py, window_metrics.py    Rolling candles: rows o − 59 … o
  kernels.py, indicators.py        Per-phase indicators: candles o, o − 60, o − 120, …
  features.py                      Normalized features (Unit)
  stages.py, stage_*.py            Stages: one stored table each, versioned on its own
  pipeline.py, state.py, warmup.py Tier-ordered pipeline, exact checkpoints, derived warm-ups
  engine.py, execution.py          Strategies, and fills at the book each order meets
        │                                      │
        ▼                                      ▼
Engine: backtests and rehearsals      research ingest → PostgreSQL `trading`
(research backtest, verify)           one table per stage, per contract:
                                        bar_1s, bar_1m (tier 0)
                                        candle_1m_1s, candle_1h_1m, stats_1h_1m, vol_1s,
                                        vol_1m (tier 1)
                                        next: pivot_* (D), pivot_label (F), model_* and
                                        signal_* (E), book_1s, pair_1m
                                      market.continuous_*                  (per product)
                                                  │
                                                  ▼
                                      ML training (next): one model on pooled examples
```

`apps/backtest-runner` holds the data adapters, calendars, ingestion, CLI (`research`), and
the local API; `apps/research-web` is the UI (run setup, results, trade inspector).

**Two record types** (`strategy_core/market.py`). `Trades` are the MBP-1 records with
`action == "T"`: each trade with the best bid and ask just before it, exactly what TBBO
held. Every stage reads only these today. `BookEvents` are all of a contract's MBP-1
records in receive order: each change to the best bid and ask, and the trades among them.
`MarketChunk.book` carries them for sessions that trade; the simulator reads them to fill
orders. Ingestion does not load them (`DayCache(book=False)`), so its workers stay small;
a stage that reads the book only needs the cache switched on, since
`HistoricalSource.stored_chunk` already passes the book when the cache keeps it.

**Stages** ([feature pipeline](feature-pipeline.md)): each stored table is a `Stage`
(`strategy_core/stages.py`) in its own module (`stage_bar_1s.py`, `stage_bar_1m.py`,
`stage_candle_1m_1s.py`, `stage_candle_1h_1m.py`, `stage_stats_1h_1m.py`, `stage_vol_1m.py`,
`stage_vol_1s.py`),
registered in tier order in `pipeline.STAGES`. A stage declares its inputs, columns (with
roles and units), `MODULES` (hashed into its builder identity), settings, checkpoint state,
and `warmup()` in scheduled-open seconds. `Pipeline` runs them per chunk and passes in-memory
products (bars, metrics, candles) and each stage's rows (`products["tables"]`) downstream. Ingest (`apps/backtest-runner/.../ingest.py`)
computes every stage from the DBN files but writes only stages that are not current;
`market.ingest_slice` is the per-session source record, `market.stage_slice` holds each
stage's builder, checkpoint, and `warm` flag, and the lead is derived from the warm-ups
(at least 40 sessions). The engine reads its features from the same stages
(`pipeline.StageFeatures`, PR B1): every `candle_1m_1s` and `vol_1s` feature of the second's
window as `1m@1s.<name>` (joined row by row) and every `candle_1h_1m`, `stats_1h_1m`, and `vol_1m`
feature of the latest completed minute as `1h@1m.<name>`, with `1h@1m.age_s`; a stored NULL reads
as NaN (235 features).

## Core rules

These are fundamental; changing any of them changes every stored value.

1. **Rows and index counters, never clock time.** Every scheduled-open second and minute is
   one row, with or without trades or data; closures have no rows. Each row has an index
   counter, `slot_ordinal`, from a fixed calendar origin. For row `o`: the rolling candle
   is rows `o − 59 … o`, the phase is `o % 60`, indicators read the same-phase candles at
   `o − 60, o − 120, …`, and minute `m` holds seconds `60m − 59 … 60m`. After an 18:15
   early close and a 23:00 reopen, the 23:01 hourly candle covers 17:16–18:15 plus
   23:00–23:01, and its previous same-phase candle is exactly 60 rows earlier
   ([rows and index counters](../sliding-windows/README.md#rows-and-index-counters)).
2. **Indicators per phase.** Periods count candles of one phase, so on `1m@1s` RSI(14) is a
   14-minute RSI updated every second, and on `1h@1m` a 14-hour RSI updated every minute.
   Never feed consecutive rolling candles (they share 59 of 60 rows) to an indicator.
3. **Normalized features.** Features and model inputs are price-free: basis points, ATR
   multiples, ratios, 0–100 indexes, log ratios, or seconds, each comparing a contract with
   its own history (`features.Unit`, enforced by a scale-invariance test). Raw prices are
   only for order prices, fills, P&L, and charts.
4. **One engine.** Backtests, rehearsals, and (later) live sessions run the same code; whole
   sessions and second-by-second processing give identical results (`research verify`).
   Trades go to the second of their exchange event time; each second closes 100 ms after
   it ends, and a trade arriving later joins the second open when it arrived
   ([timing model](engine.md#timing-model)).
5. **Per-contract computation; rolls switch, never stitch.** Delivery months trade at
   different prices, so every candle, indicator, and outcome is computed within one
   contract. The front contract has the most volume in the previous complete session,
   switches at a session open, and only moves to a later month (`source.next_front`, the
   same in backtests and storage, `market.roll`). Each contract is computed from a lead of
   sessions before it becomes front, so its values have settled at the switch. The lead is
   derived from the stages' warm-ups, which follow from indicator parameters, and is at
   least 40 sessions ([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)). A
   warm-up covers an indicator until it forgets its starting point, not just its first
   value: hourly EMA(50) gives values after 2.2 sessions but needs about 7.6 to settle, and
   EMA(200) about 30. The views `market.continuous_bar_1s`, `continuous_bar_1m`,
   `continuous_candle_1m_1s`, and `continuous_candle_1h_1m` read each product as one series
   by taking every session from its front contract; only raw prices jump at a roll, flagged
   by `rolled`.

### Training across contracts (decided November 2, 2026)

- **One model, trained on examples pooled from every contract** (and later every product),
  not one model per contract. An example is one decision moment: the features then, and
  the outcome after it (a simulated trade or a return in basis points).
- **Each example lies entirely within one contract**: features from that contract's own
  history, outcome measured on the same contract. Outcomes last minutes and positions are
  closed before each session ends, while rolls happen at a session open, so no example
  spans a roll.
- **Examples come from front-contract sessions**; warm-up sessions only build indicator
  history. Examples need not form one continuous timeline.
- **Test by time.** Neighboring examples are nearly identical, so split chronologically,
  leave a gap (purge and embargo) between training and test periods, fit any rescaling on
  training data only, and evaluate a final holdout of the newest data once.
- **No price level or contract identity as an input.** A `sessions_since_roll` input is an
  option for lifecycle effects.
- **Live**: the model runs on the current front contract; the next one is computed in
  parallel during its warm-up and taken over at the roll.


## Where things stand

| Area     | State |
| -------- | ----- |
| Code     | Engine, windows, features, ML rows, UI, and database layer (PR #62); one-second ingestion with the continuous series (#63); stages with per-stage versions, derived lead, and carried prices (#70); minute stages and the engine on the stage graph (#74); hourly statistics (#75); minute and second volatility (#76, #77); backtests warmed for the stored lead (#80); **MBP-1 as the only source, book events in the engine, fills at the book** (this PR) |
| Data     | One year of MBP-1 (2025-11-09 to 2026-11-05) for GC, SI, PL, ES, YM, RTY in `data/databento/mbp-1/` (123 GB), checksums and full decode verified; NQ not downloaded; TBBO files deleted |
| Database | PostgreSQL 18 database `trading`, 102 GB: `0001_baseline` through `0005_second_volatility` applied; GC and SI rows of all seven stages **built from TBBO on November 4 and now stale** (the files and the source code changed). They are still correct for 2025-11-03 to 2026-10-30, but `ingest plan GC SI` reports all 12 contracts `stale` ("stored by other code or settings; use --rebuild") and will not extend them. The file registry lists the 1,866 MBP-1 files beside the 2,182 deleted TBBO files |
| Strategy | `bias_pullback` is an infrastructure baseline that loses money, not a candidate |
| UI       | Trading web on 4400 and API on 4401 under `~/git/local-dev`; plain `pnpm dev` uses 4400 and 8001. Runs saved before November 15 (TBBO fills) are hidden: the run format is now version 3 |

Stored rows ([ingestion](ingestion.md)): `market.bar_1s` holds each second's exact
statistics (OHLCV by aggressor side, CVD, sweeps, sizes, price path, and the book at trades:
spread, displayed size and orders, imbalance, effective spread); `market.candle_1m_1s`
holds the rolling `1m@1s` candle and 87 normalized features. `market.bar_1m` holds the same
statistics per minute, merged exactly from its 60 seconds, plus observed seconds and
one-second returns; `market.candle_1h_1m` holds the rolling `1h@1m` candle and 77 features,
`market.stats_1h_1m` 16 statistics of the same window (realized volatility, minute-return
moments, path, session levels), and `market.vol_1m` 26 volatility features of it (ATR horizons,
bullish/bearish and adverse-excursion ATR, extremes as levels, time-of-day and daily ATR);
`market.vol_1s` holds the same 26 for the `1m@1s` window plus realized volatility from its
one-second returns. Each is a stage with its own version and checkpoints
([pipeline](feature-pipeline.md)). The metrics follow the
[trade-metrics reference](trade-metrics-reference.md); about 40 of its entries are not stored
yet ([list](ingestion.md#metrics)) and can be added by rebuilding from the DBN files
([how](ingestion.md#adding-a-metric-or-feature)).

## The move to MBP-1 (November 15, 2026)

Paul replaced TBBO with MBP-1 for every product: the trades are the same, and the book
between trades shows what a simulated order would really have paid.

**What changed in the code**

- `catalog.py` reads `mbp-1` jobs as market data (`MARKET`); `data/sample/` and the MGC
  sample day are gone. `examples/gc-day.json` is the one-day example.
- `source.py`: `DayCache` decodes a day and keeps its trade records, plus every record when
  `book=True` (backtests). `session_book` returns a contract's book events for a session,
  including the closure before it, which builds the opening book.
- `market.py`: `BookEvents` beside `Trades`. `engine.py`: `MarketChunk.book`; the engine
  orders book events by second, then receive order, as it does trades, and
  `split_by_second` cuts them the same way.
- `execution.py`: a market order fills when it reaches the exchange, at the best ask or bid
  shown then (`BookView.at`). A stop fills at the book its triggering trade left, never
  better than the trigger. Targets still need a trade through the limit. An entry that
  meets no two-sided book is cancelled. Each trade records `decision_spread_ticks` and
  `entry_slip_ticks` ([timing model](engine.md#timing-model)).
- Removed: the unused `features.FeaturePipeline` (the B1 leftover) and its reference test.

**Checks**

- **Files:** all 1,878 files match their manifests (size and SHA-256), and all 1,866 data
  files decode completely: 5.94 billion records, 222.8 million trades, receive order sorted,
  no trade without a price or size ([data](data.md#what-we-have)).
- **Same trades as TBBO:** four whole sessions of MBP-1 trades (GCZ6 and SIZ6 2026-09-15,
  GCG6 2025-12-10, SIK6 2026-03-16) equal the stored second rows in status, OHLC, volume,
  buy and sell volume, and trade count for all 82,800 seconds each: 0 differences.
- **Same stored rows:** a pilot ingest from MBP-1 into a throwaway database (GCZ6 and SIZ6,
  2026-09-08 to 09-18, 18 contract-sessions in 47 s) equals the rows in `trading` byte for
  byte in every column of `bar_1s` (71 columns) and `bar_1m` (75), all 741,600 seconds and
  12,360 minutes per contract, and in every column of `candle_1m_1s` (106) from the second
  session on (the pilot's first session starts cold). The hourly and volatility stages need
  10 to 37 sessions of history, more than the pilot built.
- **Engine:** `research verify` on a real GC day (GCZ6 2026-09-15, 2.3 million book events):
  all 235 features and all 15 trades identical, whole session against second by second
  (402.7 s, 4.9 ms per second while other jobs ran; 2.3 GB). The engine parity tests pass
  with synthetic book events that arrive late and out of order.
- **A real day's costs:** GCZ6 2026-09-15 with `examples/gc-day.json`: 15 trades, entry
  slippage 1.0 tick on average (90th percentile 2.5) against the mid-price at the decision;
  200 would-be trades averaged 1.34 ticks. The session had 2,273,683 book events for 93,025
  trades, none one-sided and 12 crossed.
- **Tests:** `pnpm lint`, `pnpm test`, and `pnpm build` pass, including new tests for fills
  at the book, late book records, a one-sided book, and one real downloaded day.

**What it means for results.** Simulated fills no longer wait for the next trade. Every
entry now pays the spread it met about 150 ms after the signal second (100 ms to decide,
50 ms for the order to travel), and the run reports that cost in ticks. Runs saved before
this change priced fills at the next trade's book and are not comparable.

Local evidence uses the prefix `~/mbp1-conversion.`: `verify_mbp1.*` (checksums),
`decode_all.*` (every file decoded), `compare_stored.*` and `compare_pilot.*` (equality with
the TBBO-built rows), `verify-gc-day.json`, and `~/ingest-pilot-mbp1.log`.

## Rebuilding from MBP-1

Not done yet; it needs Paul's authorization because step 1 drops the stored rows.

1. Reset the database: drop the schemas `market`, `research`, `ml`, and `meta` (102 GB of
   derived rows, all rebuildable; the TBBO-built rows of 2025-11-03 to 11-07 have no MBP-1
   file and will not come back). Replacing rows in place would roughly double the space
   used until a `VACUUM FULL`, and only 47 GB is free.
2. `uv run research db migrate`, then `uv run research db register` (1,866 MBP-1 files).
3. `caffeinate -i uv run research ingest run GC SI --workers 8 2> ~/ingest-gc-si-mbp1.log`:
   expect about 35–45 minutes and about 105 GB (the November 4 runs took 24 minutes for the
   second tables plus 12 for the other stages; decoding MBP-1 days adds a little).
4. Check: a fresh `ingest plan GC SI` reports every contract `current`; coverage and the
   continuous views (257 front sessions per product, 2025-11-10 to 2026-11-06; the last has
   data only for its first hour, because the 2026-11-06 file was not available when the jobs
   were made); the first 37 front sessions are cold
   (`history_limited`), now starting 2025-11-10; NULL rates at each roll's first front
   session and in September; and equality with the old rows where both exist, which can be
   checked only if a copy of a few old partitions is kept before step 1.

## Earlier results (rows built from TBBO, November 3–5)

These sections are summaries; the full records, with every check and evidence file, are in
this file's history (`git show 1d1b3ac:docs/project/handoff.md`). MBP-1 trades are the same
records, so the findings carry over; row counts will shift by the one week the downloads
differ (TBBO began 2025-11-01, MBP-1 2025-11-08).

## Full-scale checks (after PR C2)

November 5, on `main` after #77: `research verify` on a GC and an SI week matched every one
of the 235 features and every trade, whole versus second by second, at about 4.1 ms per
market second; a GC year ran in 161 s with 2.6 GB. Backtests now warm each contract for the
stored lead, so a backtest started on a roll reproduces every stored row of all seven
stages bit for bit (a test keeps it so); `verify` compares an hour at a time (2.4 GB for a
week). One edge case waits for a `source.py` change: if a download started partway through a
session, a backtest whose warm-up reaches before it would read that partial session while
storage skips it. No download does this (MBP-1 starts on Saturday 2025-11-08)
([todo](todo.md#housekeeping)).

## PR C2 results (second volatility)

PR #77, run 6: `market.vol_1s`, 35,774,100 GC and 35,785,800 SI rows in 5 min 47 s, 24 GB.
An independent recomputation matched all 71,559,900 rows; the stage needs 37 sessions of
warm-up, so 220 of 257 front sessions per product were warm. `rv_atr` median 0.68;
`spread_atr` 0.15 GC and 0.23 SI: crossing the spread costs 15–23% of a typical minute's
true range.

## PR C1 results (minute volatility)

PR #76, run 5: `market.vol_1m`, 596,235 GC and 596,430 SI rows in 1 min 55 s, 0.42 GB. All
1,190,467 complete windows matched an independent recomputation. The daily ATR percentile
sets the 37-session warm-up.

## PR B2 results (hourly statistics)

PR #75, run 4: `market.stats_1h_1m`, one row per stored minute in 1 min 55 s, 0.35 GB; all
complete windows matched a reference. One-minute returns mean-revert slightly within the
hour (`vr_5` 0.89), and price follows net aggression (`cvd_close_corr` 0.61).

## PR B1 results (minute stages)

PR #74, run 3: `market.bar_1m` and `market.candle_1h_1m` in 2 min 29 s, 1.7 GB; every minute
equals the `candle_1m_1s` row at ordinal `60m`. `candle_1h_1m` needs 10 sessions (ADX).

## Baseline rebuild (GC and SI)

November 4, with Paul's authorization to reset the experimental database: the four project
schemas were dropped, `0001_baseline` applied, 2,182 files registered, and GC and SI built:
12 contracts, 868 contract-sessions, 71,559,900 rows per second table, 83 GB, 257/257 front
sessions per product. One contract (SIU6) stalled in a COPY for an unknown reason and was
rebuilt alone with `--workers 1`; no code changed.

## Rebuild with stages (GC and SI)

Run #2 (PR #70), replaced by the baseline rebuild: 23 min 44 s with 8 workers.

## Running ingestion

History: run #1 (November 3, 2026, 11 min 2 s) stored GC and SI with the one-builder code
and a 5-session lead; run #2 (November 4) rebuilt them with stages; the
[baseline rebuild](#baseline-rebuild-gc-and-si) then recreated them from scratch,
[run 3](#pr-b1-results-minute-stages) added the minute stages, and
[run 4](#pr-b2-results-hourly-statistics) the hourly statistics,
[run 5](#pr-c1-results-minute-volatility) the minute volatility, and
[run 6](#pr-c2-results-second-volatility) the second volatility.

To check current coverage or extend after new downloads:

```sh
uv run research db status
uv run research ingest status
uv run research ingest plan GC SI
caffeinate -i uv run research ingest run GC SI 2> ~/ingest-gc-si-next.log
```

Inspect a session's report and source conditions with:

```sql
SELECT c.raw_symbol, s.trade_date, s.missing, s.report, s.source_files
FROM market.ingest_slice s JOIN market.contract c ON c.id = s.contract_id
WHERE s.trade_date IN ('2025-11-28', '2026-03-16', '2026-04-10');
```

**If it fails** (non-zero exit, `"status": "partial"` or `"failed"`, or a `FAILED` line in
the log), stop and read the log and `research ingest status` (recent runs keep the error).
Stored sessions stay intact and readable: each session is written in one transaction, so
fixing the cause and rerunning `ingest run GC SI` resumes where it stopped.

| Symptom                                    | Cause and remedy                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `Database migrations not applied`          | `uv run research db migrate`                                                      |
| `... is being built by another ingest run` | Another run holds that contract; wait for it or stop it                           |
| `No space left on device` or a COPY error  | Free disk space, then rerun                                                       |
| `Checksum mismatch` for a file             | Re-download that file's job; `research catalog --verify` lists the failures       |
| `... cover different parts of this day`    | Two jobs split a UTC day; download that day in one job                            |
| Plan shows `stale` or `needs_rebuild`      | Code or earlier files changed since rows were built; rerun with `--rebuild`       |
| `unresolved_sessions` is not empty         | Those sessions have no volume in their download; check their files and conditions |
| Anything else, or values that look wrong   | Stop; report the log excerpt, contract, and session; do not delete rows by hand   |

All stored rows can be rebuilt from the DBN files (`--rebuild`), so a failure never needs
manual database repair.


## Decisions

The core rules above, plus:

| Decision                                                                                             | Why                                                                                                                             | Details                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Prototype with GC and SI                                                                             | Liquid, and far smaller than NQ or ES (GC 32M and SI 13M trades a year against NQ's 103M)                                       | [Data](data.md#what-we-have)                                                     |
| MBP-1 only, the same rules for every product (November 15, 2026, replacing TBBO) | The same trades, plus every change to the best bid and ask, so an order fills at the book it would have met and its cost is measured. The price is size: 123 GB a year for six products | [Data limits](engine.md#data-limits-mbp-1) |
| DBN files are the permanent archive; PostgreSQL holds everything derived                             | Every stored value can be rebuilt or extended; SQL for research; no Parquet layer                                               | [Data](data.md#storage), [storage](../../lib/db-research/README.md)              |
| Store each second's base row and its `1m@1s` candle with features; NULL when undefined, never zero   | Research and ML read compiled rows; base rows stay mergeable into any window; missing, quiet, and invalid stay distinct         | [Ingestion](ingestion.md)                                                        |
| Store features as `double precision`, not `real` (decided November 2, 2026)                          | Stored features equal in-memory and live values exactly; disk space is not a concern                                            | [Measured](ingestion.md#measured)                                                |
| Event-time assignment and per-phase indicators confirmed against the trade-metrics reference (November 2, 2026) | Stored rows equal what backtests and live sessions compute; the two clocks disagree on about 1 trade in 2,000                   | [Differences](ingestion.md#differences-from-the-handoff)                         |
| A builder identity per stage covers its code, settings, packages, columns, and inputs (PR A)         | Rows never mix code versions; a changed stage and those reading it are `stale`, the others stay current, new stages are added   | [Ingestion](ingestion.md#what-the-plan-decides), [pipeline](feature-pipeline.md) |
| Fills at the MBP-1 book the order meets (market orders at arrival, stops at the book their trigger left and never better than it, trade-through targets) | Costs are what the book showed, not an estimate; every setting is recorded with the run | [Timing model](engine.md#timing-model) |
| Databento `definition` records for contract metadata                                                 | Free for this data; expirations, tick sizes, and multipliers                                                                    | [Data](data.md#what-we-have)                                                     |
| uv with Python 3.13, numba, psycopg 3, numbered SQL migrations; `research-web` is the only UI        | Reproducible environments, fast batch runs, simple schema history; checking backtest logic matters most now                     | [README](../../README.md), [UI](metric-explorer.md)                              |


## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog --verify         # DBN files against their checksums (123 GB: minutes)
uv run research db migrate               # schema migrations
uv run research ingest plan GC SI        # what would be stored; then: run GC SI, status
uv run research backtest apps/backtest-runner/examples/gc.json
uv run research verify apps/backtest-runner/examples/gc-day.json
pnpm lint && pnpm test && pnpm build
```

After downloading MBP-1 files, add the job folder under `data/databento/mbp-1/` unchanged,
then `catalog --verify` and `ingest run`: contracts are extended from their checkpoints and
changed files are rebuilt ([new downloads](ingestion.md#run-it)).

## PR B: `1h@1m` rows

The design is in [plan section 5](plan-1h-and-pivots.md#5-1h1m-amendments-to-the-proposed-plan)
and the [feature pipeline](feature-pipeline.md#stages). PR B is split in two.

**B1: done (PR #74; [results](#pr-b1-results-minute-stages)).**

- `stage_bar_1m.py`, stage `bar_1m` (tier 0, input `bar_1s`): one row per scheduled-open
  minute, `slot_ordinal` = m (seconds `60m − 59 … 60m`; asserted equal to the second
  ordinal ÷ 60). OHLCV from `bars.combine`; the metric fields from `combine_metrics`, which
  applies `MetricWindow`'s rules within each minute. Extra fields: `observed_seconds`,
  `session_cvd` at the minute's last second, and `ret2_sum`, `ret_count`, `first_close` for
  realized volatility. An unfinished minute waits in the checkpoint (`pending*`).
- `stage_candle_1h_1m.py`, stage `candle_1h_1m` (tier 1, input `bar_1m`): `WindowFeatures(BIAS)`,
  `MetricWindow(60)`, and `CandleIndicators(60)` on the minute rows; `active_ratio` =
  observed seconds ÷ 3,600; 77 features. Its derived warm-up is 217 hourly periods (ADX):
  10 sessions, inside the 40-session lead.
- Migration `0002_minute_rows`: the two tables and `continuous_bar_1m`,
  `continuous_candle_1h_1m` (minute bounds `(first_ordinal + 59) / 60 … last_ordinal / 60`).
- Ingest deletes each table's rows of a session at its own resolution (`store.row_bounds`);
  a test rebuilds a stale minute stage alone. `ANALYZE` covers only the tables written.
- The engine reads its features from the stages (`pipeline.StageFeatures`); whole-session and
  second-by-second runs stay identical, and its `1m@1s`/`1h@1m` window features and bracket
  ATR equal the previous composition bit for bit.

Decisions made in B1 (derived, reported in the PR):

- **The stored second rows stayed current**: no module in the identity of `bar_1s` or
  `candle_1m_1s` changed. Two leftovers wait for the next rebuild of `candle_1m_1s`, when
  `features.py` and `stage_candle_1m_1s.py` may change anyway: delete the unused
  `features.FeaturePipeline` (now only a test reference), and publish the `1m@1s` ATR in
  price units from the stage (`products["atr"]`) so `pipeline.FastAtr`, which records it
  by wrapping the stage's window update, can go.
- **A missing minute** (any missing second) stores only its keys and status and contributes
  nothing to windows, so stored and in-memory values agree.
- **`candle_1h_1m` leaves out** the session features and the whole latest-observation family
  (`trade_age_s`, `book_age_s`, `depth_age_s`, `book_spread_bps`, `book_imbalance`): at a
  minute's end they repeat the second row at `60m`.
- **Engine cost**: the second-by-second path now computes every stored feature, about 4 ms
  per second (inside the 100 ms close delay); `research verify` on one session takes about
  6 minutes, and the engine parity test 77 s per case.

**B2: done (PR #75; [results](#pr-b2-results-hourly-statistics)).**
[Plan 5.4](plan-1h-and-pivots.md#5-1h1m-amendments-to-the-proposed-plan)'s hourly-only
metrics as a new tier-1 stage, `stage_stats_1h_1m.py`, stage `stats_1h_1m` (inputs `bar_1m`
and `candle_1h_1m`, a declared edge within tier 1), with its own table and continuous view
(migration `0003_hour_stats`). One row per minute for the window of minute rows `m − 59 … m`;
16 features, NULL unless the hourly window is complete:

- `rv_bps`, `rv_atr`: realized volatility from one-second returns (each minute's `ret2_sum`
  plus the bridge `ln(first_close_m / close of the previous observed minute)`, excluding the
  bridge into the window's first observed minute), in bps and against the hourly ATR;
- `ret_std_bps`, `ret_skew`, `ret_autocorr`, `vr_5` (Lo–MacKinlay, overlapping, bias-corrected),
  `up_minute_ratio`: the window's minute returns;
- `drawdown_atr`, `drawup_atr` (the candle window's exact path fields), `high_pos`, `low_pos`
  (where the first trade at the high or low fell: 0 oldest second, 1 newest);
- `session_vwap_atr`, `prior_high_atr`, `prior_low_atr`, `prior_close_atr`: the close against
  the session VWAP and the previous session's levels, in hourly ATR;
- `cvd_close_corr`: minute closes against the window's cumulative buy − sell volume.

Context columns: `rv_returns`, `minute_returns`, `session_vwap`, `prior_high`, `prior_low`,
`prior_close`.

Decisions made in B2 (derived, reported in the PR):

- **A new stage, not `candle_1h_1m` columns**, so `candle_1h_1m` stays current while these
  metrics evolve. It reads its inputs' rows (`products["tables"]`), not their modules, so no
  file in another stage's identity changed.
- **Windows are self-contained**: minute returns run between consecutive minute closes inside
  the window, carried through minutes without trades from its first observed minute (59 when
  the oldest minute traded), mirroring the bridge rule. The return statistics and the flow
  correlation need 10 returns (two VR(5) horizons); up minutes count among minutes whose close
  changed.
- **Sessions** are the calendar's intervals, as for `session_cvd`; VWAP and a session's levels
  are undefined after missing data in it or when the stage did not see it from its open, and
  the previous session counts only when it is the interval just before.
- **Warm-up** (derived): the hourly ATR(14), 108 periods = 5 sessions; `candle_1h_1m`
  (10 sessions) still sets the requirement, inside the 40-session lead.
- **NULLs reach the engine as NaN** (`StageFeatures.read`, from the PR #75 review): this
  stage keeps NaN behind its NULLs, and the engine applies every table's NULL masks.

## PR C: volatility tier

The specification is [plan section 7](plan-1h-and-pivots.md#7-volatility-tier-atr-family),
with Paul's decisions in [section 6](plan-1h-and-pivots.md#6-decisions) (items 2, 4, and 6).
It adds the stages `vol_1s` and `vol_1m` (tier 1; inputs in the
[feature pipeline](feature-pipeline.md#stages)) as new tables only: every stored stage stays
current. No fundamental question is open; decide the derived details and report them. Ask
Paul only if a warm-up chain needs more than the 40-session lead, since raising the lead
rebuilds every stage.

**Split**, as B was split:

- **C1: `vol_1m`: done (PR #76; [results](#pr-c1-results-minute-volatility)).** The
  per-window calculations are in `strategy_core/volatility.py` (`split_atr`, `TimeOfDay`,
  `DailyScale`, Parkinson and Garman–Klass), the stage in `stage_vol_1m.py`, migration `0004`.
  26 features and the context columns `atr_price`, `atr_usd`.
- **C2: `vol_1s`: done (PR #77; [results](#pr-c2-results-second-volatility)).** The stage in
  `stage_vol_1s.py` (inputs `bar_1s`, `candle_1m_1s`), `volatility.py` unchanged, migration
  `0005`. The same 26 features plus `rv_bps` and `rv_atr` (realized volatility from the window's
  one-second returns), context `atr_price`, `atr_usd`, `rv_returns`; joined into the engine's
  `1m@1s.` features row by row.

Decisions made in C1 (derived, reported in PR #76): averages (horizons, bull/bear, adverse,
time-of-day) are defined like the ATR, for complete and carried empty windows; values of the
window and the session so far need a complete window; the daily ATR and its percentile belong to
the session. A daily true range needs a complete session whose previous interval was complete;
each is stored in bps of its own close, and `day_range_ratio` uses the session's true range so
far from the previous close. The percentile is decision 6's reading (the daily ATR among its
previous 20 values, ties half). Ages at `1h@1m` equal 3599 × (1 − `stats_1h_1m.high_pos`), kept
so both resolutions share columns. Dollars per contract come from the contract symbol's product.

Decisions made in C2 (derived, reported in PR #77): `stage_vol_1s.py` imports nothing from the
minute branch (it repeats the five-line `usd_per_price`), so the resolutions stay independent
branches. Time-of-day samples are the `1m@1s` ATR at ordinal `60m`; every second of a minute
compares its own phase's ATR with that minute's samples from earlier sessions. The daily scale is
computed from the second rows (`DailyScale(calendar, SECOND, 14, 20)`) and equals `vol_1m`'s at
every minute end. Realized volatility needs a complete window with at least one return (two
observed seconds), like `stats_1h_1m.rv_bps`. `vol_1s.atr_price` is the `1m@1s` ATR in price units;
after C2 the engine reads it for brackets instead of `pipeline.FastAtr`, which is gone.

**What each stage stores**, per window, from same-phase windows like ATR, normalized, NULL
unless defined:

1. **Horizons:** ATR(5) and ATR(50) in bps, `log(ATR5 / ATR14)`, `log(ATR14 / ATR50)`.
   ATR(14) is already `atr_bps` in the candle tables: read it, do not store it again. Hourly
   ATR(50) settles after 392 periods, about 17 sessions.
2. **Bullish and bearish ATR:** Wilder(14) of `2 × down` and `2 × up`, where `up` and `down`
   split each true range from `P₀`, the previous same-phase window's close (the `prev` that
   `kernels.wilder_atr` keeps), or the window's first trade when there is none. Use the
   ATR's own inputs (`Candles.analysis()`: complete windows, and empty ones at the carried
   price), its seeding (the mean of the first 14, then Wilder), and its reset after a missing
   window, so `(bull + bear) / 2` equals `atr_bps`: test that to rounding. Their skew
   `(bull − bear) / (bull + bear)`.
3. **Adverse excursion:** per window, long `max(drawdown, P₀ − low)` and short
   `max(drawup, high − P₀)` from the window's exact path fields (`products["window"]` and
   `products["hour_window"]`, `MetricWindow` output); their Wilder(14) averages in bps, and the
   current window's excursions in ATR.
4. **The window's extremes as levels:** `high_dist_atr`, `low_dist_atr`, `high_age_s`,
   `low_age_s` (counted in rows, never clock time), `extreme_order`. `stats_1h_1m` already
   stores where the hourly high and low fell (`high_pos`, `low_pos`).
5. **Time-of-day normal:** `log(ATR / mean of the same session minute's samples over the
previous 20 sessions)`, keyed by the minute's offset in scheduled-open minutes from the
   session's open; one sample per minute (`vol_1m`: the `1h@1m` ATR at the minute row;
   `vol_1s`: the `1m@1s` ATR at ordinal `60m`). The checkpoint holds at most 1,380 × 20 values.
6. **Daily scale:** the mean true range of the prior 14 complete sessions (bps; the previous
   session's close as `P₀`; within the contract, never across a roll), the session's range so
   far as a share of it, distances to the session high and low in daily ATRs, and the daily
   ATR's percentile among its previous 20 values: decision 6's 35-session chain. (Section 7
   says "the ATR's percentile within its own trailing sessions"; confirm that reading in the
   PR.) Sessions are the calendar's intervals, as for `session_cvd` and `stats_1h_1m`.
7. **The current window:** true range ÷ ATR; Parkinson and Garman–Klass volatility in bps;
   spread ÷ ATR (`spread_bps / atr_bps` of the candle row); at `1m@1s`, realized volatility
   from the window's one-second returns ÷ ATR (the `1h@1m` one is `stats_1h_1m.rv_atr`).
8. **Risk context, never features:** ATR in price units and in dollars per contract, as
   context columns for stops and sizing.

**Warm-up** ([derived](feature-pipeline.md#warm-up-is-derived-never-typed)):
`Stage.warmup()` is in scheduled-open seconds, and `stages.py` is in every stage's identity, so
do not change it. For a chain counted in sessions, declare sessions × 86,400 s (no session is
longer than a day, as `stats_1h_1m.DAY_SECONDS` does); the planner rounds up with the
product's typical session. The daily chain, 15 + 20 = 35 sessions, becomes 37 typical GC
sessions, inside the 40-session lead.

**How: the B2 procedure, which worked** (PR #75):

1. **New modules only.** A stage reads its inputs' rows from `products["tables"][name]` and
   their in-memory products (`bars`, `minutes`, `candles`, `window`, `hour_candles`,
   `hour_window`, …), never by editing their modules. A same-tier input is a declared edge:
   list it in `INPUTS` and register the stage after it in `pipeline.STAGES`.
2. **Determinism.** Leave NaN behind NULL floats in `Table.values` (the engine also reads NULL
   as NaN, `StageFeatures.read`). Compute floats in one fixed order (numba loops per window
   and per phase; running sums with the carry prepended), so any chunking gives identical bits.
3. **The engine.** Join `vol_1s` into the `1m@1s.` features row by row with `candle_1m_1s`, and
   add `vol_1m` to `StageFeatures.HOURLY`; names must not collide within a prefix (test it).
4. **Tests,** as `lib/strategy-core/tests/test_hour_stats.py`: direct references (plain-Python
   Wilder averages, like `helpers.wilder_rsi_reference`, and values from the trades); any
   chunking (`[1, 7, 59, 61, 300, 1, 1000]` seconds) and checkpoints inside a minute; the
   two-start warm-up test (agrees at the declared warm-up, differs at half); scale invariance
   (prices ×3, sizes ×7); the engine's view. In `test_ingest.py`, stub the new warm-ups in the
   `world` fixture (it has five sessions), and update `SLOT_SECONDS`, the plan reasons,
   `warm_sessions`, and an "added alone" test like `test_the_hourly_statistics_are_added_alone`.
5. **Before migrating,** compute the stage identities on the branch (`ingest.identities`) and
   check that every existing stage's `sha256` is already in `market.builder` with stored
   slices; only the new stage may be new.
6. **Pilot** on a throwaway `trading_test_*` database: build GC 2026-07-20..08-05 with `main`
   (a detached worktree with `uv sync --frozen`), migrate with the branch, require `ingest plan`
   to show only `add` for the new stage, run it, recompute it independently from the stored
   rows (adapt `~/ingest-gc-si-b2.reference.py`), mark it stale and `--rebuild` it alone
   (byte-identical by `md5(string_agg(...))`), then drop the database.
7. **Open the PR ready for review,** and apply the migration to `trading` only after Codex has
   reviewed the code head: an applied migration cannot change. Then
   `ingest run GC SI --workers 8`, a fresh plan (`current`), the SQL checks (adapt
   `~/ingest-gc-si-b2.validation.sql`: coverage, keys equal the candle table, the continuous
   view, warm, NULL rates at each roll's first front session and in September, bounds), the
   full-year reference, `research verify`, `pnpm lint && pnpm test && pnpm build`, the docs,
   and a prompt merge.

Practical notes: a worktree's `node_modules` can be stale (`pnpm install --frozen-lockfile
--config.confirmModulesPurge=false`); session scratch folders can vanish when a session is
interrupted, so keep scripts and evidence under `~/ingest-<name>.*`; `research verify` takes
about 6 minutes; `~/.agents/skills/git-management/scripts/pr-context.py` reports whether
Codex's review covers the head.


## Next steps

The order follows the [roadmap](roadmap.md#next) and the decisions of November 3
([plan](plan-1h-and-pivots.md#6-decisions)):

1. **Rebuild from MBP-1** ([how](#rebuilding-from-mbp-1)), once authorized.
2. **Swing structure (PR D)**: directional-change pivots at 0.5, 1, and 2 ATRs on both
   resolutions with higher/lower highs and lows, after the storage question in
   [Start here](#start-here-next-session) is settled.
3. **Labels and the benchmark (PR F), the reversal model, structure signals (PR E).**
   Recommended: F before E ([roadmap](roadmap.md#next)); Paul decides.
4. **Book stage `book_1s`** (tier 0, from book events) and **`pair_1m`** for GC + SI.
5. **Training data**: store the would-be trades (ML rows) from front-contract sessions in
   PostgreSQL, then a training pipeline that follows
   [training across contracts](#training-across-contracts-decided-november-2-2026).
6. **Backtests read stored rows** when the builder matches, for speed only.
7. **Contract definitions**: download the free `definition` job into
   `data/databento/definition/` (needs the account owner) and load expirations.
8. **NQ**: download its MBP-1 year when disk allows (about 50 GB), then ES + NQ as a pair.

Pivot work: the [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design) sets the
observations (the trade path, published per second and per minute), thresholds, segments,
storage, and labels; the [pivot/structure contract](pivot-structure-design.md) defines
higher/lower highs and lows, trend, provisional relations, and breaches. Research history:
the [next-agent handoff](pivot-detection-handoff.md) and its saved research. The methods
remain unimplemented and unvalidated on GC/SI.

## Open questions

1. **Disk.** The archive is 123 GB and the database 102 GB, with 47 GB free on a 926 GB
   disk. NQ (about 50 GB), `pivot_1s` at three scales (50–75 GB), `book_1s`, and any third
   product do not fit. Options: an external or larger disk for the DBN archive (it is read
   sequentially and rarely), storing fewer second-resolution tables, or building products
   in turn. The November 3 decision "disk is not a constraint" no longer holds.
2. **Order of E and F**, and whether the reversal model's output should feed the structure
   signals ([roadmap](roadmap.md#layers-3-and-4-predictions-that-later-layers-read)).
3. **Which products next.** PL, YM, RTY, and ES are on disk. A pair needs both legs: YM or
   RTY could pair with ES before NQ arrives.
4. Which unstored reference metrics to add first, and which training outcome to use
   (simulated bracket trade or fixed-horizon return)?

## Things to know

- Review findings on the ingest planner have reached rare edge cases. The bar for changes:
  fix what can silently corrupt stored values or the series; refuse loudly for unusual
  setups (as for split-day downloads); decline hypotheticals with a test that shows why.
  Prefer rebuilding a contract (cheap: minutes) over more incremental-repair logic.
- Any edit to a file in a stage's identity (its `MODULES`, such as `bars.py`, `metrics.py`,
  `windows.py`, `window_metrics.py`, `kernels.py`, `indicators.py`, `features.py`, `market.py`,
  `stages.py`, `columns.py`, `state.py`, `warmup.py`, or `codec.py`) makes that stage and
  every stage reading it `stale`; the second tables (about 100 GB) then need a rebuild. Run
  `ingest plan GC SI` before merging such edits, and batch them into one planned rebuild.
- The stored rows describe the book only as trades saw it. In quiet SI seconds (80% of
  them) that book is as old as the last trade; features carry that age (`trade_age_s`;
  `book_age_s` and `depth_age_s` for the last trade with a usable book and displayed
  sizes). Fills do not have this limit: they read every book event. The `book_1s` stage
  will give features the same view.
- Book events are about 20 to 60 times the trades (GC 2.4 million records a day, ES 8.7
  million). A session's book for one contract takes about 0.2 GB in memory for GC; a
  backtest loads it only for sessions that trade, never for warm-up sessions.
- CVD needs an origin: rows store per-second net delta and its extremes, and
  `session_cvd` from the session open (NULL after missing data). Unknown-side volume
  (about 3% in metals, spread legs) stays out of it.
- Data quality: 2025-11-28 (CME outage) and six other dates are `degraded`; on that day
  most NQ, YM, and RTY records flag a possibly wrong book. Stored rows record each file's
  condition and flagged trades per second.
- There is no queue model for limit orders (that needs MBO), and no live data or broker
  adapter yet.

## Environment

- PostgreSQL: `brew services start|stop postgresql@18`; data in
  `/opt/homebrew/var/postgresql@18`; override the connection with `TRADING_DATABASE_URL`.
- uv uses its default cache, `~/.cache/uv`.
- `DATABENTO_API_KEY` is exported by `~/.secrets.sh`, which `~/.zshenv` loads; the code
  does not use it yet (the live feed will).
- Agents may stop and restart local-dev services when a task needs it (`~/git/AGENTS.md`;
  ports in `~/git/local-dev/config.json`).
- Never print full process command lines on this Mac: some processes carry secrets in
  their arguments.
