# Project: Trading research

Read this page, then the [status](docs/project/status.md): where the work stands, what is
next, and how to work here. The [roadmap](docs/project/roadmap.md) is the plan and the
build order; [results](docs/project/results.md) records what every experiment found.

## Goal

Train a machine-learning model that makes the trading decisions, first in backtests and
then live, for futures (crypto may follow). The model does not read raw prices. It reads
layers of pre-processed signals, built to remove noise and keep what predicts, on several
timeframes at once.

The central signal: on a faster and a slower timeframe, has price reversed and is it now
continuing? When both say "reversed up, continuing up", that is a buy; the mirror is a sell.
That is read from each timeframe's confirmed swing highs and lows and where price now
stands against them. The swings are computed by rule: nothing predicts whether the current
bar is a turning point. The model combines this with other signals, above all whether the swings of RSI and of
volume flow (CVD) agree with price's or diverge from them.

## The process (required order)

Each step is one or more passes over the timeline, and a pass reads only passes that ran
before it. Every step runs on every timeframe with the same code in backtests and live
sessions. A timeframe `W@S` is a window of 60 rows of step `S`, recomputed at every step:
`1m@1s` (fast), `10m@10s` (middle), and `1h@1m` (slow) exist today, and more may
follow. A step divides a minute, so rows never straddle a session close. Write a stage
once, for any timeframe. The state of each step is in the
[roadmap](docs/project/roadmap.md#the-process-and-where-it-stands).

1. **Base rows.** From the raw MBP-1 records, one row per second: OHLCV, CVD, and every
   other number the trades and the book give (the book between trades is not read yet).
   Later steps add metrics and occasional signal events to these rows.
2. **Sliding windows.** A minute candle is always the last 60 seconds and an hour candle the
   last 60 minutes, recomputed at every step: a `1m@1s` row every second and a `1h@1m` row
   every minute, even when the window reaches into the previous session or week.
3. **Indicators, then indicators of indicators.** RSI, EMA, ATR and the like on the windows;
   then the same tools applied to those series (RSI of RSI, EMA of RSI, trends of CVD), so
   the analysis covers derivatives of price and not only price.
4. **Swings and structure of price.** An ATR zigzag on each timeframe: a high is confirmed
   when price has moved the threshold (about 3 ATR) away from it, and a confirmed swing
   never changes. From the confirmed highs and lows and the current price: higher or lower
   highs and lows, the trend they make, which levels the current price has broken, and how
   far the open move has come toward confirming the next swing: `progress`, the deepest
   pullback since the running extreme over the threshold, which does not come back down
   when the move recovers, and `ext_dist_atr`, the distance from that extreme now, in ATRs.
   Neither is a probability. No model predicts a
   reversal: the swings are computed by rule only (Paul, November 23, 2026).
5. **Swings and structure of derived series, and their agreement with price.** The same
   zigzag and structure on RSI, on net volume flow (CVD), and on other indicators, then
   whether their structure agrees with price's or diverges from it, within and across
   timeframes. This is the second pass: it reads the indicators of step 3.
6. **The decision model.** The one trained model. It reads everything above and decides
   buy, sell, or nothing at every second. The position is long, flat, or short and moves
   one step per decision, so the opposite decision closes an open position and cancels its
   orders, whatever its bracket says. Its inference makes the backtest and live decisions. It is
   judged by one portfolio's results after costs. A first version is trained early, on what
   exists, as the yardstick: an input earns its place when the decision model is better
   after costs with it than without it.

Each part has a role ([structure](docs/project/roadmap.md#how-the-analysis-is-structured)):
steps 1 to 3 describe the **state** of the market; swings and structure describe where
price and its derivatives stand against their own recent highs and lows; step 6 makes
**decisions**. The decision is made every second, on `1m@1s`, reading every timeframe. The
slower timeframes give the trend and forbid a trade against it, and the slow ATR sizes the
bracket: stop and target the same distance away, no time limit, closed before the day's
close. Entries are limit orders that last a few seconds. The risk of a trade and the loss that ends a day are percentages of
the account. Trades are intraday and flat before each close; a second mode that holds a
position across sessions is planned as a switch, with intraday the default
([decision 40](docs/project/roadmap.md#decisions)).

Do not skip a step because an early experiment on it was flat. Record the result, then
build the next input the process names and test again
([what has been tested](docs/project/results.md)).

## Data and scope

GC (gold) and SI (silver) are the proof of concept: one year of MBP-1 for each is in
`data/databento/mbp-1/`. No more years are bought: the most recent year of every product
is free, so the model is trained on many products over that one year, across kinds of
market (metals, equity indices, energy, rates, currencies). Build everything for any
number of products and pairs. Compute and store
everything per contract, so products can be added; each product also reads as one permanent series
(`market.continuous_*`) that takes every session's rows from its front contract. Never
merge trades or prices of different delivery months. Products that move together (GC with
SI, ES with NQ) are also read as pairs. The faster timeframe times an entry; the slower one
sets the direction and the size of the move traded, so that the move is large against the
spread and commission. Market data is Databento MBP-1 only (the one other input is a table
of scheduled news release times), under the same rules for
every product: every trade and every change to the best bid and ask, one price level deep
(see `docs/project/engine.md#data-limits-mbp-1`). Trades build the rows and metrics;
simulated orders fill at the book the exchange showed when they arrive. Validate trades
and the book before deriving candles or dependent metrics and models.

## Workspace

Use a new branch in a task worktree for every change. Open a ready PR whose
description gives the next engineer the context, checks, and remaining work.

## Normalized features (required)

Features, strategy signals, and model inputs must never use raw price units. Use basis
points of price, ATR multiples, bounded ratios, oscillators, logs relative to a
trailing average, or elapsed time, declared with `strategy_core.features.Unit`. Raw
prices belong only in data handling and execution: order prices, fills, and P&L. Every
new feature must pass the scale-invariance test (all prices or all sizes multiplied).
A value in ATRs divides by the ATR floored at the spread (`strategy_core.normalizer`,
`candle_*.norm_atr_bps`), never by the bare ATR, which decays to nothing in a market that has
stopped moving. A series other than price (RSI, CVD) is measured in its own ATR.

## Sliding windows count rows, not clock time (required)

Every scheduled-open second and minute is one row, with or without trades and even
when data is missing (its status says so); closures have no rows. Each row carries an
index counter, `slot_ordinal`, that increases by one per row from a fixed calendar
origin (`SessionCalendar.slot_ordinals`). For the row with index `o`:

- its rolling `1m@1s` or `1h@1m` candle is built from rows `o − 59 … o`;
- its phase (the `second_index` or `minute_index`) is `o % 60`;
- indicators read the same-phase candles at `o − 60`, `o − 120`, …: never consecutive
  rolling candles, and never overlapping volumes added up;
- the previous step of the rolling stream is `o − 1`.

Never choose window members, phases, or "one period ago" from clock timestamps: after
an early close (18:15) and a reopen (23:00), the 23:01 candle starts at 17:16 and its
previous same-phase candle covers 16:16–17:16. Never infer a closure from missing data.
Treat adjacent candles as strongly correlated: one portfolio in backtests, and
chronological, purged splits for ML. Details: `docs/sliding-windows/`.

## Code boundaries

- `lib/strategy-core`: market data types, base bars, rolling windows, per-phase
  indicators, features, strategies, simulated execution, the engine, and ML labels.
- `apps/backtest-runner`: Databento catalog and source, exchange calendars, runs, CLI, API.
- `apps/research-web`: run setup, results, and the trade inspector.
- `lib/research-charts`: reusable frontend charts.
- `lib/db-research`: PostgreSQL migrations and storage guidance (see its README).
- `archive/`: reference-only snapshot of past decisions; do not deploy it or import it into active code.

Keep calculations in Python and separate strategy decisions from data access,
execution adapters, and UI code. Use `@/` for same-app frontend imports and relative
imports inside libraries. Add apps and libraries when a concrete need arises.

## One engine for backtests and live sessions

Backtests, rehearsals, and future paper/live sessions run the same `Engine` on
`MarketChunk`s: a whole session for speed, or one second at a time as live data
arrives. Results must be identical; `uv run research verify SPEC` checks this. Keep
timing explicit (`docs/project/engine.md`): no decision may use data received after it.

Storage: DBN files are the permanent tick archive. PostgreSQL (local database
`trading`, URL from `TRADING_DATABASE_URL`) holds everything derived: the file catalog,
contracts, rolls, coverage, one-second and one-minute rows with their metrics (one row
for every scheduled-open slot, each with its `slot_ordinal`), runs, trades, ML rows,
models, and live decisions. Compute stored rows with `strategy-core` code, the same
code live sessions run, and record the builder version. Change the schema only through
numbered files in `lib/db-research/migrations/` (`uv run research db migrate`).

## Research principles

- Start an ML experiment by specifying the decision row, prediction horizon, eligibility,
  target, simple baseline and success criterion. Record results for every predeclared variant.
  Use the development dates in `backtest_runner/periods.py` (`check_period` refuses the
  rest). September 1, 2026 onward is reserved for one final evaluation of the decision model.
- A provisional HL/LH is visible at the decision row. Barrier resolution, subsequent
  confirmed structure and after-cost trade outcomes are different labels. Keep timeouts,
  unknown observations and session ends identifiable. There is one trained model, the
  decision model; if a model's output ever becomes another model's input, it must come from
  an earlier purged training fold and carry its model version.
- Never rank, center, or correlate a forecast against its target within one session or trade
  date when the target is a move inside that session: the move to a later point of the same
  session falls as the current price rises, for any path, so such a measure rewards every
  forecast that fades the session's move. Measure over all rows together and take the
  interval from resampled trade dates
  ([found](docs/project/results.md#a-flaw-in-the-first-skill-measure)).
- State the horizon of a test and what a trade costs there. The spread is about a third of
  a typical one-minute move in GC, a tenth of a fifteen-minute move, and a twentieth of an
  hourly one ([measured](docs/project/roadmap.md#costs-choose-the-timeframe)).
- State how many independent trade dates a result rests on. Rows that share a window or a
  day are not independent, and neither are rows of different products on one date: take
  intervals from resampled trade dates, with every product's rows of a date together.
- Where the order is free, add different information (the book, net flow, the partner
  product, time of day) before another transform of the price path.
- Report every policy result for buys and sells apart, and by product. A year in which a
  product trended makes one side look skilled.
- Evaluate predictive lifts on the same eligible decisions. Evaluate trading policies with
  one portfolio, explicit costs and latency. See [how a policy is evaluated](docs/project/roadmap.md#how-a-policy-is-evaluated).
- Preserve dataset provenance, timestamps, instrument/contract metadata, and execution assumptions.
- Report data gaps and unavailable inputs; do not invent observations or order flow.
- Compute features and decisions using only information available at that time.
- Train and evaluate ML chronologically, with preprocessing fitted on training data only.
- Save enough configuration, data/model versions, costs, and outputs to reproduce and debug experiments.
- Keep credentials, downloaded market data, generated runs, and model artifacts out of git.

## Working conventions

Use pnpm for JavaScript and uv for Python (3.13, `.python-version`); install both at
the workspace root with `pnpm deps:install`. Run Python tools with `uv run`, for
example `uv run research backtest SPEC`. Do not install dependencies inside build,
test, dev, or start scripts (they use `uv run --no-sync`).

For code changes, run `pnpm lint`, `pnpm test`, and `pnpm build`. For documentation
changes, check accuracy and links; they need no test run. Keep documentation short, avoid duplicated
instructions, and distinguish implemented behavior from planned capabilities.

Keep temporary Trading logs, redirected command output, fingerprints, and review notes in
`~/tmp_trading/`. Create it with `mkdir -p "$HOME/tmp_trading"` before redirecting output.
Use a distinct name or subdirectory for each run so concurrent work does not overwrite evidence.
For artifacts moved from the home directory, older notes may still show the original `~/` paths.

**The PR check on GitHub is deliberately small**: lint, `pnpm test:fast` (every test not
marked `slow`, with one short whole-session against second-by-second replay), and the
build. The slow tests, which replay long sessions second by second and rebuild a test
database, run on the developer's machine, which is faster and holds the market data. So
before a PR that changes Python code is marked ready, the agent responsible for it runs
`pnpm test` (everything) on that machine, and when the engine, a stage, or execution changed
also `uv run research verify apps/backtest-runner/examples/gc-day.json`. Both fail loudly:
`pnpm test` errors when PostgreSQL cannot be reached, where a bare `pytest` would skip
those tests, and `verify` exits 1 when features or trades differ or nothing was compared.
Write on the PR the commit tested, the counts passed and skipped, and why anything was
skipped; a later push needs the run again unless it changed only documentation. A PR that
changes only documentation or comments needs neither. Mark a new test `@pytest.mark.slow`
when it takes more than about ten seconds. The whole suite can also be run on GitHub by
hand: the workflow's "Run workflow" with `full` ticked.

The two Python test suites take about 25 minutes each: run them in the background with
their output in a file, and never piped through `tail`, which shows nothing until the end.
Do not edit Python source while a suite, `research yardstick`, `research policy`, or
`research ingest` is running: their workers import the code again, and a run records and
checks the hash of the source it started with. Documentation can be edited meanwhile.

## Local database: agents may write to it

The PostgreSQL database `trading` (`127.0.0.1:5432`, Homebrew `postgresql@18`) is the
local development database; every derived row in it can be rebuilt from the DBN files, and
there is no production database yet. When a task needs it, agents apply migrations
(`uv run research db migrate`), register files, and run `research ingest`, without asking
first. An applied migration can never change, so get it right in tests first (they use
throwaway `trading_test_*` databases), then apply it to `trading` once the code that needs
it is final. Branches without an applied migration's file cannot run `research db` or
`research ingest` until they include it, so merge such a branch promptly and tell other
agents to rebase. Ask before dropping or truncating tables, or deleting rows other than
through `research ingest`. Report what you ran.

# Research and report

If something goes wrong, stop the affected operation and report the relevant findings,
data, and logs. Redact secrets and private content.
When unsure, research before deciding: search the web for current techniques and best practices.

# Next steps

Consider what was recently done, what is in progress, and how it serves the goal.
Decide and recommend what to do next.

The goal is a trained model that makes the trading decisions, from historical research
through live trading. Each task should name the step of the process it advances.
