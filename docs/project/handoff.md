# Handoff

As of November 6, 2026 (after PR C2 and the full-scale checks). Start here, then read [AGENTS.md](../../AGENTS.md). Tasks are
tracked in [todo.md](todo.md); this page explains the architecture, the decisions behind
it, where the work stands, and exactly how to continue.

## Start here (next session)

1. **The swing structure (PR D) is next**: directional-change pivots at 0.5, 1, and 2 ATRs on
   both resolutions, sized by the volatility tier (`vol_1s`, `vol_1m`). The design is the
   [plan, section 3](plan-1h-and-pivots.md#3-pivot-and-structure-design) and the
   [pivot/structure contract](pivot-structure-design.md); the procedure that worked for B and C
   is in [PR C](#pr-c-volatility-tier) ("How"). Size it from measured rows: `vol_1s` takes 307
   bytes per row with its index, so three `pivot_1s` variant rows per second would be roughly
   50–75 GB for GC and SI, not the plan's 20–25 GB; the database was 102 GB with 211 GB free on
   November 5.
2. **Paired products (P1)** can be built alongside PR D: stages that read GC + SI and ES + NQ
   at the same `slot_ordinal`, decided November 6, 2026. The design is
   [pair-design.md](pair-design.md); the metrics behind it are in the
   [order-flow research](../research/pivots/2026-11-05-order-flow-predictors.md).
3. **Backtests equal storage; keep it so.** A backtest warms each contract for the stored lead
   by default and computes exactly the stored rows from every roll on
   ([checks](#full-scale-checks-after-pr-c2)). A new stage needs no extra work for this as long as
   its warm-up fits the lead.

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
                                        candle_1m_1s, candle_1h_1m, stats_1h_1m, vol_1s,
                                        vol_1m (tier 1)
                                        next: pivot_* (D), signal_* (E), pivot_label (F)
                                      market.continuous_*                  (per product)
                                                  │
                                                  ▼
                                      ML training (next): one model on pooled examples
```

`apps/backtest-runner` holds the data adapters, calendars, ingestion, CLI (`research`), and
the local API; `apps/research-web` is the UI (run setup, results, trade inspector).

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

| Area     | State                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Engine, windows, features, fills, ML rows, UI, and database layer (PR #62); one-second ingestion with the continuous series (PR #63); stages with per-stage versions, derived lead, and carried prices (PR #70); baseline schema and cleanup (PR #71); minute stages and the engine on the stage graph (PR #74, B1); hourly window statistics (PR #75, B2); minute volatility (PR #76, C1); second volatility (PR #77, C2); backtests warmed for the stored lead (full-scale checks) |
| Data     | One year of TBBO (2025-11-01 to 2026-10-31) for GC, SI, PL, ES, NQ, YM, RTY in `data/databento/tbbo/` (7.3 GB), verified and registered                                                                                                                                                                                                                                    |
| Database | PostgreSQL 18 database `trading`: `0001_baseline` through `0005_second_volatility` applied; GC and SI: 71,559,900 rows per second table ([baseline](#baseline-rebuild-gc-and-si), [C2](#pr-c2-results-second-volatility)), 1,192,665 per minute table ([B1](#pr-b1-results-minute-stages), [B2](#pr-b2-results-hourly-statistics), [C1](#pr-c1-results-minute-volatility)) |
| Ingest   | Baseline rebuild completed November 4 (runs 1–2); run 3 added the minute stages in 2 min 29 s, run 4 the hourly statistics in 1 min 55 s, run 5 the minute volatility in 1 min 55 s, run 6 the second volatility in 5 min 47 s; 40-session lead (37 required, by `vol_1m` and `vol_1s`), 257/257 front sessions per product; every stage `current` |
| Strategy | `bias_pullback` is an infrastructure baseline that loses money, not a candidate                                                                                                                                                                                                                                                                                            |
| UI       | Trading web on 4400 and API on 4401 under `~/git/local-dev`; plain `pnpm dev` uses 4400 and 8001                                                                                                                                                                                                                                                                           |

Stored rows ([ingestion](ingestion.md)): `market.bar_1s` holds each second's exact
statistics (OHLCV by aggressor side, CVD, sweeps, sizes, price path, and the book at trades:
spread, displayed size and orders, imbalance, effective spread); `market.candle_1m_1s`
holds the rolling `1m@1s` candle and 87 normalized features. `market.bar_1m` holds the same
statistics per minute, merged exactly from its 60 seconds, plus observed seconds and
one-second returns; `market.candle_1h_1m` holds the rolling `1h@1m` candle and 77 features, and
`market.stats_1h_1m` 16 statistics of the same window (realized volatility, minute-return
moments, path, session levels), and `market.vol_1m` 26 volatility features of it (ATR horizons,
bullish/bearish and adverse-excursion ATR, extremes as levels, time-of-day and daily ATR);
`market.vol_1s` holds the same 26 for the `1m@1s` window plus realized volatility from its
one-second returns. Each
is a stage with its own
version and checkpoints ([pipeline](feature-pipeline.md)). Historical run #2 rebuilt GC and SI
with a 40-session lead in 23 min 44 s with 8 workers and used 80.84 GB including indexes
([measurements](ingestion.md#measured)). The metrics follow the [TBBO engineering handoff](tbbo-engineering-handoff.md);
about 40 of its entries are not stored yet ([list](ingestion.md#metrics)) and can be added
by rebuilding from the DBN files ([how](ingestion.md#adding-a-metric-or-feature)).

## Full-scale checks (after PR C2)

November 5, 2026, on `main` after #77. Evidence (outside git): `~/verify-{GC,SI}-week-after-c2.*`,
`~/backtest-GC-*`, `~/stored-vs-backtest-*.json`, and `~/post-c2-warmup.*`.

- **Live path over a week.** `research verify --sessions 5` on 2026-09-14 to 09-18: GC (92
  trades) and SI (110) matched every one of the 235 features and every trade, whole versus
  second by second, at about 4.1 ms per market second.
- **Full year.** A GC backtest of 2025-11-06 to 2026-10-30 (266 sessions, 6 contracts) ran in
  161 s with 2.6 GB; its 43 MB run loads in the UI in under a second.
- **Warm-up gap (fixed).** Backtests replayed at most 10 warm-up sessions (default 1), so after
  every roll `day_atr_pct` (35 sessions) and `atr_tod_log` (about 21) were NULL for 51–100% and
  30–93% of each GC contract's trades. Backtests now warm each contract for the stored lead
  (`warmup_sessions` unset, at most 100): both are defined at every trade, and GC 2026 takes
  about 4 minutes instead of 137 s, with the same memory.
- **Backtests equal storage.** Started on a roll with the stored lead, a backtest reproduces every
  stored row of all seven stages bit for bit (GCZ6 2026-07-30, SIZ6 2026-08-28, SIK6 2026-02-26,
  and GCG6 2025-11-26, whose lead reaches back before the data). A test keeps it so.
- **`verify` memory.** It kept every one-second frame, 26–28 GB for a week; it now compares an
  hour at a time and replays the warm-up whole (2.4 GB for the same week with the 40-session warm-up, whose
  trading sessions still matched exactly: 91 GC and 110 SI trades). `rehearse` also replays the
  warm-up whole instead of in real time.
- **Engine ATR.** Brackets read `vol_1s.atr_price`, bit-identical to what `pipeline.FastAtr`
  recorded, so `FastAtr` is gone (no stage identity changed; all 12 contracts stay `current`).
- **UI.** Multi-day charts label ticks with dates, the inspector groups features by stage with
  a filter, and the form says "Loading products…" until the catalog arrives.
- **Edge case left for a `source.py` rebuild.** If a download started partway through a session,
  a backtest whose warm-up reaches before it would read that partial session while storage skips
  it. No current download does this (all start on Saturday 2025-11-01). Fixing it means
  separating the roll warm-up count from the warm-up list in `HistoricalSource`, and `source.py`
  is in every stage's identity ([todo](todo.md#housekeeping)).

## PR C2 results (second volatility)

Completed November 4, 2026, from PR #77 (head `5eb19c3`, reviewed by Codex with no findings).
`0005_second_volatility` was applied to `trading`; `ingest plan GC SI` then showed `add` for all
12 contracts with the reason `stages without stored rows: vol_1s`, every other builder
unchanged, and the required lead 37 sessions (`vol_1m` and `vol_1s`), inside the 40 lead. Run 6
(`ingest run GC SI --workers 8`) ended `done` in 5 min 47 s (868 contract-sessions, about 2.5 s
each per worker), writing only `market.vol_1s`. Builders: GC `7f8cde19881c`, SI `049a3937fafd`.
A fresh plan reports every contract `current`.

- **Coverage:** 35,774,100 GC and 35,785,800 SI rows, one per stored second; keys and `status`
  equal `candle_1m_1s` row for row (0 differences); the continuous view holds 21,186,000 seconds
  per product (257/257 front sessions, each second once).
- **Reference:** an independent recomputation from the stored rows
  (`~/ingest-gc-si-c2.reference.py`: binary COPY of `bar_1s` and `candle_1m_1s`, its own numba
  loops, session by session): per-phase Wilder averages on the candle's windows (carried price from
  `bar_1s`), the window path merged from `bar_1s`'s per-second drawdown, drawup, and extreme order,
  realized volatility from the observed second closes, the time-of-day normal from the stored
  `atr_bps` at each minute's last second, and the daily scale from `bar_1s` and the calendar. All
  71,559,900 rows match, 57,421,787 of them complete windows: 0 NULL mismatches; averages within
  3.6e-14 bps (seeding order); ages, order, distances, the window estimators, realized
  volatility, the time-of-day normal, the daily ATR, and its percentile exactly (3 min 26 s).
- **Checks:** (bull + bear) / 2 = `atr_bps` within 1e-9 relative; `atr_price` ÷ close × 1e4 equals
  `atr_bps` bit for bit (57,416,296 complete windows); skew and percentile in range; ages 0–59;
  high + low distances equal the range; true range at least the range; `rv_returns` = observed
  seconds − 1 in every complete window, and `rv_bps` NULL exactly when only one second traded; no
  stored NaN; the daily ATR constant within each session; at all 1,192,665 minute ends the daily
  ATR, its percentile, and (complete at both resolutions) the session levels equal `vol_1m`'s: 0
  differences.
- **Warm and rolls:** as `vol_1m`, 37 typical sessions; 220/257 front sessions per product are
  warm, the cold ones the first 37 downloaded (2025-11-03 to 12-23, `history_limited`), which
  include the first roll (2025-11-26: `atr_tod_log` and `day_atr_pct` still NULL). The four later
  rolls per product and all September sessions have 0.00% NULL `atr50_bps`, `bull_atr_bps`,
  adverse ATR, `atr_tod_log`, `tr_atr`, `day_atr_bps`, `day_atr_pct`, `day_range_ratio`, and
  `atr_usd`. Realized volatility is NULL only in complete windows with one traded second
  (September: 0.22% GC, 5.72% SI; 0.00% with two or more).
- **Distributions** (front series, every 37th second, median and 5–95%): `rv_atr` 0.68
  (0.36–1.17 GC; SI 0.67): second-by-second volatility is about two thirds of the range-based
  ATR; `atr_tod_log` −0.04 (−0.72–0.79 GC), wider than hourly; `bull_bear_skew` +0.006 GC, +0.001
  SI (−0.26–0.26); long and short excursions 0.66 and 0.67 ATR GC (0.62, 0.63 SI); `tr_atr` 0.90;
  `spread_atr` 0.15 GC, 0.23 SI: crossing the spread costs 15–23% of a typical minute's true range;
  ages median 33 s; `1m@1s` ATR(5) 4.5 bps GC, 8.5 SI; ATR $203 GC and $291 SI per contract;
  `rv_returns` median 19 GC, 8 SI.
- **Size:** 24.05 GB including indexes; `vol_1s` checkpoints 159 MB over 868 sessions (mostly
  the time-of-day buffer).
- **Pilot first:** a throwaway database built GC 2026-07-20..08-05 with `main`, then added this
  stage (`add`, 0.75 s per session; the same reference: 0 mismatches over 1,564,599 complete
  windows), and rebuilt it alone when marked stale (rows and checkpoints byte-identical). A second
  throwaway database (GC 2026-05-01..08-05, built with the branch) filled the daily and
  time-of-day chains: 0 mismatches over 8,410,369 complete windows. Both dropped.
- **Engine:** `research verify` on the MGC sample day matches all 235 features and 13 trades;
  second by second 321.7 s (315.5 s before: `vol_1s` adds about 0.08 ms per second, about 3.9 ms
  in all against the 100 ms close delay), whole session 0.69 s.

Local evidence uses the prefix `~/ingest-gc-si-c2`: `.identities.py` and `.identities.txt`,
`.plan.json`, `.log`, `.summary.json`, `.replan.json` and `.replan.txt`, `.validation.sql` and
`.validation.txt`, `.atr-bits.txt`, `.reference.py`, `.reference.json`, and `.reference.log`,
`.verify.json`, `.checks.log`; the pilots' are `~/ingest-pilot-c2-*`.

## PR C1 results (minute volatility)

Completed November 4, 2026, from PR #76 (head `58cddfd`, reviewed by Codex with no findings).
`0004_minute_volatility` was applied to `trading`; `ingest plan GC SI` then showed `add` for all
12 contracts with the reason `stages without stored rows: vol_1m`, every other builder
unchanged, and the required lead 37 sessions (`vol_1m`), inside the 40 lead. Run 5
(`ingest run GC SI --workers 8`) ended `done` in 1 min 55 s (868 contract-sessions, about
0.4 s each), writing only `market.vol_1m`. Builders: GC `8412ccd99b66`, SI `916bd6359326`. A
fresh plan reports every contract `current`.

- **Coverage:** 596,235 GC and 596,430 SI rows, one per stored minute; keys and `status` equal
  `candle_1h_1m` row for row (0 differences); the continuous view holds 353,100 minutes per
  product (257/257 front sessions, each minute once).
- **Reference:** an independent recomputation from the stored rows
  (`~/ingest-gc-si-c1.reference.py`): plain-Python per-phase Wilder averages on the candle's
  windows (carried price from `bar_1m`), the window path merged from `bar_1m`'s per-minute
  drawdown, drawup, and extreme order, the time-of-day normal from the stored `atr_bps`, and the
  daily scale from `bar_1m` and the calendar. All 1,190,467 complete windows match: 0 NULL
  mismatches; averages within 2.3e-13 bps (seeding order), the daily ATR, its percentile, the
  time-of-day normal, ages, order, distances, and the window estimators exactly.
- **Checks:** (bull + bear) / 2 = `atr_bps` within 1e-9 relative everywhere; `atr_price` equals
  `atr_bps` × close bit for bit (1,181,110 complete windows); skew and percentile in range;
  ages 0–3599 and equal to 3599 × (1 − `stats_1h_1m.high_pos`/`low_pos`); high + low distances
  equal the range; excursions at least the window's drawdown and drawup; true range at least
  the range; the daily ATR constant within each session: 0 violations.
- **Warm and rolls:** the stage needs 37 typical sessions (the daily percentile's 35 sessions as
  whole days); 220/257 front sessions per product are warm, the cold ones the first 37
  downloaded (2025-11-03 to 12-23, `history_limited`), which include the first roll
  (2025-11-26: `atr_tod_log` and `day_atr_pct` still NULL). The four later rolls per product and
  all September sessions have 0.00% NULL `atr50_bps`, `bull_atr_bps`, adverse ATR,
  `atr_tod_log`, `tr_atr`, `day_atr_bps`, `day_atr_pct`, `day_range_ratio`, and `atr_usd`.
- **Distributions** (front series, median and 5–95%): `atr_tod_log` −0.05 (−0.57–0.49 GC): the
  hourly ATR typically sits within a factor of 1.7 of its time-of-day normal; `day_range_ratio`
  0.58 (0.14–1.41); `bull_bear_skew` +0.04 GC, +0.03 SI (−0.24–0.29): declines from P₀ slightly
  larger than rallies; long and short excursions 0.67 and 0.68 ATR; `tr_atr` 0.87; `spread_atr`
  0.016 GC, 0.024 SI; daily ATR 230 bps GC, 484 SI; hourly ATR $1,869 GC and $2,910 SI per
  contract.
- **Size:** 0.42 GB including indexes; `vol_1m` checkpoints 156 MB over 868 sessions (the
  time-of-day buffer, 1,440 × 20 values each).
- **Pilot first:** a throwaway database built GC 2026-07-20..08-05 with `main`, then added this
  stage (`add`, 0.4 s per session; the same reference: 0 mismatches over 28,862 windows), and
  rebuilt it alone when marked stale (rows and checkpoints byte-identical). A second throwaway
  database (GC 2026-05-01..08-05, built with the branch) filled the daily and time-of-day chains:
  0 mismatches over 175,203 windows. Both dropped.
- **Engine:** `research verify` on the MGC sample day matches all 207 features and 13 trades;
  second by second 315.5 s (317 s before), whole session 0.67 s.

Local evidence uses the prefix `~/ingest-gc-si-c1`: `.plan.json`, `.log`, `.summary.json`,
`.replan.txt`, `.validation.sql` and `.validation.txt`, `.reference.py` and `.reference.json`,
`.verify.json`, `.checks.log`; the pilots' are `~/ingest-pilot-c1-*`.

## PR B2 results (hourly statistics)

Completed November 4, 2026, from PR #75 (head `7d2354d`, reviewed by Codex with no open
findings). `0003_hour_stats` was applied to `trading`; `ingest plan GC SI` then showed `add`
for all 12 contracts with the reason `stages without stored rows: stats_1h_1m`, and every
other builder unchanged. Run 4 (`ingest run GC SI --workers 8`) ended `done` in 1 min 55 s
(868 contract-sessions, about 0.4 s each), writing only `market.stats_1h_1m`; the other
stages' records still come from runs 1–3. Builders: GC `ff6a1ea7fbf0`, SI `072c5a033422`.
A fresh plan reports every contract `current`.

- **Coverage:** 596,235 GC and 596,430 SI rows, one per stored minute; keys and `status`
  equal `candle_1h_1m` row for row (0 differences); the continuous view holds 353,100 minutes
  per product (257/257 front sessions, each minute once).
- **Reference:** an independent recomputation from the stored rows
  (`~/ingest-gc-si-b2.reference.py`): realized volatility from `bar_1s`'s observed one-second
  closes, the return statistics, correlation, extreme positions, session VWAP, and previous
  session's levels from `bar_1m` and the calendar, distances from `candle_1h_1m`'s ATR.
  All 1,190,467 complete windows match: 0 NULL mismatches, largest difference 2e-9 bps
  (`rv_bps`, prefix-sum rounding), the levels and positions exactly.
- **Warm and rolls:** the stage needs 5 sessions (hourly ATR(14)); 252/257 front sessions per
  product are warm, the cold ones the first five downloaded (2025-11-03 to 11-07,
  `history_limited`). The first front session of each later roll and all September sessions
  have 0.00% NULL `rv_atr`, `vr_5`, `drawdown_atr`, `session_vwap_atr`, `prior_close_atr`, and
  `cvd_close_corr` among complete windows.
- **Bounds:** positions in 0–1, ratios in range, drawdown and drawup within the window's range
  (via `atr_bps` and `range_bps`), previous close between its low and high: 0 violations.
- **Distributions** (front series, complete windows, median and 5–95%): `rv_atr` 0.65
  (0.41–1.17 GC); `vr_5` 0.89 (0.52–1.46) and `ret_autocorr` −0.05: one-minute returns
  mean-revert slightly within the hour; `cvd_close_corr` 0.61 (−0.48–0.95): price follows net
  aggression; `drawdown_atr` and `drawup_atr` 0.67; `up_minute_ratio` 0.50. SI matches GC in
  ATR units, with about twice the realized volatility in bps (59 vs 28).
- **Size:** 0.35 GB including indexes.
- **Pilot first:** a throwaway database built GC 2026-07-20..08-05 with `main`, then added this
  stage (`add`, 0.5 s per session; the same reference: 0 mismatches over 28,862 windows), and
  rebuilt it alone when marked stale (byte-identical). Dropped afterwards.
- **Engine:** `research verify` on the MGC sample day matches all 181 features and 13 trades.

Local evidence uses the prefix `~/ingest-gc-si-b2`: `.plan.json`, `.log`, `.summary.json`,
`.validation.sql` and `.validation.txt` (SQL checks), `.reference.py` and `.reference.json`;
the pilot's are `~/ingest-pilot-b2-*`.

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

The order and decisions (November 3, 2026) are in the
[plan for stages, `1h@1m`, and pivots](plan-1h-and-pivots.md):

1. **Stages (PR A)**: done (PR #70): per-stage tables, versions, and checkpoints, the derived
   lead, carried prices, and the path fields; GC and SI rebuilt
   ([results](#rebuild-with-stages-gc-and-si)).
2. **Baseline rebuild**: done ([results](#baseline-rebuild-gc-and-si)).
3. **`1h@1m` rows (PR B)**: done: B1 (PR #74) and B2 (PR #75)
   ([details](#pr-b-1h1m-rows)).
4. **Volatility tier (PR C)** ([details](#pr-c-volatility-tier)): done: C1 `vol_1m` (PR #76) and
   C2 `vol_1s` (PR #77)
   ([plan section 7](plan-1h-and-pivots.md#7-volatility-tier-atr-family)).
5. **Swing structure (PRs D–F), next**: directional-change pivots at 0.5, 1, and 2 ATRs on both
   resolutions with higher/lower highs and lows (D), structure signals (E), then outcome
   labels and the benchmark (F).
6. **Training data**: store the would-be trades (ML rows) from front-contract sessions in
   PostgreSQL, then a training pipeline that follows
   [training across contracts](#training-across-contracts-decided-november-2-2026).
7. **Backtests read stored rows** when the builder matches, so their roll warm-up equals
   storage, for speed only: warming each contract for the stored lead already gives the stored
   values and takes about a third of a year's run.
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
   second tables need about 50 GB per product-year (102 GB for GC and SI on November 5, 211 GB
   free); disk is not a constraint (Paul), so space is added as needed.
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
  every stage reading it `stale`; the second tables (about 100 GB) then need a rebuild. Run
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
