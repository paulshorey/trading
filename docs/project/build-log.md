# Build log

The full text before it was shortened on November 27, 2026 is
[archived](../archive/build-log-original-2026-11-27.md).

What was built, how it was checked, and what each experiment found, newest first. The
[status](status.md) says where the work stands and what to do next; this page is the
record behind it. Add a section when a stage, a rebuild, or an experiment is finished. The
withdrawn reversal design has its own record in
[build-log-withdrawn.md](../archive/build-log-withdrawn.md).

## Swings and structure of RSI and of CVD (November 24, 2026)

Build-order item 11, step 5 of the process ([decision 41](roadmap.md#decisions);
[spec](series-structure-spec.md), frozen before the build and before the model run).

**What a series is.** One value per aggregated row of a timeframe, at the row's close: the
RSI of the window that ends there (`candle_<window>.rsi`) or the contract's running buy
minus sell volume through it (`bar_<rows>.cvd`). No trade is read. The zigzag of price stays
the one stage that reads the trades inside a row, to know which level was reached first.

**Built** (`stage_step_series.py`): 24 stages, one per timeframe, series, and multiple
(`<stream>_rsi_atr_<k>`, since renamed `<stream>_rsi_mean_atr_<k>`, and
`<stream>_cvd_atr_<k>`, k of 0.5, 1, 2, 3), in the six tables of
migration `0016` with their events in `market.pivot_event`. Each computes the series' own
ATR (per phase, the Wilder average of the window's true range of the series), freezes a
threshold of k ATRs when an extreme is set, floored at 2.5 RSI points or 3 typical trades,
and runs the detector and the structure code that price uses. Values in ATRs divide by the
series' ATR floored at half that smallest swing. RSI is read to a millionth of a point, so
that floating-point noise never decides whether two equal values differ (found by the
price-scaling test: two rows differed). The fast tables hold the last second of every
ten-second row; the engine computes every second.

**How the thresholds were chosen** (GC and SI, March 2 to April 24, 2026, 39 trade dates).
RSI's own ATR is about 7 points on every timeframe and both products; CVD's is 24, 111, and
355 contracts for GC and 8, 43, and 149 for SI, which is why each needs its own. At the same
multiple of its own ATR each series makes about as many swings as price, so price's
multiples are used and a swing of one series compares with a swing of another. Confirmed
highs a trade date in the stored rows, GC then SI:

| Timeframe | Multiple | Price | RSI | CVD |
| --- | ---: | ---: | ---: | ---: |
| `1m@1s` | 0.5 | 895 / 566 | 1,122 / 978 | 521 / 413 |
| | 1 | 292 / 273 | 338 / 324 | 213 / 196 |
| | 2 | 81 / 94 | 78 / 81 | 80 / 78 |
| | 3 | 37 / 44 | 36 / 39 | 43 / 44 |
| `10m@10s` | 0.5 | 120 / 112 | 120 / 121 | 62 / 55 |
| | 1 | 31 / 31 | 34 / 34 | 22 / 22 |
| | 2 | 7.8 / 7.8 | 7.5 / 7.5 | 7.6 / 8.2 |
| | 3 | 3.7 / 3.4 | 3.3 / 3.3 | 4.1 / 4.5 |
| `1h@1m` | 0.5 | 21 / 20 | 19 / 21 | 10 / 10 |
| | 1 | 5.6 / 5.0 | 5.9 / 5.4 | 3.6 / 3.9 |
| | 2 | 1.3 / 1.1 | 1.3 / 1.1 | 1.2 / 1.6 |
| | 3 | 0.6 / 0.6 | 0.6 / 0.5 | 0.7 / 0.7 |

They agree with the counts a plain zigzag gave before the build (in the spec), except that
the spec's count for price at 3 slow ATRs (1.3) was too high; the stored 0.6 is right. The
table is of the first RSI series (see the replacement below).

**Checked.** Each scale equals a plain-Python reference (own ATR, threshold, zigzag) in any
chunking and from checkpoints; features are unchanged when all prices or all sizes are
multiplied; shifting CVD's level by a constant changes no feature; a backtest warmed for the
lead computes the stored rows. `ingest run GC SI` added the stages to all 12 contracts
without rebuilding any other (858 sessions, run 6). The new fingerprint
(`~/tmp_trading/fingerprint-series.txt`) holds the 432 lines of `~/tmp_trading/fingerprint-new.txt` unchanged and 576
new ones. `research verify` on the example day: features and all 18 trades identical, at
9.8 ms a market second (8.8 ms with 741 features).

**A fix after review** (November 25). The detector was given a size of zero for every row,
so the events of these stages stored a leg's volume as 0, 0, 0 where it is unknown: no
trade is read. They are NULL now (3,634,539 pivot events), and a test requires it. The 24
stages were rebuilt (run 7). Against the fingerprint before the fix, only their 288 event
lines differ, with the same counts; every row table is identical, so no feature changed and
the model run below stands. `~/tmp_trading/fingerprint-series.txt` is the one after the fix.

**The RSI series was wrong, and is replaced** (November 26 and 27; found in review). The
stored RSI is one history per phase. Read row by row it steps as the rows rotate through
the phases, and the zigzag confirmed swings no phase had made: 60 pivots in 30 minutes at
a constant price, and 5% to 11% of the stored pivots at 0.5 and 1 ATR repeating exactly 60
rows apart. The series is now the mean of the last 60 rows' RSI, each phase once, with its
smallest swing measured again at 0.25 points; the scales are renamed
`<stream>_rsi_mean_atr_<k>` and rebuilt (run 8), and the first ones are retired. Both
flat-price reproductions are tests. The stored pivots no longer repeat (0.0%). On
minute-end forecasts at the bracket horizon, over 86 trade dates, no difference is
detectable between the model with these RSI swings, with the first ones, or with none;
shorter horizons, the seconds between minute ends, and results after costs were not tested
([measurements, the choice, and run 12](results.md#how-should-the-rsi-series-be-read)).
`research verify` again finds features and all 18 trades identical. The fingerprint
(`~/tmp_trading/fingerprint-series.txt`, 1,296 lines) holds every earlier line unchanged, CVD's
included, and 288 new ones for the new RSI scales. The retired scales' rows were then
deleted with Paul's agreement (61.3 million rows, 4.6 million events) and their 288 lines
taken out of the baseline: 1,008.

**Two more corrections from review** (November 27). The policy opens and closes nothing on a
row where a swing scale has no confirmed high or low yet, which training leaves out
(`ModelPolicy.decides`, `dataset.readiness`; run 11's forecast was zero, so nothing recorded
changes). `progress` is the deepest pullback since the running extreme over the threshold,
not the chance of confirmation: the project instructions and decision 31 said otherwise, and
a test now shows it staying at 0.8 after a recovery to one point from the high. A saved model
is checked against the engine's features before it is replayed, and new artifacts record
their commit and dataset file.

**The engine** now holds 1,449 features (741 before). Its per-second cost grows with the
number of features, so a second in which no slower row completes now reuses the last row's
values instead of joining them again (`StageFeatures.as_of`); the second-by-second
equivalence test takes 190 s against 183 s before the stages were added.

**The model, with and without them** (November 25; [the test](results.md#do-the-swings-of-rsi-and-cvd-add-skill)).
On minute-end forecasts (run 11 rescored, 86 test dates), `trees` on all 1,449 features has a
pooled rank correlation of 0.042 (-0.033 to 0.121) and a squared error 9% above `flat`;
`trees_without_series`, the 741, has 0.044 (-0.033 to 0.116) and 12% above. The difference,
paired by trade date, is -0.002 (-0.057 to 0.052). `trees_coarse` is 0.011 and `ridge`
0.042, with 10% and 53% above `flat`. The full table, with the correction made in review
(intervals by reranking each date resample), is in [results](results.md) and the
[rescoring details](results.md#do-the-swings-of-rsi-and-cvd-add-skill).

The new inputs add no measurable skill, as expected before the run. The forecast without
them reproduces run 9 (0.044), so the comparison is on the same footing. By product `trees`
is 0.082 for GC and 0.000 for SI; by month -0.101, 0.097, 0.151, and 0.069. All four
calibration slopes are zero in every month, so the yardstick is still the flat forecast and
the policy was not replayed. Evidence: `~/tmp_trading/yardstick-series.json`.

**The horizon map was not rerun.** With 1,449 features it takes more than two hours; the
first attempt (run 10, left unfinished in `research.run`) was stopped by the session's time
limit before anything was saved. Run 11 used `--no-horizons`. To get the map, run
`research yardstick GC SI` from a terminal, where nothing limits it.

## Fixes after review of four pull requests (November 24, 2026)

Paul reviewed four open pull requests and found defects in each. All are fixed and the four
were merged together.

- **The resting limit** (`execution.py`). A break in data coverage while an order rests gives
  an unknown outcome, counted as `orders_with_unknown_outcome`, never read as an expiry, and
  the engine opens nothing more until that session's close. Only volume from the aggressor
  that would hit the order counts toward its queue. A limit that is marketable on arrival
  fills then only when the whole order fills within its price; otherwise it rests.
- **The target** (`targets.py`, version 2). A trade counts by its own event time, from the
  decision on and before the forced exit. A session with no trades settles at the closing
  mid-price.
- **The dataset cache** (`dataset.py`, version 2). Its key holds the target and dataset
  versions, the settings, and each selected session's contract, source files, their
  condition, and every builder of the rows, so a corrected target or file cannot load old rows.
- **The calibration slope** (`yardstick.py`): fitted forward in time and weighted by date
  ([spec](results.md#can-the-forecast-be-made-no-worse-than-flat)).
- **The ATR floor.** `spread_atr` divided by the bare ATR; it now divides by the floored
  one. The swing stages froze `atr_price` times a factor, which is zero where the ATR is
  exactly zero, so a market that had stopped moving left its detector idle. They now freeze
  `vol_*.norm_atr_price`, the ATR or the spread where that is larger.
- Label stages stay out of the features the engine computes. A backtest's warm-up leaves
  out a partly downloaded session only when it lies outside the stored period. A policy
  result is also given with each exit priced without a book charged one further stop
  distance. A stop moved to the entry price is never in force before the engine knows of
  the position.

**Build and checks**

- Migrations `0014_norm_atr_price` and `0015_swing_atr_snapshot` (the swing variants'
  registered source of the frozen ATR), applied. `research ingest run GC SI --rebuild`
  rewrote the volatility and swing tables; `ingest plan GC SI`: all 12 contracts `current`.
- Read back on front sessions (`continuous_vol_1s`, 42.4 million rows): the floor binds on
  975,927, the count recorded below; `norm_atr_price` is never under `atr_price`; no row
  has an ATR of exactly zero, so that fix changes only the thin sessions before a contract
  is the front one.
- The decision model, rebuilt from its rows (run 7) and its policy (run 8): unchanged, the
  same 432,513 targets with the same barrier counts, every slope zero, no position opened.
  Run 9, after the row exactly an hour before the forced exit stopped being eligible (the
  engine opens nothing then): 432,185 rows, every slope zero, `trees` 0.044 (-0.030 to
  0.116).
- Tests: strategy-core 160, backtest-runner 61, with new ones for each fix above.

## Base changes: a continuous CVD, the ATR floor, the roll warm-up (November 24, 2026)

Build-order item 10, step 1 of the process. Three changes to base rows and to what every
stage reads, made together because each forces a rebuild of every table.

- **`cvd`**, on the rows of every step (`bar_1s`, `bar_10s`, `bar_1m`): buy minus sell volume
  through the life of a contract. `session_cvd` restarts at each session open; `cvd` never
  does, so a swing of it can cross the daily break ([decision 41](roadmap.md#decisions)).
  It is NULL only on a missing row. Both stay stored.
- **The ATR floor** ([decision 23](roadmap.md#decisions); `strategy_core/normalizer.py`).
  Every value in ATRs now divides by the larger of the ATR and the last sampled book spread:
  the window features, the indicators, the statistics, the volatility family, and the frozen
  ATR of the swings. `atr_bps` and `atr_price` are unchanged, and where the floor does not
  bind every value is unchanged bit for bit. The normalizer is stored as
  `candle_*.norm_atr_bps`, which is context and not a model input.
- **The roll warm-up** (`source.py`): a source knows how many sessions a contract replays
  after a roll apart from its warm-up list, and a session that was downloaded only in part
  is left out of a backtest's warm-up, as storage leaves it out. No download held has such
  a session.

**How many rows the floor changes** (rows where the spread is above the ATR):

| Timeframe | GC, front sessions | SI, front sessions | GC, every stored row | SI, every stored row |
| --- | ---: | ---: | ---: | ---: |
| `1m@1s` | 251,389 of 21.1 million (1.2%) | 724,538 (3.4%) | 28% | 33% |
| `10m@10s` | 5,674 of 2.1 million (0.3%) | 13,703 (0.6%) | 4% | 8% |
| `1h@1m` | 57 of 350,941 | 254 | 1.5% | 2.0% |

Nearly all of it is in the thinly traded sessions before a contract becomes the front one,
where the one-minute ATR was as small as a 10^20th of the spread. On front sessions the fast
timeframe is the one touched: the spread is wider than a one-minute ATR in one row in thirty
for SI.

**Build and checks**

- Migration `0013_cvd_and_atr_floor`; `research ingest run GC SI --rebuild --workers 8`,
  run 4, 57 minutes, every table; `ingest plan GC SI` reports all 12 contracts `current`.
  The database is 288 GB, about 120 GB of it the rewritten rows' dead space
  (`VACUUM FULL` gives it back; the disk has 3 TB free).
- `cvd` is set on 351,780 of the 353,100 front minute rows of each product (the rest are
  missing rows).
- The first decision model on the rebuilt rows (run 6): unchanged. `trees` 0.051 (-0.027 to
  0.126), its slope zero in all four months; the yardstick stays flat.
- Tests: strategy-core 154, backtest-runner 57, with new ones for the floor and for `cvd`.

## A forecast that is no worse than flat (November 24, 2026)

The first decision model forecast boldly and wrongly, so its policy traded noise. Fixed as a
variant written into the spec before it ran
([spec and results](results.md#can-the-forecast-be-made-no-worse-than-flat)).

- `yardstick.shrink`: the forecast is multiplied by a slope fitted on the training rows, from
  forecasts made for each of four blocks of training dates by a model fitted on the others.
  `yardstick.fit_coarse`: leaves of at least ten trade dates' worth of rows. The yardstick is
  `trees_coarse_shrunk`; the policy reads the slope with the model.
- **Result:** the slope is zero in all four months (-0.04 and -0.06 before clipping, where
  checked). The yardstick forecasts zero, the policy opens no position in any of its sixteen
  replays, and the result equals staying flat. `coarse` alone leaves the error 9% above
  `flat`'s.
- Runs 4 and 5 in `research.run`; 32 minutes for the forecast, 7 for the policy.
- Tests: a synthetic case where trees learn each session's outcome from a feature that
  names the session, forecast boldly, and are shrunk to nearly nothing; and one where a real
  signal keeps its size.

## The first decision model (November 24, 2026)

Build-order item 9, step 6 of the process. The [spec](yardstick-spec.md) holds the settings
and [results](results.md): no skill at the bracket's horizon, a small one a minute ahead,
and every policy cell a loss.

**What was built**

- `strategy_core/targets.py` (the move ahead in R and the mid-price's move over fixed
  horizons), `backtest_runner/dataset.py` (one row a minute with the engine's 741 features,
  eligibility, the cost of a round trip in R, and the targets; cached under `data/research/`,
  4 minutes to build with 8 workers), `backtest_runner/yardstick.py` (`research yardstick GC SI`:
  walk-forward `ridge` and `trees`, 42 minutes, most of it the horizon map's 35 fits a month),
  and `backtest_runner/policy.py` (`research policy RUN GC SI`: the model as an engine
  strategy and the replay of the spec's eight cells under two executions, 7 minutes for 8
  product-months).
- `research.run` (migration `0012_research_runs`): each run is written with its frozen
  settings before it reads anything, and its result when it ends. Runs 1 to 3 are there.

**The first skill measure was biased, and the run caught it**
([what happened](results.md#a-flaw-in-the-first-skill-measure)). A correlation taken
within each trade date rewards any forecast that fades the session's move; a forecast of
"minus the session's return so far" scored 0.65 on it. The measure now ranks all rows
together. The rule is in AGENTS.md, and a test on a simulated random walk keeps it.

**Checks.** The dataset's feature names and order equal the engine's (`StageFeatures.specs`);
`research verify` on the example GC day: identical features and 18 identical trades, 8.8 ms a
market second with 741 features; strategy-core 152 tests, backtest-runner 55.

## A 3 ATR swing scale and the structure code (November 24, 2026)

Build-order item 8, step 4 of the process.

- **A scale at 3 ATR on every timeframe** (`fast_atr_3`, `mid_atr_3`, `slow_atr_3`): three
  more variants of the swing stage, written to the existing tables. Confirmed highs on front
  sessions in the year held: 139 for GC and 142 for SI on `1h@1m`, 873 and 887 on `10m@10s`,
  9,255 and 10,971 on `1m@1s`.
- **`structure`**, one column per scale (migration `0011_structure_code`): the trend and the
  break of the last confirmed high or low in one code, `3 x (trend + 1) + (break + 1)`, from
  0 (down and extending) to 8 (up and extending), NULL until the trend is known. It is
  computed from the row's own columns (`stage_step_pivot.with_structure`). On the slow 3 ATR
  scale of GC every one of the nine states occurs, from 12,049 minute rows (up with its low
  broken) to 82,396 (down and inside).
- The engine holds 741 features (637 before).
- **Rebuild:** the swing stages' code changed, so all of them were `stale`:
  `research ingest run GC SI --rebuild --workers 8`, run 3, 7.7 minutes, writing only the
  swing tables and events (`pivot_1s` 34,416,676 rows, `pivot_10s` 28,292,760, `pivot_1m`
  4,715,460, events 2,907,672). `ingest plan GC SI` reports all 12 contracts `current`. The
  database is 165 GB.
- Tests: the new scale equals the plain-Python reference swings on the fast timeframe; the
  small test world has no slow swing of 3 ATRs.

## The engine makes position decisions (November 24, 2026)

Build-order item 7, step 6 of the process ([decisions 35 to 39](roadmap.md#decisions)). The
rules it built (decision at every second in two parts, market and passive entries, brackets
without a time limit and sized by any timeframe's ATR, a moved stop, risk sizing and the
daily limit, the trend gate, closing orders, and the costs a strategy sees) are described
in the [engine's timing model](engine.md#timing-model). None is in a stage's identity, so no
stored row changed.

**Checks**

- Whole sessions and one second at a time give identical features, trades, and summaries in
  seven cases: the two old ones, closing on the opposite signal, passive entries with each
  fill rule, a bracket without a time limit on the middle ATR with a gate and a moved stop,
  and positions sized by risk with a daily limit.
- Unit tests of each rule on hand-built trades and books: a closing order that the stop
  beats while it travels; the queue ahead of a passive order carried across chunks; the stop
  moved only after the amendment arrives; sizing; the gate.
- Not built: one portfolio across products. An engine runs one product, so the daily limit
  is per product.

## The reversal design, withdrawn (November 23, 2026)

Paul withdrew the trained reversal model ([decision 29](roadmap.md#decisions)) on November
23, 2026, and the code, tables, and commands that served it were removed (last commit that
has them: `df5a907`). What was tried: label stages that recorded, for a swing candidate, whether
price completed the reversal; a benchmark of swing detectors against hindsight turning points;
reversal-probability models with context inputs; and a replay of the candidates as trades.
Conclusion: the swing detector was a good way to find turning points, but no model ranked
candidates better than the distance price had already reversed, no added context helped, and no
replayed group passed after costs. Migration `0010_remove_pivot_labels` dropped the label
tables; the fast swing scales no longer keep a row at each label's decision row (`pivot_1s`
holds 25,699,173 rows, 31,095,900 before; events unchanged at 2,787,648). The full record is
in [build-log-withdrawn.md](../archive/build-log-withdrawn.md).

## The new machine (November 23, 2026)

The database was rebuilt from the DBN files on the new Mac (Apple M1 Max, 10 cores, 64 GB,
4 TB), following [the handoff](status.md#setting-up-another-machine).

- `research catalog --verify`: 622 files, 29.19 GB, no checksum failure, 12 files `degraded`.
- Migrations `0001` to `0009` applied; 622 files registered. (The old registry listed 1,866:
  it also held the four products whose files were removed.)
- `research ingest run GC SI`, run 1, 8 workers: 12 contracts, 858 contract-sessions,
  70,731,900 second rows, no failure; `ingest plan GC SI` reports all 12 contracts `current`.
  The database is 151 GB.
- **Row counts equal the old machine's** in every table that this log records: 70,731,900 in
  the second tables, 7,073,190 in the ten-second tables, 21,219,570 `pivot_10s`, 31,095,900
  `pivot_1s`, 3,536,595 `pivot_1m`, 2,787,648 events (2,403,082 and 384,566), and 5,029,757,
  915,075, and 197,721 label rows.
- **The fingerprints could not be compared.** The old machine's fingerprint file is not on
  this machine. Whether the two processors give bit-identical floats is therefore not shown,
  and will not be: Paul decided the same day that this build is the starting point, so
  `~/tmp_trading/fingerprint-new.txt` (576 lines: per table, contract, and variant) is the baseline for
  later rebuilds.
- **What stands in for it, in part:** a replay of the candidates on the rebuilt database
  reproduced every number of the two tables recorded on November 19, so the results that
  depend on the fast labels, both ATRs, the slow swings, and every trade and book record of
  342 sessions are equal to the precision that changes a tick or a fill. It does not cover
  the middle timeframe, the statistics and volatility tables, or last-bit differences that
  change no outcome.
- `pnpm lint`, `pnpm test`, `pnpm build`, and `research verify` on the example GC day pass.
- Two handoff steps were wrong and are corrected there: the database needs the role `trading`, and a new PostgreSQL has none of the bulk-load settings ([storage page](../../lib/db-research/README.md#local-setup)).

## One set of stages for every timeframe (November 20, 2026)

Build-order item 5, asked for by Paul: `1m@1s` should not be managed by its own logic. Its
window, statistics, volatility, and swing stages are now the classes that build `10m@10s`
and `1h@1m` (`stage_step_candle.py`, `stage_step_stats.py`, `stage_step_vol.py`,
`stage_step_pivot.py`). Only the one-second rows stay a module of their own
(`stage_bar_1s.py`): they are made from the trades, and every longer step is merged from them.

**What changed for the stored rows** (migration `0009_one_set_of_stages`)

- `stats_1m_1s` is new: the window statistics every timeframe has, 16 features, 70,731,900
  rows. Realized volatility (`rv_bps`, `rv_atr`, `rv_returns`) moved to it from `vol_1s`,
  where the other timeframes keep it; the engine's feature names are the same
  (`1m@1s.rv_bps`). The engine has 639 features (625 before).
- The fast swing scales read the spread from the step rows' last bid and ask, as the other
  scales do, instead of `candle_1m_1s.book_spread_bps`. It is the same quantity: on a week
  of stored SI rows the two agreed on all 414,000 rows.
- What still differs between timeframes is declared on the timeframe, not copied: the
  session features and the latest observation are stored on `1m@1s` only, the fast swing
  rows are stored sparsely, and each timeframe has its reclaim window.
- The stored-row rule names its step (`STORED_ROWS` v3), so a shorter merged step would
  mark the sparse rows stale.

**Checks**

- **In memory, old code against new:** on a synthetic two-session world with closures, gaps,
  and quiet minutes, all 3,058 column hashes of every stage are identical.
- **The whole year** (`research ingest run GC SI --rebuild --workers 8`, run 7, 53 minutes;
  216 fingerprints, per table and contract, taken before and after): identical for
  `candle_1m_1s`, `vol_1s` (the columns it kept), realized volatility (old `vol_1s` columns
  against `stats_1m_1s`), `pivot_1s`, and every ten-second and minute table. **The fast
  timeframe did not change by one bit.** The middle and slow swing rows and events changed
  with the same row counts: only `theta_bps`, `progress`, and `displacement` (and `theta` and
  `overshoot` of events) differ, by at most 4.4 parts in 10 trillion, where the spread floor
  sets the threshold (measured on three weeks of SIZ6). No swing, event, class, age, or level
  differs.
- `ingest plan GC SI` reports every contract `current`.
- **Engine:** `research verify` on the example GC day: all 639 features and all 18 trades
  identical, whole session against second by second, at 7.6 ms per market second while the
  disk cleanup ran beside it (7.0 ms with 625 features). The example backtest gives the same
  18 trades and result as before.
- Tests: strategy-core 157, backtest-runner 63; `ruff` passes.

**Disk.** The rebuild rewrote the one-second tables in place and left the old rows as dead
space: the database grew from 141 GB to 252 GB and the disk fell to 40 GB free.
`VACUUM FULL` per partition gave the space back: the database is 146 GB, with 146 GB of
disk free, and its fingerprint is unchanged.

## The middle timeframe `10m@10s` (November 20, 2026)

Build-order item 4. `10m@10s` is a window of 60 rows of ten seconds, between `1m@1s` and
`1h@1m`. Its stages are the classes that build the `1h@1m` ones, for another `Timeframe`.

**What was built**

- Stages `bar_10s`, `candle_10m_10s`, `stats_10m_10s`, `vol_10s`, the swing scales
  `mid_atr_0p5`, `mid_atr_1`, `mid_atr_2` (`pivot_10s`), and, at the time, six label
  variants: 38 stages in all. `pipeline.MERGED` lists the stored timeframes.
- Migration `0008_middle_timeframe`: each table is created `LIKE` its minute counterpart, so
  the columns are the same, with its continuous view.
- The engine (`pipeline.StageFeatures`) joins every merged timeframe as of each second, with
  its age (`10m@10s.age_s`): 625 features, 415 before. The `1h@1m` feature names did not change.

Decisions made here:

- **The fast swing rows are kept at every ten-second row's end**, not only at minute ends
  ([rule](ingestion.md#fast-swing-rows-are-stored-sparsely)), so a decision on
  the middle timeframe finds the fast scales in storage. `pivot_1s` went from 14,286,813 to
  31,095,900 rows.
- **`stats_*` column names stay** (`minute_returns`, `up_minute_ratio`, `vr_5`); on another
  timeframe they count its step rows, and the descriptions say so.
- **The list of stored timeframes moved to `pipeline.py`**, out of `timeframes.py`, which is
  part of every step stage's identity: adding a timeframe now rebuilds nothing else.

**Results** (`research ingest run GC SI --rebuild --workers 8`, run 6, 13 minutes; the
database went from 110 GB to 141 GB):

- 7,073,190 rows in each ten-second table, exactly a tenth of the 70,731,900 second rows;
  21,219,570 `pivot_10s` rows; 384,566 events. The continuous series has 2,118,600
  ten-second rows per product over 257 sessions. `ingest plan GC SI` reports every
  contract `current`.
- **Nothing else changed.** The 96 fingerprints of the hourly tables, the slow swings, and
  the fast and slow events equal those taken after the refactor.
- **The middle scales sit between the others.** September front sessions, thresholds at
  0.5, 1, and 2 ATR: 8.2, 16.5, and 34.3 bps for GC and 13.4, 27.3, and 57.0 bps for SI
  (fast: 2.4, 4.8, 9.8 and 4.3, 7.5, 14.7; slow: 21 to 144). Confirmed highs in the year at
  1 ATR: 11,587 GC and 10,665 SI (fast 87,034 and 76,619; slow 2,077 and 1,968).
- **Warm sessions.** `vol_10s` is warm on 464 of 858 contract-sessions (its daily chain needs
  37 sessions); the candle and statistics on 834.
- **Engine.** `research verify` on the example GC day (GCZ6 2026-08-31, 82,800 seconds): all
  625 features and all 18 trades identical, whole session against second by second, at 7.0 ms
  per market second (5.6 ms with 415 features), inside the 100 ms close delay. The example
  backtest gives the same 18 trades and result on `main` and on this branch.

## Timeframe as a parameter (November 20, 2026)

Build-order item 3. The stages of `1h@1m` were modules of their own beside those of `1m@1s`.
They are now one class per kind, built for a `timeframes.Timeframe`: `stage_step_bar.py`
(step rows merged from `bar_1s`), `stage_step_candle.py`, `stage_step_stats.py`,
`stage_step_vol.py`, and `stage_step_pivot.py`. `bar_1m`, `candle_1h_1m`, `stats_1h_1m`,
`vol_1m`, and the slow swing scales are the instances for `1h@1m`, with the same names,
columns, and settings as before.

- **The one-second stages were left alone.** Their rows come from the trades, not from
  merged rows, and they already share the calculation modules. Their builder identities did
  not change, so `bar_1s`, `candle_1m_1s`, `vol_1s`, and the fast swing scales stayed
  current: 100 GB of rows were not rewritten.
- **A second instance, in memory.** `tests/test_timeframes.py` builds `10m@10s` beside the
  minute branch: six 10-second rows equal one minute, every stage gives identical rows in
  any chunking, and windows hold 60 rows across a closure. A step that does not divide a
  minute is refused.
- **Stored rows did not change.** 96 fingerprints (eight tables, per contract) taken before
  the rebuild (`--rebuild --workers 8`, run 5, 6 minutes) are all identical after it;
  `ingest plan GC SI` reports every contract `current`.

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

**Checks**

- **Files:** all 1,878 files match their manifests (size and SHA-256), and all 1,866 data
  files decode completely: 5.94 billion records, 222.8 million trades, receive order sorted
  ([data](ingestion.md#the-data-on-this-machine)).
- **Same as TBBO:** four whole sessions of MBP-1 trades (GCZ6 and SIZ6 2026-09-15, GCG6
  2025-12-10, SIK6 2026-03-16) equal the stored second rows for all 82,800 seconds each: 0
  differences. A pilot ingest from MBP-1 (GCZ6 and SIZ6, 2026-09-08 to 09-18, 47 s) equals
  the rows in `trading` byte for byte in every column of `bar_1s` (71 columns) and `bar_1m`
  (75), and of `candle_1m_1s` (106) from the second session on.
- **Engine:** `research verify` on a real GC day (GCZ6 2026-09-15, 2.3 million book events):
  all 235 features and all 15 trades identical, whole session against second by second
  (402.7 s, 4.9 ms per second while other jobs ran; 2.3 GB). The parity tests pass with
  synthetic book events that arrive late and out of order.
- **A real day's costs:** GCZ6 2026-09-15 with `examples/gc-day.json`: 15 trades, entry
  slippage 1.0 tick on average (90th percentile 2.5) against the mid-price at the decision;
  200 would-be trades averaged 1.34 ticks. The session had 2,273,683 book events for 93,025
  trades, none one-sided and 12 crossed.

**What it means for results.** Simulated fills no longer wait for the next trade. Every
entry now pays the spread it met about 150 ms after the signal second (100 ms to decide,
50 ms for the order to travel), and the run reports that cost in ticks. Runs saved before
this change priced fills at the next trade's book and are not comparable.

## Rebuilt from MBP-1 (November 16, 2026)

Paul authorized the reset. The four project schemas (`market`, `research`, `ml`, `meta`) were
dropped, because replacing 102 GB of rows in place would not fit; then `research db migrate`,
`research db register` (1,866 files), and `research ingest run GC SI --workers 8`. A later
`--rebuild` replaces rows in place and needs about as much free space as the tables it
rewrites; with less, reset the schemas (ask Paul first).

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
- **Equal to the TBBO-built rows.** Fingerprints per contract and UTC day, before the reset
  and after the rebuild: `bar_1s` and `bar_1m` are identical on all 1,033 contract-days both
  have (69,903,900 second rows), and the five indicator stages for the eight contracts whose
  history starts on the same day in both. They differ only for the first two contracts of
  each product (GC Z5, G6 and SI Z5, H6), whose history now starts a week later (2025-11-10
  instead of 11-03); the size of those differences was not measured. In total 209,796,495 of
  216,911,160 rebuilt rows match exactly; the TBBO week 2025-11-03 to 11-07 is gone and
  2026-11-02 to 11-06 is new.

## Price swings built and checked (November 16, 2026)

An ATR zigzag of price at 0.5, 1, and 2 ATR on `1m@1s` and `1h@1m` (six scales; the 3 ATR
scale and the middle timeframe came later). `strategy_core/swings.py` holds the detector:
one state machine per scale that replays the released trades and, row by row, confirms
highs and lows by directional change with a frozen threshold, classifies them (higher,
lower, equal; runs; trend), tracks the open leg (progress, size, flow, retracement), and
emits breaches and reclaims. Each scale is a stage; migration `0006_swings` adds
`market.pivot_1s`, `market.pivot_1m`, and `market.pivot_event`.

What a later layer should know:

- **Read a scale by its `variant_id`** (`market.variant`: `fast_atr_0p5`, `fast_atr_1`,
  `fast_atr_2` in `pivot_1s`; `slow_atr_*` in `pivot_1m`). In memory a scale is the stage
  `pivot_1s:fast_atr_1`; its events are `products["events"][stage]`.
- **`state`** says whether a row has values: 0 idle (missing data, or the threshold's ATR or
  spread undefined), 1 a segment has begun but no swing is confirmed, 2 in a leg. A new
  `segment` never compares with the one before it.
- **Confirmation is late by design**: a high is known only after price fell `theta` from it.
  `progress` is the early input (see [`progress` and `ext_dist_atr`](pivot-structure-design.md)).
- **Adding a scale** is one line in `SCALES` (a new stage, `add` in the plan, no migration).
  Changing `swings.py` rebuilds every swing stage.

Decisions made: each scale is a stage, so the planner needed no variant logic of its own;
thresholds read the previous row (the previous second, or the minute completed before the
trade's minute); `*_atr` values divide by the ATR in price units frozen with their extreme;
whole-number columns are `smallint` or `integer`; RSI swings were left for their own build.

**Pilot.** GCZ6, 15 sessions built from scratch into a throwaway database, every stage, in
51 s. A plain-Python directional-change detector, fed the trades and the thresholds from the
*stored* candle and volatility rows, reproduced all 39,481 confirmed highs and lows of the
six scales: 0 differences. One scale marked stale and rebuilt alone (`--rebuild`, 26 s) wrote
only `pivot_1s` and `pivot_event`, byte-identical. A `pivot_1s` row takes 316 bytes with its
index, so about 67 GB for GC and SI. Per 23-hour GC session, confirmed highs: 916 at 0.5 ATR,
292 at 1 ATR, and 81 at 2 ATR on `1m@1s` (thresholds of about 2.5, 4.9, and 10 bps); 21, 5,
and 1.5 on `1h@1m` (21, 44, and 89 bps). About half of the confirmed levels are later
breached, and about three quarters of those breaches are reclaimed within the window.

**Full build** (run 2, `research ingest run GC SI --workers 8`: the six scales added to all
12 contracts, nothing else rewritten, in 17 min 55 s, no errors):

- **Rows.** 35,360,100 GC and 35,371,800 SI rows per fast scale (the candle table's keys
  exactly), 589,335 and 589,530 per slow scale, and 2,403,082 events. `pivot_1s` takes 64 GB,
  `pivot_1m` 1.1 GB, the events 0.7 GB; the database is 168 GB. A fresh `ingest plan GC SI`
  reports all 12 contracts `current`.
- **Independent replay, whole year.** All 1,320,027 confirmed highs and lows of the six
  scales (GC 748,249, SI 571,778; 858 contract-sessions) equal the plain-Python replay of the
  DBN trades with thresholds from the stored rows: 0 differences.
- **Structure.** Pivots alternate within every segment; every breach and reclaim refers to a
  stored pivot of its scale; no event is available before its trade; progress stays within
  0 to 1; a row has values exactly when `state` is 2. The continuous series has 257 front
  sessions per product and scale (21,186,000 second rows and 353,100 minute rows each), 255
  of them warm at every scale (not the first stored session, a cold start, and the last,
  mostly missing data).
- **Swings per product** (front and lead sessions, a year): at 0.5, 1, and 2 ATR on `1m@1s`,
  GC confirmed 248,374, 87,034, and 28,341 highs and SI 171,695, 76,619, and 28,050; on
  `1h@1m`, GC 7,754, 2,077, and 545 and SI 7,027, 1,968, and 530. About half the confirmed
  levels are breached later; GC reclaims three quarters of those within the window, SI 60%.
  September front sessions: thresholds of 2.4, 4.8, and 9.8 bps for GC and 4.3, 7.5, and
  14.7 bps for SI on the fast scales, 21 to 144 bps on the slow ones.
- **Finding, fixed by the ATR floor (November 24, above):** `*_atr` values divided by the
  `1m@1s` ATR alone, which after hours without a price change is almost zero. On front
  sessions at most 11 rows of 21 million exceeded 50 ATRs in a year (the 99.99th percentile
  of `leg_atr` was 20 for GC and 38 for SI); in thinly traded lead sessions 1.0% of all
  stored GC fast rows and 3.7% of SI's did. The slow scales were unaffected.
- **Engine.** `research verify` on GCZ6 2026-09-15: all 415 features and 15 trades identical,
  whole session against second by second (5.6 ms per market second, 4.9 ms before).

## Minute rows, hourly statistics, and volatility (November 3–5, 2026)

The stages of the `1h@1m` timeframe and of volatility, built in pieces and measured on GC
and SI. The rows were built from TBBO; MBP-1 trades are the same records, so the findings
carry over. Row counts shifted by the week the downloads differ (TBBO began 2025-11-01,
MBP-1 2025-11-08; [comparison](#rebuilt-from-mbp-1-november-16-2026)). The design is in
the [feature pipeline](feature-pipeline.md#stages) and [plan](plan-1h-and-pivots.md).

**Minute stages** (`bar_1m`, `candle_1h_1m`; run 3: 2 min 29 s, 1.7 GB). Every minute equals
the `candle_1m_1s` row at ordinal `60m`. `bar_1m` has one row per scheduled-open minute
(`slot_ordinal` = m, seconds `60m − 59 … 60m`), with OHLCV from `bars.combine` and the metric
fields from `combine_metrics`. `candle_1h_1m` runs `WindowFeatures`, `MetricWindow(60)`, and
`CandleIndicators(60)` on the minute rows (77 features; `active_ratio` = observed seconds ÷
3,600) and needs 10 sessions of warm-up (ADX), inside the 40-session lead. Migration
`0002_minute_rows` adds the two tables and their continuous views. A missing minute (any
missing second) stores only its keys and status and contributes nothing to windows. The
stage leaves out the session features and the latest-observation family, which repeat the
second row at `60m`. The engine reads its features from the stages
(`pipeline.StageFeatures`), and its `1m@1s` and `1h@1m` window features and bracket ATR
equal the previous composition bit for bit.

**Hourly statistics** (`stats_1h_1m`, migration `0003_hour_stats`; run 4: 1 min 55 s,
0.35 GB; all complete windows matched a reference). One row per minute for the window of
minute rows `m − 59 … m`: 16 features, NULL unless the hourly window is complete:
realized volatility (`rv_bps`, `rv_atr`); the return statistics `ret_std_bps`, `ret_skew`,
`ret_autocorr`, `vr_5` (Lo–MacKinlay, overlapping, bias-corrected), `up_minute_ratio`;
`drawdown_atr`, `drawup_atr`, `high_pos`, `low_pos`; the close against the session VWAP and
the previous session's levels (`session_vwap_atr`, `prior_high_atr`, `prior_low_atr`,
`prior_close_atr`); and `cvd_close_corr`. Context columns: `rv_returns`, `minute_returns`,
`session_vwap`, `prior_high`, `prior_low`, `prior_close`. Windows are self-contained (minute
returns run between consecutive minute closes inside the window); the return statistics
need 10 returns. Sessions are the calendar's intervals. Warm-up is 5 sessions
(hourly ATR(14), 108 periods), so `candle_1h_1m` still sets it. One-minute returns
mean-revert slightly within the hour (`vr_5` 0.89), and price follows net aggression
(`cvd_close_corr` 0.61). NULLs reach the engine as NaN (`StageFeatures.read`).

**Volatility** (`vol_1m` migration `0004`, `vol_1s` migration `0005`; `strategy_core/volatility.py`).
Each stage stores 26 features per window, computed from same-phase windows like the ATR and
NULL unless defined, plus the context columns `atr_price` and `atr_usd` (`vol_1s` adds
`rv_bps`, `rv_atr`, and the context `rv_returns`): ATR horizons (5 and 50), bullish and
bearish ATR, adverse excursions, the window's extremes as levels, the time-of-day normal
(against the previous 20 sessions), the daily scale (prior 14 complete sessions and the
percentile among the previous 20 values), and the current window's true range, Parkinson and
Garman-Klass volatility, and spread, over the ATR.

Its warm-up is a chain of 35 sessions, which the planner rounds to 37 typical GC sessions,
inside the 40-session lead. `vol_1m`: run 5, 596,235 GC and 596,430 SI rows in 1 min 55 s,
0.42 GB; all 1,190,467 complete windows matched an independent recomputation. `vol_1s`: run 6,
35,774,100 GC and 35,785,800 SI rows in 5 min 47 s, 24 GB; all 71,559,900 rows matched, and
220 of 257 front sessions per product were warm. `rv_atr` has a median of 0.68; `spread_atr`
is 0.15 for GC and 0.23 for SI: crossing the spread costs 15 to 23% of a typical minute's true
range. The engine reads `vol_1s.atr_price` for brackets.

**Full-scale checks** (November 5). `research verify` on a GC and an SI week matched every
one of the 235 features and every trade, whole versus second by second, at about 4.1 ms per
market second; a GC year ran in 161 s with 2.6 GB. Backtests warm each contract for the
stored lead, so a backtest started on a roll reproduces every stored row of all seven
stages bit for bit (a test keeps it so); `verify` compares an hour at a time (2.4 GB for a
week). One edge case waits for a `source.py` change: if a download started partway through a
session, a backtest whose warm-up reaches before it would read that partial session while
storage skips it. No download does this (MBP-1 starts on Saturday 2025-11-08)
([todo](status.md#open-items)).

**Baseline rebuild** (November 4, with Paul's authorization to reset the experimental
database): the four project schemas were dropped, `0001_baseline` applied, 2,182 files
registered, and GC and SI built: 12 contracts, 868 contract-sessions, 71,559,900 rows per
second table, 83 GB, 257/257 front sessions per product. One contract (SIU6) stalled in a
COPY for an unknown reason and was rebuilt alone with `--workers 1`; no code changed.
