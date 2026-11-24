# Build log

What was built, how it was checked, and what each experiment found, newest first. The
[handoff](handoff.md) says where the work stands and what to do next; this page is the
record behind it. "This PR" in a section means the PR it names (the heading or the numbers in
the text), not the one that created this page. Add a section here when a stage, a rebuild,
or an experiment is finished.

## The first decision model (November 24, 2026)

Build-order item 9, step 6 of the process. The [spec](yardstick-spec.md) holds the settings
and the [results](yardstick-spec.md#results-november-24-2026): no skill at the bracket's
horizon, a small one a minute ahead, and every policy cell a loss.

**What was built**

- `strategy_core/targets.py`: the move ahead in R, and the mid-price's move over fixed
  horizons.
- `backtest_runner/dataset.py`: the decision dataset, one row a minute, with the engine's
  741 features read from the stored rows by the engine's names, eligibility, the cost of a
  round trip in R, and the targets from the DBN files' trades and book. Cached under
  `data/research/` by everything that determines it (4 minutes to build with 8 workers).
- `backtest_runner/yardstick.py` (`research yardstick GC SI`): walk-forward `ridge` and
  `trees`, their skill, what the opening rule would decide row by row, and the horizon map.
  42 minutes, most of it the map's 35 fits a month.
- `backtest_runner/policy.py` (`research policy RUN GC SI`): the model as an engine strategy
  and the replay of the spec's eight cells under two executions. The features and the
  forecast of a session are computed once and every cell's engine decides on them
  (`Engine.process(chunk, frame)`): 7 minutes for 8 product-months.
- `research.run` (migration `0012_research_runs`): each run is written with its frozen
  settings before it reads anything, and its result when it ends. Runs 1 to 3 are there.

**The first skill measure was biased, and the run caught it**
([what happened](yardstick-spec.md#a-flaw-in-the-first-skill-measure)). A correlation taken
within each trade date rewards any forecast that fades the session's move; a forecast of
"minus the session's return so far" scored 0.65 on it. The measure now ranks all rows
together. The rule is in AGENTS.md, and a test on a simulated random walk keeps it.

**Checks**

- The dataset's feature names and order equal the engine's (`StageFeatures.specs`).
- `research verify` on the example GC day: identical features and 18 identical trades, as
  before the engine changes; 8.8 ms a market second with 741 features.
- Tests: strategy-core 152, backtest-runner 55; `ruff` passes.

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

Build-order item 7, step 6 of the process ([decisions 35 to 39](roadmap.md#decisions);
[timing model](engine.md#timing-model)).

**What was built** (`strategies.py`, `execution.py`, `engine.py`; none is in a stage's
identity, so no stored row changed)

- **A decision at every second, in two parts.** `signals` is the decision while flat (open a
  long, open a short, nothing); `closes` is the decision while a position is open. A closing
  decision is a market order sent at its decision time: it fills `order_latency` later
  whatever the bracket says, unless the stop or the target fills first (`Simulator.close`).
  The position therefore moves one step per decision.
- **Entries.** A market order, or a limit order at the touch of the book it meets that is
  cancelled after `wait_s` (`Entry`, `Simulator.rest`). It fills when a trade prints through
  its price, or, with `passive_fill: queue`, when the size displayed ahead of it and its own
  have traded at its price. The order's state is kept on the position, so a session
  processed one second at a time fills it exactly as a whole session does.
- **The bracket** may have no time limit (`max_hold_s: None`), may be sized by any
  timeframe's ATR (`atr`; each timeframe's ATR is in the frame's context), and may move its
  stop to the entry price after a move in favour (`breakeven_atr`), in force once the engine
  has learned of that trade and its amended order has arrived.
- **Risk.** With `account_usd`, a position is as many whole contracts as keep its stop's risk
  within `risk_pct`; a signal whose one contract risks more is not traded and is counted. A
  session stops opening positions once it has lost `daily_loss_pct` of the account, or
  `daily_loss_r` R without an account size.
- **The trend gate** (`strategies.trend_gate`): a long needs no named trend down, a short
  none up; it never blocks a closing decision.
- **Costs for the decision.** The strategy also sees `exec.spread_r` and `exec.commission_r`:
  what a trade decided at that row would cost in R, from the book the engine holds. They are
  not features and never reach a model.

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

## The withdrawn design removed (November 23, 2026)

Paul withdrew the trained reversal model ([decision 29](roadmap.md#decisions)) and asked for
everything that served it to be removed. The last commit that has it is `df5a907`.

**Removed**

- The label stages (`stage_pivot_label.py`, `pivot_labels.py`: eighteen stages) and their
  tests. Migration `0010_remove_pivot_labels` drops `market.pivot_label_1s`, `_10s`, `_1m`,
  their views, and their registry rows.
- `benchmark.py` (the swing detectors against hindsight swings, and the reversal models) and
  `replay.py` (the candidate replay), with `research benchmark` and `research replay`. Their
  results stay recorded: [labels and benchmark](#pr-f-results-labels-and-benchmark), and the
  [record of the replays](../archive/replay.md). Their spec is
  [archived](../archive/pivot-label-spec.md).
- From the documents: the roadmap was cut to the plan in force, and the model-stage rules of
  the feature pipeline to one paragraph.

**Kept on purpose**

- `Simulator.rest` and `labels.attempt_limit` (a limit entry resting at a price): build-order
  item 7 needs them in the engine.
- `periods.py`: the development period, the test months, and the check that refuses the
  holdout, which every experiment must call.
- `swings.released`, which only the label stages called beside the swing stages: `swings.py`
  is part of every swing stage's identity, so it is not edited for tidiness.

**What changed in storage**

- The fast swing scales no longer keep a row at each label's decision row
  (`pipeline.STORED_ROWS` is `events+step_ends_10s:v4`), so the three `pivot_1s` stages were
  `stale` and were rebuilt: `research ingest run GC SI --rebuild --workers 8`, run 2, 5.5
  minutes, writing only `pivot_1s` and `pivot_event`. `pivot_1s` holds 25,699,173 rows
  (31,095,900 before); events are unchanged at 2,787,648. `ingest plan GC SI` reports all 12
  contracts `current`.
- Tests: strategy-core 132, backtest-runner 45 (the removed tests were those of the removed
  code); `ruff` passes.
- Nothing else changed: the 324 fingerprints of every table but `pivot_1s` equal the
  baseline's. The baseline was taken again (`~/fingerprint-new.txt`, 360 lines; the one
  before is `~/fingerprint-before-label-removal.txt`).

## Replay of the middle timeframe's candidates (November 23, 2026)

Build-order item 6: step 4's candidates judged by step 6's measure. The spec was committed
before any code read an outcome, and the result is in
[replay.md](../archive/replay.md#results-for-the-middle-timeframe-november-23-2026): no group passed.

**What was built**

- `replay.py` takes its settings from a `Spec`: the timeframe of the candidates, the label
  variants, the brackets, the entry orders, the cost models, and whether the trusted-market
  eligibility ([decision 23](roadmap.md#decisions)) and the daily loss cap
  ([decision 19](roadmap.md#decisions)) apply. `fast` is the replay of
  November 19 with nothing changed; `mid` is new (`--timeframe mid`). Another timeframe is
  another `Spec`.
- `Simulator.rest` and `labels.attempt_limit` (`strategy-core`): an entry as a limit order
  resting at a price until an expiry. It fills on arrival when the book is already at or
  through its price, else at its price when a trade prints through it. The engine's
  strategies still send market entries only; this is for would-be trades.
- `portfolio` applies the daily loss cap and counts the orders it refused and the sessions
  in which it bound. Results are also given at micro costs, for buys and sells apart, and as
  one portfolio in each half of the period for policies that fit nothing.
- `benchmark.py` has the middle stream (`STREAMS["mid"]`), so `research benchmark models`
  accepts the `mid_*` labels. No middle benchmark was run, and no detector task is defined
  for the middle scales.

**Checks**

- The fast replay rerun with the new code reproduces the tables of November 19 exactly
  (see below), so the refactor changed nothing it should not.
- Tests: strategy-core 158, backtest-runner 68; `ruff` passes. `execution.py` and `labels.py`
  are in no stage's identity: `ingest plan GC SI` still reports every contract `current`.

## The new machine (November 23, 2026)

The database was rebuilt from the DBN files on the new Mac (Apple M1 Max, 10 cores, 64 GB,
4 TB), following [the handoff](handoff.md#setting-up-a-machine).

- `research catalog --verify`: 622 files, 29.19 GB, no checksum failure, 12 files `degraded`.
- Migrations `0001` to `0009` applied; 622 files registered. (The old registry listed 1,866:
  it also held the four products whose files were removed.)
- `research ingest run GC SI`, run 1, 8 workers: 12 contracts, 858 contract-sessions,
  70,731,900 second rows, no failure; `ingest plan GC SI` reports all 12 contracts `current`.
  The database is 151 GB. Log: `~/ingest-new-machine.log`, result `~/ingest-new-machine.json`.
- **Row counts equal the old machine's** in every table that this log records: 70,731,900 in
  the second tables, 7,073,190 in the ten-second tables, 21,219,570 `pivot_10s`, 31,095,900
  `pivot_1s`, 3,536,595 `pivot_1m`, 2,787,648 events (2,403,082 and 384,566), and 5,029,757,
  915,075, and 197,721 label rows.
- **The fingerprints could not be compared.** `~/fingerprint-old-machine.txt` is not on this
  machine, nor are the other evidence files of the first one (`~/*.hash-*.txt`,
  `~/replay-gc-si.json`). The new fingerprint is `~/fingerprint-new.txt` (576 lines: per
  table, contract, and variant). Whether the two processors give bit-identical floats is
  therefore not shown, and will not be: Paul decided the same day that this build is the
  starting point, so `~/fingerprint-new.txt` is the baseline for later rebuilds.
- **What stands in for it, in part:** `research replay GC SI` on the rebuilt database gives
  2,783,418 candidates and reproduces every number of the two tables recorded on November 19
  ([replay](../archive/replay.md#results-november-19-2026)): the eligible counts, R to four digits,
  intervals, portfolio fills, net dollars, and drawdowns. Those depend on the fast labels,
  both ATRs, the slow swings, and every trade and book record of 342 sessions, so those are
  equal to the precision that changes a tick or a fill. It does not cover the middle
  timeframe, the statistics and volatility tables, or last-bit differences that change no
  outcome.
- `pnpm lint`, `pnpm test`, `pnpm build`, and `research verify` on the example GC day pass.

Two steps of the handoff were wrong and are corrected there: the database needs the role
`trading` (`createdb trading` alone gives a database the code cannot open), and a new
PostgreSQL has none of the bulk-load settings; they were applied as the
[storage page](../../lib/db-research/README.md#local-setup) lists them.

## One set of stages for every timeframe (November 20, 2026)

Build-order item 5, asked for by Paul: `1m@1s` should not be managed by its own logic. Its
window, statistics, volatility, and swing stages are now the classes that build `10m@10s`
and `1h@1m` (`stage_step_candle.py`, `stage_step_stats.py`, `stage_step_vol.py`,
`stage_step_pivot.py`), and `stage_candle_1m_1s.py`, `stage_vol_1s.py`, and
`stage_pivot_1s.py` are gone. Only the one-second rows stay a module of their own
(`stage_bar_1s.py`): they are made from the trades, and every longer step is merged from them.

**What changed for the stored rows** (migration `0009_one_set_of_stages`)

- `stats_1m_1s` is new: the window statistics every timeframe has, 16 features, 70,731,900
  rows. Realized volatility (`rv_bps`, `rv_atr`, `rv_returns`) moved to it from `vol_1s`,
  where the other timeframes keep it; the engine's feature names are the same
  (`1m@1s.rv_bps`). The engine has 639 features (625 before).
- The fast swing scales read the spread from the step rows' last bid and ask, as the other
  scales do, instead of `candle_1m_1s.book_spread_bps`. It is the same quantity: on a week
  of stored SI rows the two agreed on all 414,000 rows. The shared code now computes it
  with the arithmetic the fast scales used.
- What still differs between timeframes is declared on the timeframe, not copied: the
  session features and the latest observation are stored on `1m@1s` only, the fast swing
  rows are stored sparsely, and each timeframe has its reclaim window and label horizon.
- The stored-row rule names its step (`STORED_ROWS` v3), so a shorter merged step would
  mark the sparse rows stale (a review finding on #95).

**Checks**

- **In memory, old code against new:** on a synthetic two-session world with closures, gaps,
  and quiet minutes, all 3,058 column hashes of every stage are identical, whole sessions and
  uneven groups of seconds alike, and realized volatility is identical in its new table.
- **The whole year** (`research ingest run GC SI --rebuild --workers 8`, run 7, 53 minutes;
  216 fingerprints, per table and contract, taken before and after):
  - identical: `candle_1m_1s`, `vol_1s` (the columns it kept), realized volatility (old
    `vol_1s` columns against `stats_1m_1s`), `pivot_1s`, `pivot_label_1s`, every ten-second
    and minute step, window, statistics, and volatility table. **The fast timeframe did not
    change by one bit**, so the benchmark and the replay recorded on the fast labels stand
    as they are;
  - changed, with the same row counts: the middle and slow swing rows, their labels, and
    their events. Measured by building three weeks of SIZ6 with the old and the new code:
    only `theta_bps`, `progress`, and `displacement` (and `theta` and `overshoot` of events)
    differ, by at most 4.4 parts in 10 trillion, where the spread floor sets the threshold.
    No swing, event, class, age, level, or label outcome differs. It is the rounding of the
    spread's arithmetic, which the middle and slow scales now share with the fast ones.
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

Evidence: `~/unify.hash-before.txt`, `hash-after.txt`, `hash-diff.txt`, `ingest.json` and
`.log`, `verify.json`, and `~/fingerprint-old-machine.txt` (from `scripts/db-fingerprint.sh`,
to compare with the database rebuilt on the new machine).

## The middle timeframe `10m@10s` (November 20, 2026)

Build-order item 4. `10m@10s` is a window of 60 rows of ten seconds, between `1m@1s` and
`1h@1m`. Its stages are the classes that build the `1h@1m` ones, for another `Timeframe`.

**What was built**

- Stages `bar_10s`, `candle_10m_10s`, `stats_10m_10s`, `vol_10s`, the swing scales
  `mid_atr_0p5`, `mid_atr_1`, `mid_atr_2` (`pivot_10s`), and six label variants
  (`pivot_label_10s`): 38 stages in all. `pipeline.MERGED` lists the stored timeframes.
- Migration `0008_middle_timeframe`: each table is created `LIKE` its minute counterpart, so
  the columns are the same, with its continuous view.
- The engine (`pipeline.StageFeatures`) joins every merged timeframe as of each second, with
  its age (`10m@10s.age_s`): 625 features, 415 before. The `1h@1m` feature names did not change.
- Label parameters were frozen first ([spec](../archive/pivot-label-spec.md#middle-scales-added-november-20-2026-before-any-label-was-computed)):
  a horizon of 240 rows (40 minutes) and a reclaim window of 30 rows.

Decisions made here (derived, reported in the PR):

- **The fast swing rows are kept at every ten-second row's end**, not only at minute ends
  ([rule](ingestion.md#fast-swing-rows-are-stored-where-they-are-read)), so a decision on
  the middle timeframe finds the fast scales in storage. `pivot_1s` went from 14,286,813 to
  31,095,900 rows.
- **`stats_*` column names stay** (`minute_returns`, `up_minute_ratio`, `vr_5`); on another
  timeframe they count its step rows, and the descriptions say so. A rename would have meant
  a migration of the hourly table and its view for no change in values.
- **The list of stored timeframes moved to `pipeline.py`**, out of `timeframes.py`, which is
  part of every step stage's identity: adding a timeframe now rebuilds nothing else.

**Results** (`research ingest run GC SI --rebuild --workers 8`, run 6, 13 minutes; the
database went from 110 GB to 141 GB):

- 7,073,190 rows in each ten-second table, exactly a tenth of the 70,731,900 second rows;
  21,219,570 `pivot_10s` rows; 384,566 events; 915,075 label rows. The continuous series has
  2,118,600 ten-second rows per product over 257 sessions. `ingest plan GC SI` reports every
  contract `current`.
- **Nothing else changed.** The 96 fingerprints of the hourly tables, the slow swings, the
  labels, and the fast and slow events equal those taken after the refactor.
- **The middle scales sit between the others.** September front sessions, thresholds at
  0.5, 1, and 2 ATR: 8.2, 16.5, and 34.3 bps for GC and 13.4, 27.3, and 57.0 bps for SI
  (fast: 2.4, 4.8, 9.8 and 4.3, 7.5, 14.7; slow: 21 to 144). Confirmed highs in the year at
  1 ATR: 11,587 GC and 10,665 SI (fast 87,034 and 76,619; slow 2,077 and 1,968).
- **Labels.** Candidates that reverse: 46% and 62% at 0.5 ATR (25% and 50% stages), 42% and
  59% at 1 ATR, 28% and 46% at 2 ATR, like the other timeframes. `mid_atr_1_q25` has
  136,611 candidates, about forty times what the slow scale gave the first benchmark.
- **Warm sessions.** `vol_10s` is warm on 464 of 858 contract-sessions (its daily chain needs
  37 sessions, as `vol_1m`'s does); the candle and statistics on 834.
- **Engine.** `research verify` on the example GC day (GCZ6 2026-08-31, 82,800 seconds): all
  625 features and all 18 trades identical, whole session against second by second, at 7.0 ms
  per market second (5.6 ms with 415 features), inside the 100 ms close delay. The example
  backtest gives the same 18 trades and result on `main` and on this branch: the added
  features change no decision of the baseline strategy.
- **Pilot first:** GCZ6, 15 sessions, built from scratch into a throwaway database in 69
  seconds; volume equal across the 1-second, 10-second, and 1-minute rows.

Evidence: `~/middle-timeframe.ingest.json` and `.log`, `hash-after.txt`, `hash-diff.txt`
(empty), `pilot.json` and `.log`, `verify.json`.

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
  minute branch: six 10-second rows equal one minute (sums, extremes, close, missing), every
  stage gives identical rows in any chunking, windows hold 60 rows across a closure, and the
  swing scales publish one row per step row. A step that does not divide a minute is refused.
- **Stored rows did not change.** Before the rebuild, every row of the eight affected tables
  was hashed per contract over all columns but `builder_id` (96 fingerprints: `bar_1m`,
  `candle_1h_1m`, `stats_1h_1m`, `vol_1m`, `pivot_1m`, `pivot_label_1m`, `pivot_label_1s`,
  `pivot_event`). `research ingest run GC SI --rebuild --workers 8` (run 5; 12 contracts, 858
  contract-sessions, 6 minutes) rewrote the stale stages, and all 96 fingerprints are identical.
  `ingest plan GC SI` reports every contract `current`; `pivot_1s` still holds 14,286,813 rows.
- **Not done here:** storing `10m@10s` (its tables, labels, and join into the engine) is
  item 4 ([how](handoff.md#next-steps)).

Evidence: `~/timeframe-refactor.hash-before.txt`, `hash-after.txt`, `hash-diff.txt` (empty),
`ingest.json`, and `ingest.log`.

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
[pivot-label-spec.md](../archive/pivot-label-spec.md) before any label was computed. Evidence:
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
the [spec](../archive/pivot-label-spec.md#context-inputs-added-november-17-2026-before-any-run) before
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

**Withdrawn November 19, 2026.** The last two sentences went further than the experiment:
it tested the swing rows as they are, not divergences, indicators of indicators, or pivots
of RSI and CVD, which did not exist. Structure and divergence are in the
[build order](roadmap.md#build-order)
([limits of this result](roadmap.md#what-the-results-so-far-do-and-do-not-show)).

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
profitability, use the separate [portfolio replay](roadmap.md#how-a-policy-is-evaluated).
The [audit specification](../archive/pivot-label-spec.md#probability-audit-november-18-2026)
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
  rows; whether to floor the normalizer instead is an [open question](handoff.md#open-questions).
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
