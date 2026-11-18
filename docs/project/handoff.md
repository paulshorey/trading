# Handoff

Updated November 18, 2026 after the GC/SI context experiment and benchmark review. Start here, then read
[AGENTS.md](../../AGENTS.md). The [roadmap](roadmap.md) is the map of what is computed and in
what order; tasks are tracked in [todo.md](todo.md); this page explains the architecture, the
decisions behind it, where the work stands, and exactly how to continue.

## Start here (next session)

1. **The stored rows are rebuilt from MBP-1** (November 16): GC and SI, the seven stages of
   layers 0 and 1 and the six swing scales of layer 2, every contract `current`
   ([rebuild](#rebuilt-from-mbp-1-november-16-2026), [swings](#pr-d-results-swings)). Nothing
   waits on data. The disk is nearly full: 63 GB free ([open questions](#open-questions)).
2. **Swings of the price path are built (PR D)**: confirmed highs and lows at 0.5, 1, and 2
   ATRs on both resolutions, the open leg and its progress, trend, breaches and reclaims
   ([results](#pr-d-results-swings); [what was built](plan-1h-and-pivots.md#36-implemented-in-pr-d-price-swings)).
   RSI swings (`pivot_rsi_*`) run on the same detector but do not fit the disk yet
   ([open questions](#open-questions)).
3. **Outcome labels and the benchmark are built (PR F)**: twelve label variants stored for GC
   and SI, and `research benchmark` ([results](#pr-f-results-labels-and-benchmark),
   [frozen spec](pivot-label-spec.md)). The swings beat the baseline detectors; the reversal
   models add almost nothing to where price already stands. Inputs from the other scales, the
   hourly window, and the partner product, already stored, do not help either
   ([context results](#context-input-results-november-17-2026)), so no model and no signal
   stage is stored. A [one-input model](#displacement-baseline-november-18-2026) outperformed
   both full models on the two primary targets. Choose the next experiment by the decision it supports
   ([research decision](roadmap.md#next-research-decision)). The pivot benchmark reserves
   September 1 onward. Earlier [engine checks](#the-move-to-mbp-1-november-15-2026) used September data.
4. The [book inputs](../research/pivots/2026-11-06-second-scale-and-mbp1.md) can be tested
   on candidates before allocating a full second-resolution table. GC and SI are the first
   [pair](pair-design.md).
5. **Backtests equal storage; keep it so.** A backtest warms each contract for the stored lead
   by default and computes exactly the stored rows from every roll on. A new stage needs no
   extra work for this as long as its warm-up fits the lead.

How to work in this repository:

- **The plan** is [plan-1h-and-pivots.md](plan-1h-and-pivots.md) (order of PRs A–F,
  decisions, the volatility tier), the [feature pipeline](feature-pipeline.md) (tiers,
  stages, database rules, derived warm-up), and the
  [pivot/structure contract](pivot-structure-design.md) (swings, higher lows and lower
  highs, tier-3 signals). Paul's decisions are recorded there; derived technical details
  (lead counts, thresholds needed for correctness) are decided and reported, not asked.
- **Paul's view of price data:** windows, not candles. The high and low path matters; open,
  close, and wick shapes are not signals ([principle](feature-pipeline.md#principle-windows-not-candles)).
- **Git and review.** Follow the workspace instructions and the shared Git management skill.
  In a linked worktree, real-data checks need access to the primary checkout's ignored
  `data/databento/` archive.
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
  swings.py, stage_pivot_*.py      Swings: one stage per scale, replaying the trades
  pipeline.py, state.py, warmup.py Tier-ordered pipeline, exact checkpoints, derived warm-ups
  engine.py, execution.py          Strategies, and fills at the book each order meets
        │                                      │
        ▼                                      ▼
Engine: backtests and rehearsals      research ingest → PostgreSQL `trading`
(research backtest, verify)           one table per stage, per contract:
                                        bar_1s, bar_1m (tier 0)
                                        candle_1m_1s, candle_1h_1m, stats_1h_1m, vol_1s,
                                        vol_1m (tier 1)
                                        pivot_1s, pivot_1m, pivot_event (tier 2)
                                        pivot_label_1s, pivot_label_1m (outcomes)
                                        planned: pivot_rsi_*, model_* and
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
`stage_vol_1s.py`, and one class per swing scale in `stage_pivot_1m.py` and `stage_pivot_1s.py`),
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
as NaN. The swing scales join the same way under their names, `1m@1s.fast_atr_1.progress` or
`1h@1m.slow_atr_2.trend` (415 features: 235 and 30 per scale).

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
| Code     | Engine, windows, features, ML rows, UI, and database layer (PR #62); one-second ingestion with the continuous series (#63); stages with per-stage versions, derived lead, and carried prices (#70); minute stages and the engine on the stage graph (#74); hourly statistics (#75); minute and second volatility (#76, #77); backtests warmed for the stored lead (#80); MBP-1 as the only source, book events in the engine, fills at the book (#81); **swings of the price path, six scales as stages of their own** (#82); **outcome labels as twelve stages, and the benchmark command** (#83) |
| Data     | One year of MBP-1 (2025-11-09 to 2026-11-05) for GC, SI, PL, ES, YM, RTY in `data/databento/mbp-1/` (123 GB), checksums and full decode verified; NQ not downloaded; TBBO files deleted |
| Database | PostgreSQL 18 database `trading`, 169 GB: `0001_baseline` through `0007_pivot_labels` applied; GC and SI rows of the seven layer-0 and layer-1 stages **rebuilt from MBP-1 on November 16** (12 contracts, 858 contract-sessions, 2025-11-10 to 2026-11-06, 70,731,900 second rows per second table), and the six swing scales built the same day (212,195,700 `pivot_1s` rows, 3,536,595 `pivot_1m` rows, 2,403,082 events), and the twelve label variants on November 17 (5,029,757 `pivot_label_1s` rows, 197,721 `pivot_label_1m` rows); `ingest plan GC SI` reports every contract `current`. The file registry lists the 1,866 MBP-1 files |
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

## Rebuilt from MBP-1 (November 16, 2026)

Paul authorized the reset. The four project schemas (`market`, `research`, `ml`, `meta`) were
dropped, because replacing 102 GB of rows in place would not fit; then `research db migrate`,
`research db register` (1,866 files), and `research ingest run GC SI --workers 8`.

- **Run 1:** 12 contracts, 858 contract-sessions, 70,731,900 rows in each second table and
  1,178,865 in each minute table, in 24 min 48 s; no errors. The database is 101 GB
  (`candle_1m_1s` 57 GB, `vol_1s` 22 GB, `bar_1s` 20 GB with their indexes).
- **Plan:** a fresh `ingest plan GC SI` reports all 12 contracts `current`, nothing to do.
- **Coverage:** 257 front sessions per product, 2025-11-10 to 2026-11-06, 21,186,000
  continuous second rows each. The last session has 3,600 seconds with data and 79,200
  `missing`: the 2026-11-06 file did not exist when the jobs were made.
- **Rolls:** the same contracts on the same dates as the TBBO-built schedule on all 504
  sessions both have (GC Z5, G6, J6, M6, Q6, Z6; SI Z5, H6, K6, N6, U6, Z6).
- **Warm-up:** the first 37 front sessions are cold for `vol_1s` and `vol_1m` (warm from
  2026-01-02, 220 of 257), 10 for `candle_1h_1m`, 5 for `stats_1h_1m`, 1 for `candle_1m_1s`.
- **Equal to the TBBO-built rows.** Before the reset, every stored row was fingerprinted per
  contract and UTC day (row count and a hash of all columns), and again after the rebuild.
  `bar_1s` and `bar_1m`: all 1,033 contract-days both have are identical (69,903,900 second
  rows). The five indicator stages are identical for the eight contracts whose stored
  history starts on the same day in both (GC J6, M6, Q6, Z6 and SI K6, N6, U6, Z6). They
  differ only for the first two contracts of each product (GC Z5, G6 and SI Z5, H6), whose
  history now starts a week later (2025-11-10 instead of 11-03): 2 days in `candle_1m_1s`,
  about a month in `stats_1h_1m` and `vol_1s`, two months in `candle_1h_1m`, and to the
  contract's end in `vol_1m`, whose long averages never become bit-equal. The size of those
  differences was not measured (only fingerprints were kept). In total 209,796,495 of
  216,911,160 rebuilt rows match exactly; the TBBO week 2025-11-03 to 11-07 is gone and
  2026-11-02 to 11-06 is new.

Evidence: `~/ingest-gc-si-mbp1.log` and `.json`, `~/mbp1-conversion.hash-tbbo.*`,
`hash-mbp1.*`, `hash_compare.txt`, `front-tbbo.csv`, `front-mbp1.csv`, `plan-after.json`.

To repeat it (after a change to `market.py` or the source files): `research ingest run GC SI
--rebuild --workers 8` replaces rows in place and needs about as much free space as the
tables it rewrites; with less, reset the schemas as above (ask Paul first).

## Earlier results (rows built from TBBO, November 3–5)

These sections are summaries; the full records, with every check and evidence file, are in
this file's history (`git show 1d1b3ac:docs/project/handoff.md`). MBP-1 trades are the same
records, so the findings carry over; row counts shifted by the week the downloads differ
(TBBO began 2025-11-01, MBP-1 2025-11-08; [comparison](#rebuilt-from-mbp-1-november-16-2026)).

## PR F results (labels and benchmark)

Built and measured November 16–17. The parameters were frozen in
[pivot-label-spec.md](pivot-label-spec.md) before any label was computed. Evidence:
`~/ingest-gc-si-labels.*`.

**In plain words.** The swing detector confirms a high only after price has fallen the full
threshold from it. A label takes the same high earlier, when price has fallen a quarter or a
half of the way, and records what happened next: the reversal completed, or price went back
through the high. The benchmark then asks two questions: is the detector a good way to find
turning points, and can a model tell early which candidates will complete?

**Labels stored.** Twelve label variants (six scales × two stages, 25% and 50% of the
threshold) for GC and SI: 5,029,757 rows in `market.pivot_label_1s` and 197,721 in
`market.pivot_label_1m`, 1.3 GB with indexes, built in 3.5 minutes (`add`, 8 workers, 858
contract-sessions). Checks on the stored rows, all sessions
(`psql -d trading -f ~/ingest-gc-si-labels.validation.sql`):

- Every confirmed high or low of the detector (1,323,967 across the scales) is either a row
  resolved before decision or the extreme of an earlier candidate: 0 missing, 0 counted twice.
- Every reversal whose extreme was not broken first is the detector's own confirmation, trade
  for trade: 2,201,401 checked, 0 unmatched.
- Every label settles inside its own session; no key is duplicated; no bound is violated.
- Share of candidates that reverse: 40–49% at the 25% stage and 60–63% at the 50% stage
  for the 0.5 and 1 ATR scales; lower at 2 ATR (26–34% and 45–51%), where many time out.

**A. Detectors against hindsight turning points**
(`uv run research benchmark detectors GC SI`; development period 2026-01-02 to 08-31, 171
sessions per product, GC and SI pooled). A reference turning point is the highest (lowest) row
within 300 seconds, or 240 minutes, either side, with a move of at least 1 or 2 ATRs into and
out of it. Delay is in rows after the turning point; false alarms are per open hour.

| Task (reference move) | Detector | Coverage | Median delay | 90% delay | False alarms/h | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| Seconds, 1 ATR | **Swings 1 ATR** | 97% | 48 s | 136 s | 16.1 | 0.33 |
| | Swings 0.5 ATR | 97% | 16 s | 65 s | 56.4 | 0.12 |
| | Swings 2 ATR | 58% | 126 s | 246 s | 2.6 | 0.64 |
| | Extrema, 120 rows each side | 100% | 120 s | 120 s | 12.8 | 0.38 |
| | Slope sign, 300 rows | 96% | 166 s | 239 s | 5.0 | 0.60 |
| | Slope sign, 60 rows | 94% | 37 s | 51 s | 53.1 | 0.12 |
| | CUSUM | 3% | 5 s | 14 s | 6.1 | 0.04 |
| Seconds, 2 ATR | **Swings 2 ATR** | 95% | 124 s | 245 s | 3.2 | 0.56 |
| | Slope sign, 300 rows | 97% | 162 s | 227 s | 8.5 | 0.33 |
| | Extrema, 120 rows each side | 100% | 120 s | 120 s | 16.5 | 0.21 |
| Minutes, 1 ATR | **Swings 1 ATR** | 100% | 38 min | 122 min | 0.29 | 0.37 |
| | Extrema, 60 rows each side | 100% | 60 min | 60 min | 0.50 | 0.25 |
| | Slope sign, 120 rows | 97% | 66 min | 96 min | 0.36 | 0.31 |
| Minutes, 2 ATR | **Swings 2 ATR** | 99% | 96 min | 211 min | 0.05 | 0.48 |
| | Slope sign, 120 rows | 96% | 67 min | 94 min | 0.48 | 0.09 |

Reading: the stored swings are the best of the four on the trade between delay and false
alarms whenever the scale matches the move being looked for. At a like number of false alarms
they are known in under half the time of fixed extrema (48 s against 120 s), and at 2 ATR they
raise a third of the slope detector's false alarms with a shorter median delay. Fixed extrema
never miss but always wait their full window. The location error is 0 rows at the median and
the 90th percentile for swings, extrema, and slope: when they fire, they name the right row.
CUSUM as frozen finds 3–7% (its claimed row is a median 45–84 rows from the turning point); it
was not tuned. The full table per product and kind is in the command's JSON.

**B. Can a model tell early which candidates complete?**
(`uv run research benchmark models GC SI`; four test months, May to August 2026, each scored
by models trained only on earlier sessions; 138–147 stored features of the decision row.)
Candidates that were provisional higher lows or lower highs; "random walk" is the chance of
reaching the reversal barrier first from where price stands, with nothing fitted.

| Label | Rows scored | Reversal rate | AUC: random walk | AUC: logistic | AUC: boosted | Log-loss gain, boosted over random walk (95%) | Boosted over logistic (95%) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fast_atr_0p5_q25` | 227,097 | 0.505 | 0.618 | 0.618 | 0.618 | +0.016 (0.014, 0.018) | +0.0005 (0.0000, 0.0009) |
| `fast_atr_0p5_q50` | 150,047 | 0.632 | 0.604 | 0.604 | 0.605 | +0.038 (0.034, 0.041) | +0.0012 (0.0005, 0.0021) |
| `fast_atr_1_q25` | 108,697 | 0.471 | 0.597 | 0.594 | 0.588 | +0.002 (0.001, 0.003) | −0.0020 (−0.0027, −0.0014) |
| `fast_atr_1_q50` | 68,982 | 0.630 | 0.590 | 0.588 | 0.582 | +0.010 (0.008, 0.013) | −0.0023 (−0.0033, −0.0012) |
| `fast_atr_2_q25` | 40,708 | 0.334 | 0.586 | 0.595 | 0.583 | +0.025 (0.022, 0.029) | −0.0073 (−0.0089, −0.0059) |
| `fast_atr_2_q50` | 24,296 | 0.519 | 0.582 | 0.583 | 0.566 | +0.028 (0.024, 0.033) | −0.0124 (−0.0149, −0.0097) |
| `slow_atr_0p5_q25` | 10,526 | 0.434 | 0.606 | 0.578 | 0.559 | −0.049 (−0.056, −0.041) | −0.030 (−0.037, −0.023) |
| `slow_atr_0p5_q50` | 5,969 | 0.603 | 0.627 | 0.591 | 0.572 | −0.045 (−0.053, −0.036) | −0.019 (−0.028, −0.010) |
| `slow_atr_1_q25` | 3,202 | 0.396 | 0.567 | 0.530 | 0.534 | −0.052 (−0.068, −0.038) | +0.016 (−0.009, 0.045) |
| `slow_atr_1_q50` | 821 (4 of 8 folds) | 0.560 | 0.597 | 0.498 | 0.497 | −0.065 (−0.090, −0.042) | +0.026 (−0.005, 0.057) |
| `slow_atr_2_q25`, `_q50` | none | | | | | fewer than 500 training rows of a class in every fold | |

Reading, which is the finding of this PR:

1. **The models do not rank candidates better than the position of price alone.** AUC
   (0.5 is a coin, 1 is perfect) is about 0.60 for the random-walk number, which uses only how
   far price has already reversed, and about 0.60 for both models with every stored feature.
   The models' log-loss gain on the fast scales is real but small, and it is mostly calibration: the
   random-walk formula's probabilities are off in level, which a model corrects. On
   `fast_atr_1` the gain over simply predicting the average rate is 0.009–0.017.
2. **The boosted model is not better than logistic regression.** Equal within 0.002 on the
   two largest samples and worse elsewhere, as the samples shrink.
3. **The slow scales have too few candidates** (800 to 10,000 scored): both models are worse
   than the random-walk number there, and the 2 ATR slow scale could not be fitted at all.
4. All candidates, not only provisional ones, give the same picture (in the JSON).

Excluded and counted, per label (in the JSON): session ends (118–310), unknown outcomes (0),
rows with an `*_atr` input above 50 in absolute value (0–13), rows with another NULL input
(1–5,462), and three or four features NULL by design (`break_up_age_s`, `break_down_age_s`,
`sweep_delta_ratio`, `reversal_delta_ratio`). The extreme-ATR problem is rare on front
sessions, as expected. This pivot-model comparison ends August 31.

## Context input results (November 17, 2026)

`research benchmark context GC SI` asks whether inputs from outside a candidate's own row
help the reversal models. The sets, the population, and the success rule were written into
the [spec](pivot-label-spec.md#context-inputs-added-november-17-2026-before-any-run) before
any run. Evidence: `~/context-gc-si.a.json` and `~/context-gc-si.b.json` (and `.log`).

**In plain words.** A candidate is a high that price has started to fall from. Part B gave
the models only that second's own candle, volatility, and swing state. Here they also see
the larger and smaller swings, the last hour, and what the other metal is doing. If the
wider picture mattered, the models should rank candidates better. They do not.

Each set contains the one before it, and every set is fitted and scored on the same rows
(provisional candidates of the six fast labels, walk-forward folds May to August 2026):

| Label              | Scored rows | Boosted AUC: `base` | `scales` | `hour` | `pair` | Log-loss gain of `pair` over `base` (95%) |
| ------------------ | ----------: | ------------------: | -------: | -----: | -----: | ----------------------------------------- |
| `fast_atr_0p5_q25` |     219,394 |               0.617 |    0.617 |  0.617 |  0.618 | +0.0000 (−0.0003 to +0.0003)              |
| `fast_atr_0p5_q50` |     145,348 |               0.604 |    0.603 |  0.604 |  0.605 | +0.0004 (−0.0001 to +0.0009)              |
| `fast_atr_1_q25`   |     107,345 |               0.587 |    0.585 |  0.585 |  0.587 | −0.0001 (−0.0008 to +0.0007)              |
| `fast_atr_1_q50`   |      68,201 |               0.581 |    0.578 |  0.576 |  0.578 | −0.0008 (−0.0019 to +0.0004)              |
| `fast_atr_2_q25`   |      39,752 |               0.584 |    0.581 |  0.578 |  0.580 | −0.0016 (−0.0038 to +0.0005)              |
| `fast_atr_2_q50`   |      24,037 |               0.569 |    0.564 |  0.562 |  0.565 | −0.0021 (−0.0054 to +0.0011)              |

1. **The rule is not met.** On the two primary labels (`fast_atr_1_*`) no set gives the
   boosted model a log-loss gain with an interval above zero, and AUC falls by up to 0.005
   where the rule asked for a rise of 0.02. `scales` and `hour` are zero or negative on every
   label.
2. **Logistic regression gets worse with every added set,** on every label (gain of `pair`
   −0.0014 to −0.018, every interval below zero): the added inputs are noise to it.
3. **One small positive:** the partner product's inputs help the boosted model for SI on the
   two 0.5 ATR labels (+0.0006 and +0.0010, intervals just above zero, AUC up 0.002 to
   0.003). GC does not gain from SI. Too small to act on, and not on a primary label.
4. The random-walk number still matches or beats the boosted model on every label (AUC 0.58
   to 0.62).

Rows excluded and features dropped for NULLs are counted per label in the JSON (25 to 83
features dropped). The inputs
are not tuned after the result, as the spec says. This context comparison ends August 31.

**What this means.** Everything stored today describes trades and the path of price. Seen
from one second, from the hour, across swing sizes, or across the pair, it does not tell
which early reversals complete. Structure signals computed from the same swings (PR E's
sweeps, breaks, and reclaims are already among the `base` inputs) are unlikely to change
that, so a `signal_*` stage is not built. The untested information is the order book.

## Displacement baseline (November 18, 2026)

`uv run research benchmark models GC SI --labels fast_atr_1_q25 fast_atr_1_q50`
reproduced the earlier row counts and full-model log losses. On provisional higher
lows and lower highs, fitting logistic regression to the distance price had already
reversed from the candidate extreme produced the following walk-forward log losses.
Lower is better. GC and SI share 87 scored trade dates across May–August.

| Candidate threshold | Scored rows | Displacement only | Logistic, 141 features | Boosted, 141 features |
| --- | ---: | ---: | ---: | ---: |
| 25% of the reversal threshold | 108,697 | 0.67475 | 0.67602 | 0.67804 |
| 50% of the reversal threshold | 68,982 | 0.64570 | 0.64755 | 0.64983 |

The ordering also holds within each product. At the 25% stage, the 95% trade-date
bootstrap interval for the boosted model's excess loss over displacement was
0.00266–0.00395. At 50% it was 0.00318–0.00500. At the 25% stage, 63,213 one-input
forecasts fell in the 40–50% band. Their mean forecast was 44.02% and 44.10% actually
reached the reversal barrier. This measures calibration for that event and population.

Use displacement as the comparator for the next forecast. A future test of incremental
book or indicator value should include that same displacement in both arms. For
profitability, use the separate [portfolio test](roadmap.md#next-research-decision).
The [audit specification](pivot-label-spec.md#probability-audit-november-18-2026)
records the development-data exposure and resampling rule. Local JSON reports are in
`data/runs/research/2026-11-18-displacement/`.

## PR D results (swings)

**Pilot (November 16).** GCZ6, 15 sessions (2026-08-17 to 09-04) built from scratch into a
throwaway database by this branch, every stage, in 51 s:

- **Independent replay.** A plain-Python directional-change detector, fed the trades from the
  DBN files and the thresholds from the *stored* candle and volatility rows, reproduced all
  39,481 confirmed highs and lows of the six scales (kind, extreme row, level, confirmation
  row): 0 differences (`~/ingest-gc-si-swings.reference.py`).
- **Rebuild.** One scale marked stale and rebuilt alone (`--rebuild`, 26 s) wrote only
  `pivot_1s` and `pivot_event`; every scale's rows and events were byte-identical afterwards.
- **Size.** 316 bytes per `pivot_1s` row with its index (3 rows per second), so about 67 GB
  for GC and SI; `pivot_1m` and the events are under 2 GB together.
- **How often.** Per 23-hour GC session, confirmed highs: 916 at 0.5 ATR, 292 at 1 ATR, and
  81 at 2 ATR on `1m@1s` (thresholds of about 2.5, 4.9, and 10 bps); 21, 5, and 1.5 on
  `1h@1m` (21, 44, and 89 bps). About half of the confirmed levels are later breached, and
  about three quarters of those breaches are reclaimed within the window.
- **Coverage.** Idle only while the ATR warms up (14 minutes fast, 14 hours slow at a
  contract's start). Rows in a leg: 99.9% fast, 95.8% slow over these 15 sessions.

**Full build (November 16, run 2).** Migration `0006_swings` applied to `trading` after the
review of the code; `research ingest run GC SI --workers 8` added the six scales to all 12
contracts (`add`: nothing else was rewritten) in 17 min 55 s, no errors.

- **Rows.** 35,360,100 GC and 35,371,800 SI rows per fast scale (the candle table's keys
  exactly), 589,335 and 589,530 per slow scale, and 2,403,082 events. `pivot_1s` takes 64 GB,
  `pivot_1m` 1.1 GB, the events 0.7 GB; the database is 168 GB.
- **Plan.** A fresh `ingest plan GC SI` reports all 12 contracts `current`.
- **Independent replay, whole year.** All 1,320,027 confirmed highs and lows of the six
  scales (GC 748,249, SI 571,778; 858 contract-sessions) equal the plain-Python replay of the
  DBN trades with thresholds from the stored rows: 0 differences.
- **Structure.** Pivots alternate within every segment; every breach and reclaim refers to a
  stored pivot of its scale; no event is available before its trade; progress stays within
  0 to 1, ages are never negative, slow ages are whole minutes; a row has values exactly
  when `state` is 2.
- **Continuous series.** 257 front sessions per product and scale: 21,186,000 second rows
  and 353,100 minute rows each, one per slot. 255 of 257 front sessions are warm at every
  scale; the two that are not are the first stored session (2025-11-10, a cold start) and
  the last (2026-11-06, mostly missing data). Slow scales are in a leg on 99.4% of front
  minutes, and at every roll's first front session from its first row.
- **Swings per product** (front and lead sessions, a year): at 0.5, 1, and 2 ATR on `1m@1s`,
  GC confirmed 248,374, 87,034, and 28,341 highs and SI 171,695, 76,619, and 28,050; on
  `1h@1m`, GC 7,754, 2,077, and 545 and SI 7,027, 1,968, and 530. About half the confirmed
  levels are breached later; GC reclaims three quarters of those within the window, SI 60%.
  September front sessions: thresholds of 2.4, 4.8, and 9.8 bps for GC and 4.3, 7.5, and
  14.7 bps for SI on the fast scales (SI's spread floor often binds at 0.5 ATR), 21 to 144 bps on
  the slow ones; the three trend states each hold about a third of the rows.
- **Finding: values in ATRs are unbounded when the ATR has decayed to nothing.** The
  threshold has a spread floor, so swings stay sensible, but `*_atr` values divide by the
  `1m@1s` ATR alone. After hours without a price change that ATR is almost zero: on front
  sessions this touches 6 GC rows and 1 SI row per fast scale on 2025-11-28 (the CME outage),
  and at most 11 rows of 21 million exceed 50 ATRs in a year; the 99.99th percentile of
  `leg_atr` is 20 (GC) and 38 (SI). In thinly traded lead sessions it is common: 1.0% of all
  stored GC fast rows and 3.7% of SI's exceed 50, nearly all of them there. The slow scales are
  unaffected (at most 18 on front
  sessions). Layer-1 `*_atr` features share the property. Training must clip or exclude such
  rows; whether to floor the normalizer instead is an [open question](#open-questions).
- **Engine.** `research verify` on GCZ6 2026-09-15: all 415 features and 15 trades identical,
  whole session against second by second (5.6 ms per market second, 4.9 ms before).

Evidence: `~/ingest-gc-si-swings.log` and `.json`, `plan-before.json`, `plan-after.json`,
`reference.py` and `reference.out`, `validation.sql` and `validation.out`,
`verify-gc-day.json`, and the pilot's `pilot.*` files.

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
[run 6](#pr-c2-results-second-volatility) the second volatility. After the reset of November
16, run 1 rebuilt them from MBP-1 and [run 2](#pr-d-results-swings) added the swing scales.

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
  `features.FeaturePipeline` (done with the MBP-1 change), and publish the `1m@1s` ATR in
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


## PR D: swings

**Done (this PR; [what was built](plan-1h-and-pivots.md#36-implemented-in-pr-d-price-swings)).**
`strategy_core/swings.py` holds the detector: one state machine per scale that replays the
released trades and, row by row, confirms highs and lows by directional change with a frozen
threshold, classifies them (higher, lower, equal; runs; trend), tracks the open leg (progress,
size, flow, retracement), and emits breaches and reclaims. `stage_pivot_1s.py` and
`stage_pivot_1m.py` wrap it as six stages, one per scale; migration `0006_swings` adds
`market.pivot_1s`, `market.pivot_1m`, and `market.pivot_event`.

What a later layer should know:

- **Read a scale by its `variant_id`** (`market.variant`: `fast_atr_0p5`, `fast_atr_1`,
  `fast_atr_2` in `pivot_1s`; `slow_atr_*` in `pivot_1m`). In memory a scale is the stage
  `pivot_1s:fast_atr_1`; its events are `products["events"][stage]`.
- **`state`** says whether a row has values: 0 idle (missing data, or the threshold's ATR or
  spread undefined), 1 a segment has begun but no swing is confirmed, 2 in a leg. A new
  `segment` never compares with the one before it.
- **Confirmation is late by design**: a high is known only after price fell `theta` from it.
  `progress` (0 to 1) and the provisional flags `prov_hl` and `prov_lh` are the early inputs;
  the reversal model (layer 3) is meant to do better.
- **Adding a scale** is one line in `SCALES` (a new stage, `add` in the plan, no migration).
  Changing `swings.py` rebuilds all six (about 67 GB of rows are rewritten in place, so free
  that much first, or drop the two tables' rows with Paul's agreement).

Decisions made in D (derived, reported in the PR): each scale is a stage, so the planner
needed no variant logic of its own; thresholds read the previous row (the previous second, or
the minute completed before the trade's minute); `*_atr` values divide by the ATR in price
units frozen with their extreme; whole-number columns are `smallint` or `integer`; RSI swings
are left for their own PR because `pivot_rsi_1s` does not fit the disk.

## PR F: labels and the benchmark

**Done (this PR).** `strategy_core/pivot_labels.py` holds the label kernel and
`stage_pivot_label.py` wraps it as twelve stages, one per scale and stage
(`pivot_label_1s:fast_atr_1_q25`, …), written to `market.pivot_label_1s` and
`market.pivot_label_1m` (migration `0007_pivot_labels`).
`backtest_runner/benchmark.py` is the benchmark; nothing it computes is stored.

What a later layer should know:

- **Labels are never inputs.** Label stages have `LABEL = True`; `pipeline.check_graph`
  refuses a stage that reads one, and the engine's features come from `FEATURE_STAGES`, which
  leaves them out. No label column has a unit, so none can be registered as a feature.
- **A label row is keyed to its decision row** (`slot_ordinal` and `end_ns` are the
  candidate's), and always lies inside that row's session. `available_ns` is the later time
  both outcomes were known: join features at the decision row, never at `available_ns`. A session can therefore be replaced alone, and one purged
  session covers every overlap in a split.
- **Outcome 0, "resolved before decision"**, is a confirmed pivot that never had a candidate
  at a row close. It is an observation, not a target; with it, every confirmed pivot is
  accounted for.
- **A new label definition is a new variant** (a new name, `add` in the plan), never an edit.
  Changing `pivot_labels.py` or `stage_pivot_label.py` rebuilds only the label tables (1.3 GB,
  minutes). They still list `swings.py` and the shared modules, so the rule for those is
  unchanged.
- **The benchmark refuses dates outside January 2 to August 31, 2026.** The holdout is for the
  final evaluation of a chosen model, once.

Decisions made in F (derived, reported in the PR): two tables by row resolution rather than
one; labels as stages on tier 9 so the planner, checkpoints, and rebuilds needed nothing new;
the horizon is 300 rows fast and 240 rows slow, with the survival deadline equal to it;
scikit-learn joins the dependencies (`HistGradientBoostingClassifier` is the boosted model);
the random-walk baseline ignores the horizon; a model needs 500 training rows of each class.

## Next steps

The order follows the [roadmap](roadmap.md#next) and the decisions of November 3
([plan](plan-1h-and-pivots.md#6-decisions)):

1. Rebuild from MBP-1: done November 16 ([results](#rebuilt-from-mbp-1-november-16-2026)).
2. Swing structure of price (PR D): done November 16 ([results](#pr-d-results-swings)).
3. Labels and the benchmark (PR F): done November 17
   ([results](#pr-f-results-labels-and-benchmark)).
4. **Context inputs from stored rows: tested November 17, no gain**
   ([results](#context-input-results-november-17-2026)). No signal stage and no model stage
   is stored.
   **For reversal forecasting, test book inputs on the candidates only.** Read the
   best bid and ask around each provisional candidate from the DBN files (spread, size
   imbalance, quote changes over the last seconds; [metrics](../research/pivots/2026-11-06-second-scale-and-mbp1.md)),
   freeze the list in the spec first, and add them as a fifth set to
   `research benchmark context`. This needs no new table, so the disk does not block it. If
   they help, consider permanent storage. Report the result for the tested inputs, horizon and population.
   For a take-or-skip decision, prioritize the [after-cost experiment](roadmap.md#next-research-decision).
5. **Permanent book and pair stages** depend on the chosen experiment and available space.
6. **Training data**: store the would-be trades (ML rows) from front-contract sessions in
   PostgreSQL, then a training pipeline that follows
   [training across contracts](#training-across-contracts-decided-november-2-2026).
7. **Backtests read stored rows** when the builder matches, for speed only.
8. **Contract definitions**: download the free `definition` job into
   `data/databento/definition/` (needs the account owner) and load expirations.
9. **NQ**: download its MBP-1 year when disk allows (about 50 GB), then ES + NQ as a pair.

Pivot work: the [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design) sets the
observations (the trade path, published per second and per minute), thresholds, segments,
storage, and labels; the [pivot/structure contract](pivot-structure-design.md) defines
higher/lower highs and lows, trend, provisional relations, and breaches. Research history:
the [next-agent handoff](pivot-detection-handoff.md) and its saved research. The detector is
implemented and verified as a calculation, and the benchmark shows it finds turning points
sooner than the baselines at a like false-alarm rate
([results](#pr-f-results-labels-and-benchmark)). Telling early which candidates complete is
still open: the stored features do not do it, alone or with context from other scales, the
hour, or the partner product ([results](#context-input-results-november-17-2026)).

## Open questions

1. **Disk.** The archive is 123 GB and the database 169 GB, with 63 GB free on a 926 GB
   disk on November 17 (the write-ahead log of the swing build has shrunk back). Nothing large fits any more: not NQ (about 50 GB of files, more as rows),
   not `pivot_rsi_1s` (about 40 GB), not `book_1s`, not a third product, and not an in-place
   rebuild of `pivot_1s` or `candle_1m_1s` (each rewrites its own size). Options: an external
   or larger disk for the DBN archive (it is read sequentially and rarely), storing fewer
   second-resolution tables or scales, or building products in turn. The November 3 decision
   "disk is not a constraint" no longer holds.
2. **The ATR normalizer in thin markets** ([finding](#pr-d-results-swings)): keep `*_atr`
   values as plain ATR multiples and clip or exclude at training, or floor the normalizer
   (for example at the spread, as the threshold already is). The second changes stored
   values of the swing stages, and the same question applies to layer 1.
3. **What comes after the context result** ([recommendation](#next-steps)): test book
   inputs on the candidates, or change the question. The labels ask "will this early
   reversal complete?", and trade-derived inputs answer no better than the position of
   price. Other targets on the same rows: the size of the move after a confirmed swing, or
   a bracket trade's outcome at fixed risk.
4. **Which products next.** PL, YM, RTY, and ES are on disk. A pair needs both legs: YM or
   RTY could pair with ES before NQ arrives.
5. Which unstored reference metrics to add first, and which training outcome to use
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
