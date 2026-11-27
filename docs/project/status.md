# Status

Updated November 27, 2026. Read [AGENTS.md](../../AGENTS.md) first: the goal, the six-step
process, and the rules. This page says where the work stands, what is next, and how to work
here. Rewrite it at the end of each session; it is not a history.

| To know | Read |
| --- | --- |
| The plan, the decisions in force, how a result is judged | [roadmap.md](roadmap.md) |
| What every experiment found | [results.md](results.md) |
| What was built and when | [build-log.md](build-log.md) |
| The data files and how they become stored rows | [ingestion.md](ingestion.md) |
| Stages, tiers, units, warm-up | [feature-pipeline.md](feature-pipeline.md) |
| Swings and structure | [pivot-structure-design.md](pivot-structure-design.md), [series-structure-spec.md](series-structure-spec.md) |
| The engine, timing, simulated orders | [engine.md](engine.md) |
| The decision model | [yardstick-spec.md](yardstick-spec.md) |

## Where the work stands

**Every step of the process has code that runs end to end.** Base rows, windows and
indicators on three timeframes, rule-based swings of price, RSI, and CVD, an engine that
takes a decision every second, and a first decision model fitted walk-forward and replayed
in that engine ([state of each step](roadmap.md#the-process-and-where-it-stands)).

**No edge has been found.** The model has no skill over the hours a trade lasts, and its
calibrated forecast is flat, so it opens no position. It finds a small predictability one
minute ahead. The swings of RSI and of CVD added nothing detectable
([results](results.md)). Staying flat is the rule to beat.

**The evidence is thin.** One year of two products that move together gives 86 test dates;
a difference between two forecasts is known to about ±0.05 of rank correlation. Paul's
decision of November 27: no more years are bought; the model is trained on many products
over the free year, and the clock becomes an input
([decisions 13, 42, 43](roadmap.md#decisions)).

## Next

The [build order](roadmap.md#build-order), reordered November 27:

1. The clock and session inputs.
2. Whether the minute-end result holds between minute ends.
3. One-second values stored only where they are read, so that many products fit the disk.
4. More products on the free year, one of each kind of market first.
5. The book between trades and the scheduled-news table.
6. The codes that compare the structures of price, RSI, and CVD.

## Open questions for Paul

1. **Which products, and where are their files?** PL, ES, YM, and RTY are in Paul's cloud
   storage, NQ is not downloaded. The plan wants other kinds of market too (energy, rates,
   a currency).
2. **Is the free year a moving window?** If a newer month becomes free each month, history
   grows at no cost by downloading as it does.
3. **The evaluation for many products** in the roadmap is proposed, not confirmed: two
   held-out products, and a result counting only on at least three kinds of market
   ([how results are judged](roadmap.md#how-results-are-judged)).
4. **Session quality.** A flagged session is ineligible for entries (decision 23); whether
   its rows also stay out of indicator history is open.
5. **The live contract** (full-size or micro), which sets the cost model. Until it is
   chosen, results are reported at both.
6. **The largest loss from a peak** that would make a policy unacceptable. The daily limit
   is a percentage (decision 36); a drawdown limit is not set.

## Open items

Smaller than a build-order item, or waiting for one.

- **The current pullback over the frozen threshold** as its own feature beside `progress`
  (the deepest pullback). It needs the swing stages rebuilt; do it with the comparison codes.
- **The horizon map with all 1,449 features** was not rerun: it takes over two hours. Run
  `uv run research yardstick GC SI` from a terminal.
- **The sliding-clock control:** the same policy deciding at minute ends and at every
  second, with the first policy that is not flat.
- **The candidate summary assumes market entries** (`service.backtest`); it is not a
  passive strategy's execution. Use the limit path, or label the summary.
- **Floor the daily ATR at the spread** (`day_range_ratio`, `day_high_dist`,
  `day_low_dist` in `vol_*`). No row is affected today; make it with the next rebuild.
- **Runs and trades in PostgreSQL:** backtest runs are still `data/runs/*.json`; the UI
  reads those.
- **A data audit command:** the checks made by hand on new files (decode, record types,
  receive order, tick sizes, crossed books, flags) as one command, before more products.
- **Contract definitions** are not downloaded (free; the job needs the account owner).
- **Backtests recompute their warm-up** from the files instead of reading stored rows:
  about a third of a year-long run.
- **Return the database's dead space:** 375 GB on disk after rebuilds; `VACUUM FULL` one
  partition at a time.
- **CI:** the GitHub Actions warn about Node 20.
- **Later:** paper sessions on the live feed, restart from checkpoints, a broker adapter.

## How to work here

- **Decisions.** Paul decides fundamental choices and wants them explained in plain words
  first. Derived technical details are decided and reported, not asked.
- **Paul's view of price data:** windows, not candles. The high and low path matters; open,
  close, and wick shapes are not signals.
- **Experiments.** Write the question, the rows, the baseline, and the rule for success into
  a spec before the run. Record every variant in [results.md](results.md), successful or
  not, with the number of independent trade dates it rests on.
- **Stored rows equal live rows.** A backtest warms each contract for the stored lead and
  computes exactly the stored rows. `research verify` checks whole-session against
  second-by-second.
- **A stage's source files are its identity.** Editing a file in a stage's `MODULES`, even
  a comment, makes that stage and every stage reading it stale, and stale stages need a
  rebuild. Run `uv run research ingest plan GC SI` before merging such an edit.
- **A variant's name never changes meaning.** A changed definition gets a new name; the old
  one is retired.
- **The database** is local and can be rebuilt from the files. Apply migrations and run
  ingest without asking; ask before dropping tables or deleting rows
  ([rules](../../AGENTS.md#local-database-agents-may-write-to-it)).
- **Real-data checks in a worktree** need the primary checkout's ignored `data/` folder.
- **Never print full process command lines on this Mac:** some carry secrets.

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog --verify         # DBN files against their checksums
uv run research db migrate               # schema migrations
uv run research ingest plan GC SI        # what would be stored; then: run GC SI, status
uv run research backtest apps/backtest-runner/examples/gc.json
uv run research verify apps/backtest-runner/examples/gc-day.json
uv run research yardstick GC SI          # dataset, walk-forward fit, report (about an hour)
pnpm lint && pnpm test:fast && pnpm build   # pnpm test runs the slow tests too
```

Ingestion, its failures, and adding files: [ingestion.md](ingestion.md).

## This machine

- **Data:** one year of MBP-1 for GC and SI (2025-11-09 to 2026-11-05) in
  `data/databento/mbp-1/`, 27 GB, gitignored.
- **Database:** PostgreSQL 18 (Homebrew), database `trading`, 375 GB; migrations to `0016`;
  `ingest plan GC SI` reports every contract `current`.
- **Baseline:** `~/fingerprint-series.txt` (`scripts/db-fingerprint.sh`), 1,008 lines; a
  rebuild by the same code must reproduce it.
- **Model runs:** `research.run`; the latest yardstick run is 12. Models and each row's
  forecasts are in `data/models/yardstick/run-<n>/`.
- **Services:** UI on 4400 and API on 4401 under `~/git/local-dev`.
- `DATABENTO_API_KEY` is exported by `~/.secrets.sh`; the code does not use it yet.

## Setting up another machine

Nothing in the database is copied: every row is rebuilt from the files.

1. **Copy** the repository folders under `~/git`, `data/databento/` (keep each job folder
   unchanged), and the shared agent configuration.
2. **Install** PostgreSQL 18, uv, and pnpm; `pnpm deps:install`; apply the bulk-load server
   settings ([storage](../../lib/db-research/README.md#local-setup)).
3. **Build:**

   ```sh
   psql -d postgres -c "CREATE ROLE trading LOGIN CREATEDB"
   psql -d postgres -c "CREATE DATABASE trading OWNER trading"
   uv run research catalog --verify
   uv run research db migrate
   uv run research db register
   caffeinate -i uv run research ingest run GC SI 2> ~/ingest.log
   uv run research ingest plan GC SI     # every contract `current`
   ```

4. **Compare** `scripts/db-fingerprint.sh` with the baseline. Row counts and integer
   columns must match; if a float column differs, find out by how much before going on.
5. **Check:** `pnpm lint && pnpm test && pnpm build` and `research verify`.
