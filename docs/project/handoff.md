# Handoff

As of November 4, 2026. Start here, then read [AGENTS.md](../../AGENTS.md). Tasks are
tracked in [todo.md](todo.md); this page explains the architecture, the decisions behind
it, where the work stands, and exactly how to continue.

## Start here (next session)

1. **Merge PR B1 (#74) first.** It adds the minute stages `bar_1m` and `candle_1h_1m`,
   migration `0002_minute_rows`, and moves the engine onto the stage graph. `0002` is already
   applied to `trading` and GC/SI minute tables are built and verified
   ([results](#pr-b1-results-minute-stages)), so `main` cannot run `research db` or
   `research ingest` until #74 is merged; branches made before it must rebase.
2. **Then build PR B2**, the hourly-only metrics ([below](#pr-b-1h1m-rows)), as new
   `candle_1h_1m` columns (migration `0003`, rebuilding only that stage) or a new tier-1
   stage. The second and minute base tables stay current either way.

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
history, then run them live on the same code. A rolling `1h@1m` candle (the last 60
one-minute rows, every minute) sets a direction bias that only rules out a direction;
rolling `1m@1s` features (the last 60 one-second rows, every second) time entries; a
bracket sized in ATRs exits within minutes. Prototype with GC (gold) and SI (silver), then
add products. Models train on at least a year of history.

## Architecture

```text
data/databento/tbbo/*.dbn.zst      Permanent tick archive: Databento TBBO, one file per day
        │                          and product, gitignored (data/README.md)
        │  catalog.py (files, checksums), source.py (one contract's trades per session)
        ▼
lib/strategy-core                  The same code for history and live sessions
  bars.py, metrics.py              Trades → one row per scheduled second, exact statistics
  windows.py, window_metrics.py    Rolling candles: rows o − 59 … o
  kernels.py, indicators.py        Per-phase indicators: candles o, o − 60, o − 120, …
  features.py                      Normalized features (Unit), engine.py strategies and fills
  stages.py, stage_*.py            Stages: one stored table each, versioned on its own
  pipeline.py, state.py, warmup.py Tier-ordered pipeline, exact checkpoints, derived warm-ups
        │                                      │
        ▼                                      ▼
Engine: backtests and rehearsals      research ingest → PostgreSQL `trading`
(research backtest, verify)           one table per stage, per contract:
                                        bar_1s, bar_1m (tier 0)
                                        candle_1m_1s, candle_1h_1m (tier 1)
                                        next: B2 hourly metrics, vol_* (C),
                                        pivot_* (D), signal_* (E), pivot_label (F)
                                      market.continuous_*                  (per product)
                                                  │
                                                  ▼
                                      ML training (next): one model on pooled examples
```

`apps/backtest-runner` holds the data adapters, calendars, ingestion, CLI (`research`), and
the local API; `apps/research-web` is the UI (run setup, results, trade inspector).

**Stages** ([feature pipeline](feature-pipeline.md)): each stored table is a `Stage`
(`strategy_core/stages.py`) in its own module (`stage_bar_1s.py`, `stage_bar_1m.py`,
`stage_candle_1m_1s.py`, `stage_candle_1h_1m.py`), registered in tier order in
`pipeline.STAGES`. A stage declares its inputs, columns (with
roles and units), `MODULES` (hashed into its builder identity), settings, checkpoint state,
and `warmup()` in scheduled-open seconds. `Pipeline` runs them per chunk and passes in-memory
products (bars, metrics, candles) downstream. Ingest (`apps/backtest-runner/.../ingest.py`)
computes every stage from the DBN files but writes only stages that are not current;
`market.ingest_slice` is the per-session source record, `market.stage_slice` holds each
stage's builder, checkpoint, and `warm` flag, and the lead is derived from the warm-ups
(at least 40 sessions). The engine reads its features from the same stages
(`pipeline.StageFeatures`, PR B1): every `candle_1m_1s` feature as `1m@1s.<name>` and every
`candle_1h_1m` feature of the latest completed minute as `1h@1m.<name>`, with `1h@1m.age_s`.

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

| Area     | State                                                                                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Engine, windows, features, fills, ML rows, UI, and database layer (PR #62); one-second ingestion with the continuous series (PR #63); stages with per-stage versions, derived lead, and carried prices (PR #70); baseline schema and cleanup (PR #71); minute stages and the engine on the stage graph (PR #74, B1, awaiting merge) |
| Data     | One year of TBBO (2025-11-01 to 2026-10-31) for GC, SI, PL, ES, NQ, YM, RTY in `data/databento/tbbo/` (7.3 GB), verified and registered                                                                                                                                                                                             |
| Database | PostgreSQL 18 database `trading`: `0001_baseline` and `0002_minute_rows` applied; GC and SI: 71,559,900 rows per second table ([baseline](#baseline-rebuild-gc-and-si)), 1,192,665 per minute table ([B1](#pr-b1-results-minute-stages))                                                                                            |
| Ingest   | Baseline rebuild completed November 4 (runs 1–2); run 3 added the minute stages in 2 min 29 s; 40-session lead, 257/257 front sessions per product; every stage `current`                                                                                                                                                           |
| Strategy | `bias_pullback` is an infrastructure baseline that loses money, not a candidate                                                                                                                                                                                                                                                     |
| UI       | Trading web on 4400 and API on 4401 under `~/git/local-dev`; plain `pnpm dev` uses 4400 and 8001                                                                                                                                                                                                                                    |

Stored rows ([ingestion](ingestion.md)): `market.bar_1s` holds each second's exact
statistics (OHLCV by aggressor side, CVD, sweeps, sizes, price path, and the book at trades:
spread, displayed size and orders, imbalance, effective spread); `market.candle_1m_1s`
holds the rolling `1m@1s` candle and 87 normalized features. `market.bar_1m` holds the same
statistics per minute, merged exactly from its 60 seconds, plus observed seconds and
one-second returns; `market.candle_1h_1m` holds the rolling `1h@1m` candle and 77 features. Each is a stage with its own
version and checkpoints ([pipeline](feature-pipeline.md)). Historical run #2 rebuilt GC and SI
with a 40-session lead in 23 min 44 s with 8 workers and used 80.84 GB including indexes
([measurements](ingestion.md#measured)). The metrics follow the [TBBO engineering handoff](tbbo-engineering-handoff.md);
about 40 of its entries are not stored yet ([list](ingestion.md#metrics)) and can be added
by rebuilding from the DBN files ([how](ingestion.md#adding-a-metric-or-feature)).

## PR B1 results (minute stages)

Completed November 4, 2026, from PR #74 (commit `01d6468`). `0002_minute_rows` was applied
to `trading`, then `ingest plan GC SI` showed `add` for all 12 contracts (stages without
stored rows: `bar_1m`, `candle_1h_1m`) with the second-stage builders unchanged. Run 3
(`ingest run GC SI --workers 8`) ended `done` in 2 min 29 s, writing only the minute
tables; the second tables' stage records still come from runs 1 and 2. Builders: GC `bar_1m`
`41967a31250d`, `candle_1h_1m` `5cd0de07564d`; SI `bar_1m` `026f53219f72`, `candle_1h_1m`
`5f2db22f0c45`.

- **Coverage:** 596,235 GC and 596,430 SI minutes in each minute table, exactly the stored
  seconds ÷ 60; no missing minutes; the continuous minute views hold 353,100 minutes per
  product (257/257 front sessions, every scheduled minute once). A fresh plan reports every
  contract `current`.
- **Equal to the second rows:** every minute equals the `candle_1m_1s` row at ordinal `60m`
  on OHLC, high/low times, volume, sides, trades, observed seconds, delta extremes, VWAP, and
  status, and `bar_1s.session_cvd` there: 0 differences (SQL over the whole year). For all
  868 sessions, every metric field, `observed_seconds`, and `session_cvd` equal
  `MetricWindow(60)` computed from the stored second rows at each minute end (1,192,665
  minutes, 0 failures).
- **Warm and rolls:** `candle_1h_1m` needs 10 sessions (217 hourly periods: ADX). 247/257
  front sessions per product are warm; the cold ones are the first 10 downloaded sessions
  (2025-11-03 to 11-14, GCZ5 and SIZ5, `history_limited`). The first session of each of the
  five later rolls per product (GC: GCG6 through GCZ6 on July 30; SI: SIH6 through SIZ6) is
  warm with 0.00% NULL `rsi`, `ema50_atr`, `adx`, `aroon_up`, and `macd_signal_atr`, as are
  all September front sessions.
- **Size:** `bar_1m` 0.62 GB and `candle_1h_1m` 1.05 GB including indexes.
- **Pilot first:** a throwaway database built GC 2026-07-20..08-05 with `main`, then added the
  minute stages with this code (`add`, 0.5 s per session) and rebuilt a stale `bar_1m` alone:
  0 differences, second rows untouched. Dropped afterwards.
- **Engine:** `research verify` on the MGC sample day matched all 165 features and 13 trades;
  second by second took 350 s (about 4 ms per second, 54 s before), whole session 0.93 s.

Local evidence uses the prefix `~/ingest-gc-si-b1`: `.plan.json`, `.log`, `.summary.json`,
`.validation.txt` (SQL checks), and `.reference.json` (the `MetricWindow(60)` check); the
pilot's are `~/ingest-pilot-b1-*`.

## Baseline rebuild (GC and SI)

Completed November 4, 2026, after merging PR #72 (`f268369`). Paul explicitly authorized
resetting the experimental database. The four project schemas were dropped, `0001_baseline`
applied unchanged, and all 2,182 files registered. Before the reset, every file passed its
size/checksum verification (7.28 GB, no missing files); the migration and registry tests
passed on throwaway databases.

The initial 8-worker ingest completed 11 contracts, but SIU6 stalled in its first
`candle_1m_1s` COPY. Its PostgreSQL connection was waiting for client data while the client
was polling; the cause is not established. Only that connection was terminated, rolling
back its unfinished session. The first run ended `partial` after 14 min 47 s. Rerunning
`ingest run GC SI --workers 1` left the 11 completed contracts current and built only SIU6's
84 sessions; the retry ended `done` after 3 min 29 s, including ANALYZE. No source or stage
code was changed to recover.

- **Coverage:** 12 contracts, 868 contract-sessions, 71,559,900 rows in each second table;
  257/257 front sessions published per product; zero missing scheduled rows. A fresh
  `ingest plan GC SI` reports every contract `current`.
- **Warm-up and roll:** only the first downloaded front session, 2025-11-03, is not warm
  for `candle_1m_1s`, in both products. July 30 switches GCQ6 to GCZ6; RSI, ATR, EMA(21),
  and Aroon are defined throughout the two surrounding sessions.
- **Feature completeness:** September front-session NULL rates are 0.00% for `rsi`,
  `ema50_atr`, `aroon_up`, and `flow_price_corr`, in both products.
- **Exact replay:** GCZ6 2026-09-15 and SIK6 2026-03-16, restored from their previous
  stage checkpoints and recomputed from DBN, match binary COPY output exactly for all
  70 base-stage columns and 105 candle-stage columns (82,800 rows per stage/session).
- **Quality:** stored source conditions match the file registry, including the degraded
  files on 2025-11-28, 2026-03-16, and 2026-04-10.
- **Size:** fresh partitions including indexes: `bar_1s` 21.28 GB,
  `candle_1m_1s` 61.79 GB, 83.07 GB total (decimal).
  No `VACUUM FULL` was needed.

Local evidence uses the prefix `~/ingest-gc-si-baseline-20261104`: `.log` and
`.summary.json` for the initial partial run, `-resume.log` and `-resume.summary.json` for
the completed retry, `.plan.json`, `.validation.json`, and `.parity-GC.json` / `.parity-SI.json`.
Run #2's older `ingest-gc-si-pra` logs were removed after verification.

## Rebuild with stages (GC and SI)

Historical run #2, replaced by the [baseline rebuild](#baseline-rebuild-gc-and-si),
which reproduces its coverage and validation results.
Completed November 4, 2026, from PR #70 (commit `ca6cb53`) after migration `0004` was applied
to `trading`. Run #2 (`ingest run GC SI --rebuild --workers 8`) exited 0 with `"status":
"done"` in 1,423.9 s (23 min 44 s; the database records 23 min 42 s). Builders: GC source
`97980d7123bb`, `bar_1s` `5010f3903b79`, `candle_1m_1s` `383c6f3de161`; SI source
`117dedfecf0c`, `bar_1s` `6654ce9b0405`, `candle_1m_1s` `e2185053e1a6`.

- **Coverage:** lead 40 sessions (derived; the candle stage alone needs 1); 12 contracts,
  868 contract-sessions (434 per product), 71,559,900 rows in **each** table; 257/257 front
  sessions per product published; a fresh plan reports every contract `current`.
- **Warm:** every front session's candle stage is warm except the first downloaded one,
  2025-11-03, in each product. GCZ5, GCG6, SIZ5, and SIH6 start at the download start and
  report `history_limited`.
- **Carried prices:** September 2026 NULL rates on the continuous series are now 0.00% for
  `rsi`, `ema50_atr`, `aroon_up`, and `flow_price_corr` in both products (SI before: 5.74%,
  3.18%, 30.83%, 28.12%; SI windows without trades: 3.18%).
- **Parity:** recomputing GCZ6 2026-09-15 and SIK6 2026-03-16 (a degraded day) from the
  stored stage checkpoints reproduces every stored column of both stages.
- **Roll:** July 30 switches GCQ6 to GCZ6 with `rolled = true`; RSI, ATR, EMA(21), and Aroon
  are defined in all 82,800 rows of both sessions.
- **Quality:** the sessions reading the 2025-11-28, 2026-03-16, and 2026-04-10 files keep
  their `degraded` conditions, with no missing rows.
- **Size:** after `VACUUM (FULL, ANALYZE)` of each partition (10 min; the rebuild had left
  46.5 million replaced rows per table), `bar_1s` 20.11 GB and `candle_1m_1s` 60.73 GB,
  80.84 GB total (decimal). Free disk: 212 GiB.

Run #2 logs were removed after the baseline rebuild passed verification. A rebuild
replaces rows session by session; compact afterwards with `VACUUM (FULL, ANALYZE)` per
partition when the replaced rows are not reused soon.

## Running ingestion

History: run #1 (November 3, 2026, 11 min 2 s) stored GC and SI with the one-builder code
and a 5-session lead; run #2 (November 4) rebuilt them with stages; the
[baseline rebuild](#baseline-rebuild-gc-and-si) then recreated them from scratch, and
[run 3](#pr-b1-results-minute-stages) added the minute stages.

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
| TBBO only, the same rules for every product                                                          | Budget and consistency. Trades are exact; the book is seen only at trades, so fills carry 1–2 ticks of uncertainty in GC and SI | [Data limits](engine.md#data-limits-tbbo-only)                                   |
| DBN files are the permanent archive; PostgreSQL holds everything derived                             | Every stored value can be rebuilt or extended; SQL for research; no Parquet layer                                               | [Data](data.md#storage), [storage](../../lib/db-research/README.md)              |
| Store each second's base row and its `1m@1s` candle with features; NULL when undefined, never zero   | Research and ML read compiled rows; base rows stay mergeable into any window; missing, quiet, and invalid stay distinct         | [Ingestion](ingestion.md)                                                        |
| Store features as `double precision`, not `real` (decided November 2, 2026)                          | Stored features equal in-memory and live values exactly; disk space is not a concern                                            | [Measured](ingestion.md#measured)                                                |
| Event-time assignment and per-phase indicators confirmed against the TBBO handoff (November 2, 2026) | Stored rows equal what backtests and live sessions compute; the two clocks disagree on about 1 trade in 2,000                   | [Differences](ingestion.md#differences-from-the-handoff)                         |
| A builder identity per stage covers its code, settings, packages, columns, and inputs (PR A)         | Rows never mix code versions; a changed stage and those reading it are `stale`, the others stay current, new stages are added   | [Ingestion](ingestion.md#what-the-plan-decides), [pipeline](feature-pipeline.md) |
| Conservative TBBO fills (pre-trade book, trade-through targets, stops never better than the trigger) | Realistic second-scale costs; every setting is recorded with the run                                                            | [Timing model](engine.md#timing-model)                                           |
| Databento `definition` records for contract metadata                                                 | Free for this data; expirations, tick sizes, and multipliers                                                                    | [Data](data.md#what-we-have)                                                     |
| uv with Python 3.13, numba, psycopg 3, numbered SQL migrations; `research-web` is the only UI        | Reproducible environments, fast batch runs, simple schema history; checking backtest logic matters most now                     | [README](../../README.md), [UI](metric-explorer.md)                              |

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog --verify         # DBN files against their checksums
uv run research db migrate               # schema migrations
uv run research ingest plan GC SI        # what would be stored; then: run GC SI, status
uv run research backtest apps/backtest-runner/examples/gc.json
uv run research verify apps/backtest-runner/examples/mgc-sample.json
pnpm lint && pnpm test && pnpm build
```

After downloading TBBO files, add the job folder under `data/databento/tbbo/` unchanged,
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

**B2: hourly-only metrics (next)** ([plan 5.4](plan-1h-and-pivots.md#5-1h1m-amendments-to-the-proposed-plan)).

1. Decide the home: new `candle_1h_1m` columns (one migration, `0003`, and a rebuild of
   `candle_1h_1m` only, about 3 minutes for GC+SI) or a new tier-1 stage reading `bar_1m`
   (no rebuild). A separate stage keeps `candle_1h_1m` stable while the metrics change; either
   way `bar_1s`, `candle_1m_1s`, and `bar_1m` stay current.
2. Metrics, each normalized (`Unit`) and tested for scale invariance:
   - realized volatility from one-second returns, `sqrt(Σ ret2_sum + bridges)` in bps, and
     its ratio to the hourly ATR. A window adds each minute's `ret2_sum` and the bridge
     return `ln(first_close_m / close_{previous observed minute})`, excluding the bridge into
     the window's first observed minute, as the price-path bridges do;
   - from the 60 disjoint minute returns: standard deviation, skew, lag-1 autocorrelation,
     variance ratio VR(5), and the share of up minutes;
   - maximum drawdown and drawup in ATR (exact from the window's path fields), and where the
     window's high and low fell (0 to 1);
   - session-anchored VWAP distance, and the prior session's high, low, and close distances,
     in hourly ATR (session state from the minute rows);
   - the correlation of minute closes with minute cumulative delta.
3. Validate as B1: unit tests against direct references (realized volatility from the trades'
   one-second closes), the two-start warm-up test, a pilot, then `ingest plan` showing only
   the intended stage as `add` or `stale`, and full-year checks.

## Next steps

The order and decisions (November 3, 2026) are in the
[plan for stages, `1h@1m`, and pivots](plan-1h-and-pivots.md):

1. **Stages (PR A)**: done (PR #70): per-stage tables, versions, and checkpoints, the derived
   lead, carried prices, and the path fields; GC and SI rebuilt
   ([results](#rebuild-with-stages-gc-and-si)).
2. **Baseline rebuild**: done ([results](#baseline-rebuild-gc-and-si)).
3. **`1h@1m` rows (PR B)**: B1 done (PR #74, merge first); B2, the hourly-only metrics, next
   ([details](#pr-b-1h1m-rows)).
4. **Volatility tier (PR C)**: ATR horizons, time-of-day and daily ATR, bullish and
   bearish ATR, and adverse-excursion ATR ([plan section 7](plan-1h-and-pivots.md#7-volatility-tier-atr-family)).
5. **Swing structure (PRs D–F)**: directional-change pivots at 0.5, 1, and 2 ATRs on both
   resolutions with higher/lower highs and lows (D), structure signals (E), then outcome
   labels and the benchmark (F).
6. **Training data**: store the would-be trades (ML rows) from front-contract sessions in
   PostgreSQL, then a training pipeline that follows
   [training across contracts](#training-across-contracts-decided-november-2-2026).
7. **Backtests read stored rows** when the builder matches, so their roll warm-up equals
   storage (backtests now replay one warm-up session).
8. **Contract definitions**: download the free `definition` job into
   `data/databento/definition/` (needs the account owner) and load expirations.

Pivot work: the [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design) sets the
observations (the trade path, published per second and per minute), thresholds, segments,
storage, and labels; the [pivot/structure contract](pivot-structure-design.md) defines
higher/lower highs and lows, trend, provisional relations, and breaches. Research history:
the [next-agent handoff](pivot-detection-handoff.md) and its saved research. The methods
remain unimplemented and unvalidated on GC/SI.

## Open questions

1. When to add PL, YM, RTY, ES, and NQ? At the current width and the 40-session lead, the
   second tables need about 40 GB per product-year; disk is not a constraint (Paul).
2. Which unstored handoff metrics to add first, and which training outcome to use
   (simulated bracket trade or fixed-horizon return)?

## Things to know

- Review findings on the ingest planner have reached rare edge cases. The bar for changes:
  fix what can silently corrupt stored values or the series; refuse loudly for unusual
  setups (as for split-day downloads); decline hypotheticals with a test that shows why.
  Prefer rebuilding a contract (cheap: minutes) over more incremental-repair logic.
- Any edit to a file in a stage's identity (its `MODULES`, such as `bars.py`, `metrics.py`,
  `windows.py`, `window_metrics.py`, `kernels.py`, `indicators.py`, `features.py`, `market.py`,
  `stages.py`, `columns.py`, `state.py`, `warmup.py`, or `codec.py`) makes that stage and
  every stage reading it `stale`; the 83 GB second tables then need a rebuild. Run
  `ingest plan GC SI` before merging such edits, and batch them into one planned rebuild.
- TBBO shows the book only at trades. In quiet SI seconds (80% of them) the book is as old
  as the last trade; features carry that age (`trade_age_s`; `book_age_s` and `depth_age_s`
  for the last trade with a usable book and displayed sizes). At random moments in
  September 2026 the next SI trade came a median 5.9 s later (GC 1.7 s). Fill safeguards
  are specified in [todo.md](todo.md#later-refinements-after-the-core-is-tested).
- CVD needs an origin: rows store per-second net delta and its extremes, and
  `session_cvd` from the session open (NULL after missing data). Unknown-side volume
  (about 3% in metals, spread legs) stays out of it.
- Data quality: 2025-11-28 (CME outage) and six other dates are `degraded`; on that day
  most NQ, YM, and RTY records flag a possibly wrong book. Stored rows record each file's
  condition and flagged trades per second.
- There is no queue model for limit orders, and no live data or broker adapter yet.

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
