# Handoff

Updated November 23, 2026, on the new development machine, after its database was rebuilt and
build-order item 6 was run. Read [AGENTS.md](../../AGENTS.md) first: it holds the goal,
the six-step process, and the rules. This page says where the work stands and how to
continue. The [roadmap](roadmap.md) is the map of what is computed and in what order,
[todo.md](todo.md) lists the tasks, and the [build log](build-log.md) records what was
built, how it was checked, and what every experiment found.

## Start here (next session)

**Where the work stands.** Steps 1 and 2 of the process are built and verified for GC and
SI; steps 3 to 6 are the work ([state of each step](roadmap.md#the-process-and-where-it-stands)).
The experiments so far say three things:

- Acting on a fast swing candidate has no edge: it loses about one spread at a one-minute
  bracket and at an hourly one, and no rule on the slow swings changes that
  ([replay](replay.md)). Staying flat is the rule every later input set must beat.
- Acting on a middle (`10m@10s`) candidate has none either: at the market it loses about one
  spread, a limit resting at the candidate's extreme gets a better price and still loses,
  and no agreement rule passed
  ([results](replay.md#results-for-the-middle-timeframe-november-23-2026)). One pattern
  repeated from the fast replay: entering against the `slow_atr_1` trend is worse than
  entering with it.
- Models on the stored price and swing features do not tell which early reversals complete
  better than the distance price has already moved
  ([benchmark](build-log.md#pr-f-results-labels-and-benchmark)). That tested one target on
  one timeframe, without the inputs the process names as the important ones: indicators of
  indicators, divergences, and the book ([limits](roadmap.md#what-the-results-so-far-do-and-do-not-show)).
- The spread is a third of a typical one-minute move and a twentieth of an hourly one, and
  one year holds too few independent days to judge an hourly policy
  ([review](roadmap.md#review-of-november-20-2026)). So a middle timeframe, `10m@10s`, was
  built, and five more years of GC and SI are coming
  ([decisions](roadmap.md#decisions-of-november-20-2026)).

None of this has found an edge. What exists is the machinery to look for one honestly:
three timeframes built by one set of classes, an engine that gives the same rows live and in
backtests, labels that cannot leak, a replay that prices every trade at the book, and rules
for judging a result that were written before the data that will test them
([how results are judged](roadmap.md#how-results-are-judged-on-six-years)).

**What the system is for** is in the roadmap's
[structure](roadmap.md#how-the-analysis-is-structured): state, events, forecasts, and
decisions; three timeframes with one job each; and a decision model that is given a side by
an event and learns whether to take the trade.

**The next tasks**, in order ([build order](roadmap.md#build-order)): items 7 to 9, the base
changes, the book, and the news table, all before the six-year history is built in item 10
([how](#next-steps)). Items 1 to 6 are done.

**This machine is the starting point** (Paul, November 23). Nothing more is needed from the
first one: `fingerprint-old-machine.txt` was not copied and will not be compared. The
databases are known to be equal in row counts and in everything the fast replay reads
([what was checked](build-log.md#the-new-machine-november-23-2026)); `~/fingerprint-new.txt`
is the baseline that later rebuilds are compared with.

**The state of this machine** (November 23): lint and tests pass,
`ingest plan GC SI` reports every contract `current`, and the database (151 GB) holds one year of GC
and SI on three timeframes. One year of MBP-1 for GC and SI is in `data/databento/mbp-1/`
(27 GB). They are the proof of concept: Paul keeps the files of PL, ES, YM, and RTY in cloud
storage, and they return, with NQ and five more years of GC and SI, on the new machine.

How to work in this repository:

- **Decisions.** Paul decides fundamental choices and wants them explained in plain words
  first. Derived technical details (lead counts, thresholds needed for correctness, module
  layout) are decided and reported, not asked. His open choices are under
  [open questions](#open-questions).
- **Paul's view of price data:** windows, not candles. The high and low path matters; open,
  close, and wick shapes are not signals ([principle](feature-pipeline.md#principle-windows-not-candles)).
- **Experiments.** Write the question, the rows, the baseline, and the rule for success into
  a spec before the run; record every variant, successful or not, in the
  [build log](build-log.md); state how many independent trade dates a result rests on.
- **Stored rows equal live rows; keep it so.** A backtest warms each contract for the stored
  lead and computes exactly the stored rows from every roll on. A new stage keeps this as
  long as its warm-up fits the lead.
- **Git and review.** Follow the workspace instructions and the shared Git management skill.
  In a linked worktree, real-data checks need access to the primary checkout's ignored
  `data/databento/` archive.
- **Database:** agents apply migrations and run ingest on `trading` without asking, test
  schema changes on throwaway `trading_test_*` databases first, and ask before dropping or
  truncating anything. A branch that applies a migration to `trading` must be merged
  promptly, since `main` cannot run `research db` until it has the same files.
- **Adding a stage:** follow [the procedure that worked](build-log.md#pr-c-volatility-tier)
  (new modules only, determinism, tests, a pilot on a throwaway database, then the migration).

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
                                        bar_1s, bar_10s, bar_1m (tier 0)
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
(`strategy_core/stages.py`). The one-second rows come from the trades (`stage_bar_1s.py`)
and every longer step's are merged from them (`stage_step_bar.py`); everything above is one
class per kind of stage, built for every timeframe (`timeframes.py`): `stage_step_candle.py`,
`stage_step_stats.py`, `stage_step_vol.py`, and `stage_step_pivot.py`. They are
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
| Code     | Engine, windows, features, ML rows, UI, and database layer (PR #62); one-second ingestion with the continuous series (#63); stages with per-stage versions, derived lead, and carried prices (#70); minute stages and the engine on the stage graph (#74); hourly statistics (#75); minute and second volatility (#76, #77); backtests warmed for the stored lead (#80); MBP-1 as the only source, book events in the engine, fills at the book (#81); **swings of the price path, six scales as stages of their own** (#82); outcome labels as twelve stages, and the benchmark command (#83); sparse storage of the fast swing rows (#89); the after-cost replay and its agreement rules (#90, #91); **the timeframe as a parameter and the middle timeframe `10m@10s`** (#94, #95); **one set of stages for every timeframe** (the PR after them) |
| Data     | One year of MBP-1 (2025-11-09 to 2026-11-05) for GC and SI in `data/databento/mbp-1/` (27 GB), checksums and full decode verified; PL, ES, YM, and RTY were verified too and removed on November 20 (Paul keeps the files in cloud storage); NQ not downloaded; TBBO files deleted |
| Database | Rebuilt on the new machine on November 23 (151 GB, same row counts). As it stood on the first machine: PostgreSQL 18 database `trading`, 146 GB: `0001_baseline` through `0009_one_set_of_stages` applied; the one-second statistics (`stats_1m_1s`, 70,731,900 rows) added November 20; the middle timeframe built November 20 (7,073,190 rows in each ten-second table, 21,219,570 `pivot_10s` rows, 915,075 `pivot_label_10s` rows); GC and SI rows of the seven layer-0 and layer-1 stages **rebuilt from MBP-1 on November 16** (12 contracts, 858 contract-sessions, 2025-11-10 to 2026-11-06, 70,731,900 second rows per second table), and the six swing scales built the same day (since November 19 the fast scales are stored only where they are read: 14,286,813 `pivot_1s` rows; 3,536,595 `pivot_1m` rows, 2,403,082 events), and the twelve label variants on November 17 (5,029,757 `pivot_label_1s` rows, 197,721 `pivot_label_1m` rows); `ingest plan GC SI` reports every contract `current`. The file registry listed the 1,866 MBP-1 files there; the new one lists the 622 of GC and SI |
| Strategy | None. `bias_pullback` is an infrastructure baseline that loses money; no rule or model tested so far beats staying flat after costs |
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

## Moving to the new machine

The new machine has 4 TB. Nothing in the database needs to be copied: every row is rebuilt
from the DBN files by the code, in under an hour for the year held.

1. **Copy** the repository folders under `~/git` (this one, `local-dev`, and the workspace
   `AGENTS.md`), `data/databento/` (27 GB, gitignored; keep each job folder unchanged), the
   shared agent configuration (`~/.agents`, `~/.secrets.sh`, `~/.shortcuts.sh`), and the
   evidence files named in the [build log](build-log.md) (`~/*.hash-*.txt` and the others).
   Agent memory lives outside the repository, in a folder named after the checkout's path.
2. **Install** PostgreSQL 18 (`brew install postgresql@18`, `brew services start
   postgresql@18`), uv, and pnpm; then `pnpm deps:install` at the repository root.
3. **Build the database:**

   ```sh
   psql -d postgres -c "CREATE ROLE trading LOGIN CREATEDB"   # the role the code connects as
   psql -d postgres -c "CREATE DATABASE trading OWNER trading"
   uv run research catalog --verify      # every file against its checksum
   uv run research db migrate            # 0001 to 0009
   uv run research db register
   caffeinate -i uv run research ingest run GC SI 2> ~/ingest-new-machine.log
   uv run research ingest plan GC SI     # every contract `current`
   ```

   Apply the bulk-load server settings first ([storage](../../lib/db-research/README.md#local-setup)):
   a new PostgreSQL has none of them.

4. **Prove it is the same database.** `scripts/db-fingerprint.sh > ~/fingerprint-new.txt`,
   then `diff` it with `fingerprint-old-machine.txt` from the first machine (among the
   evidence files). Integer columns and row counts must match exactly. If a float column
   differs, find out how much before going on: the two machines may have different
   processors, and a difference in the last bits of some features would be the first
   evidence of it. Record what is found in the build log; do not tune anything to hide it.
5. **Check the rest:** `pnpm lint && pnpm test && pnpm build`, `uv run research verify
   apps/backtest-runner/examples/gc-day.json`, and the local services
   (`~/git/local-dev`, the `local-dev-services` skill).
6. **Then the downloads Paul adds:** five more years of GC and SI, later the other
   products. Add each job folder unchanged; do not ingest the older years before
   build-order items 7 to 9 are merged ([decision 13](roadmap.md#decisions-of-november-20-2026)).

One thing from another session was left as it was on the first machine: the branch
`docs/first-executable-pivot-model` (worktree `~/git/trading-wt-review-87`), which holds
unmerged commits. Its content predates the reviews of November 19 and 20; read it before
deciding whether anything in it is still wanted.

## Next steps

The order is the roadmap's [build order](roadmap.md#build-order). Items 1 to 5 are done:
the replay, sparse swing storage, the timeframe as a parameter, the middle timeframe, and
one set of stages for every timeframe
([what was built](build-log.md#one-set-of-stages-for-every-timeframe-november-20-2026)).
Item 6, the replay of the middle timeframe's candidates, is done too
([what was built](build-log.md#replay-of-the-middle-timeframes-candidates-november-23-2026)):
`replay.py` reads its settings from a `Spec` per timeframe, and a new replay is a new `Spec`
with its section in [replay.md](replay.md), written before the run.

**How a timeframe is built now.** `pipeline.TIMEFRAMES` lists the stored timeframes. Each
is a `timeframes.Timeframe`; its window, statistics, volatility, and swing stages come from
`stage_step_candle.py`, `stage_step_stats.py`, `stage_step_vol.py`, and
`stage_step_pivot.py`. Another timeframe is a `Timeframe`, an entry in that list, its
reclaim window and label horizon, and a migration that copies the tables (`0008` is the
pattern). A new kind of stage reads `Timeframe.frame(products)` and is registered for every
timeframe in `pipeline.py`.

**7. Base changes, in one rebuild.**

- *The ATR floor.* The normalizer of `*_atr` features is floored at the spread, as the swing
  threshold is. It changes stored values only where the ATR has collapsed; measure how many
  rows change and record it.
- *The rolling net-flow series* and *the `source.py` change*.

**8. The book between trades.** Freeze the list of inputs first
([metrics](../research/pivots/2026-11-06-second-scale-and-mbp1.md)), switch ingestion's day
cache to keep book events, and measure the build time and the live cost per second: book
events are 20 to 60 times the trades.

**9. The scheduled-news table.** Release times that were published in advance (inflation,
employment, central bank decisions) for the whole history, never the time a number was
revised. A table, two elapsed-time features, and results reported with and without the
minutes around a release.

**10. Six years of GC and SI:** the named checks on the untouched years first
([decision 13](roadmap.md#decisions-of-november-20-2026)), then the build, judged by
[the frozen rules](roadmap.md#how-results-are-judged-on-six-years).

Then items 11 to 16: the yardstick decision model, the event families through steps 3 to
5, the four targets, stored model stages, more products, and the decision model.

Also open, in no fixed order ([todo](todo.md)): store runs and would-be trades in
PostgreSQL (needed before item 11, so that every variant is counted); a session quality
policy; the free `definition` download (needs the account owner); backtests reading stored
rows for speed.

Pivot work so far: the [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design) sets the
observations, thresholds, segments, storage, and labels; the
[pivot/structure contract](pivot-structure-design.md) defines higher and lower highs and
lows, trend, provisional relations, and breaches. The detector is verified as a calculation
and finds turning points sooner than the baselines at a like false-alarm rate
([results](build-log.md#pr-f-results-labels-and-benchmark)).

## Open questions

For Paul. His decisions of November 20 are in the
[roadmap](roadmap.md#decisions-of-november-20-2026).

1. **Session quality.** Degraded sessions are included with only a report. Decision 23
   makes a flagged session ineligible for entries; whether its rows also stay out of
   indicator history is still open.
2. **The live contract** (full-size or micro), which sets the cost model. Until it is
   chosen, results are reported at both.
3. **The largest loss from a peak** that would make a policy unacceptable. The daily cap is
   set (decision 19); a drawdown limit is not.

## Things to know

- Review findings on the ingest planner have reached rare edge cases. The bar for changes:
  fix what can silently corrupt stored values or the series; refuse loudly for unusual
  setups (as for split-day downloads); decline hypotheticals with a test that shows why.
  Prefer rebuilding a contract (cheap: minutes) over more incremental-repair logic.
- **A rebuild in place leaves its old rows behind as dead space.** The unification rebuild
  took the database from 141 GB to 252 GB for 146 GB of live rows, and the disk to 40 GB
  free. `VACUUM FULL` on each partition of the rewritten tables gives the space back (one
  partition at a time needs only that partition's size). Before a large `--rebuild`, check
  that free space covers the tables it rewrites, or build into a fresh database.
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

## Decisions

The core rules above, plus:

| Decision                                                                                             | Why                                                                                                                             | Details                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Prototype with GC and SI                                                                             | Liquid, and far smaller than NQ or ES (GC 32M and SI 13M trades a year against NQ's 103M)                                       | [Data](data.md#what-we-have)                                                     |
| MBP-1 only, the same rules for every product (November 15, 2026, replacing TBBO) | The same trades, plus every change to the best bid and ask, so an order fills at the book it would have met and its cost is measured. The price is size: 123 GB a year for six products | [Data limits](engine.md#data-limits-mbp-1) |
| DBN files are the permanent archive; PostgreSQL holds everything derived                             | Every stored value can be rebuilt or extended; SQL for research; no Parquet layer                                               | [Data](data.md#storage), [storage](../../lib/db-research/README.md)              |
| Store each second's base row and its `1m@1s` candle with features; NULL when undefined, never zero   | Research and ML read compiled rows; base rows stay mergeable into any window; missing, quiet, and invalid stay distinct         | [Ingestion](ingestion.md)                                                        |
| Store features as `double precision`, not `real` (decided November 2, 2026)                          | Stored features equal in-memory and live values exactly                                          | [Measured](ingestion.md#measured)                                                |
| Event-time assignment and per-phase indicators confirmed against the trade-metrics reference (November 2, 2026) | Stored rows equal what backtests and live sessions compute; the two clocks disagree on about 1 trade in 2,000                   | [Differences](ingestion.md#differences-from-the-handoff)                         |
| A builder identity per stage covers its code, settings, packages, columns, and inputs (PR A)         | Rows never mix code versions; a changed stage and those reading it are `stale`, the others stay current, new stages are added   | [Ingestion](ingestion.md#what-the-plan-decides), [pipeline](feature-pipeline.md) |
| Fills at the MBP-1 book the order meets (market orders at arrival, stops at the book their trigger left and never better than it, trade-through targets) | Costs are what the book showed, not an estimate; every setting is recorded with the run | [Timing model](engine.md#timing-model) |
| Databento `definition` records for contract metadata                                                 | Free for this data; expirations, tick sizes, and multipliers                                                                    | [Data](data.md#what-we-have)                                                     |
| uv with Python 3.13, numba, psycopg 3, numbered SQL migrations; `research-web` is the only UI        | Reproducible environments, fast batch runs, simple schema history; checking backtest logic matters most now                     | [README](../../README.md), [UI](metric-explorer.md)                              |

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog --verify         # DBN files against their checksums
uv run research db migrate               # schema migrations
uv run research ingest plan GC SI        # what would be stored; then: run GC SI, status
uv run research backtest apps/backtest-runner/examples/gc.json
uv run research verify apps/backtest-runner/examples/gc-day.json
pnpm lint && pnpm test && pnpm build
```

After downloading MBP-1 files, add the job folder under `data/databento/mbp-1/` unchanged,
then `catalog --verify` and `ingest run`: contracts are extended from their checkpoints and
changed files are rebuilt ([new downloads](ingestion.md#run-it)).

## Running ingestion

History: run #1 (November 3, 2026, 11 min 2 s) stored GC and SI with the one-builder code
and a 5-session lead; run #2 (November 4) rebuilt them with stages; the
[baseline rebuild](build-log.md#baseline-rebuild-gc-and-si) then recreated them from scratch,
[run 3](build-log.md#pr-b1-results-minute-stages) added the minute stages, and
[run 4](build-log.md#pr-b2-results-hourly-statistics) the hourly statistics,
[run 5](build-log.md#pr-c1-results-minute-volatility) the minute volatility, and
[run 6](build-log.md#pr-c2-results-second-volatility) the second volatility. After the reset of November
16, run 1 rebuilt them from MBP-1 and [run 2](build-log.md#pr-d-results-swings) added the swing scales.

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
