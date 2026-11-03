# Project: Trading research

Build a backtesting and trading bot development platform for futures (crypto may follow).
Developers configure, troubleshoot, and test custom metrics, strategies, and ML
models trained on those metrics. Historical research comes first; paper and live
trading will reuse strategy logic with a UI for monitoring and human overrides.

Prototype with CME futures GC (gold) and SI (silver); one year of TBBO for GC, SI, PL,
ES, NQ, YM, and RTY is in `data/databento/tbbo/`. Compute and store everything per
contract, so products can be added; each product also reads as one permanent series
(`market.continuous_*`) that takes every session's rows from its front contract. Never
merge trades or prices of different delivery months. Strategies predict only the next few
minutes: a `1h@1m` bias disqualifies a direction, and `1m@1s` features time entries in
the allowed direction. Market data is Databento TBBO only, under the same rules for
every product: trades are exact, but the book is seen only at trades (see
`docs/project/engine.md#data-limits-tbbo-only`). Validate TBBO trades and their
pre-trade top of book before deriving candles or dependent metrics and models.

## Normalized features (required)

Features, strategy signals, and model inputs must never use raw price units. Use basis
points of price, ATR multiples, bounded ratios, oscillators, logs relative to a
trailing average, or elapsed time, declared with `strategy_core.features.Unit`. Raw
prices belong only in data handling and execution: order prices, fills, and P&L. Every
new feature must pass the scale-invariance test (all prices or all sizes multiplied).

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
changes, check accuracy and links. Keep documentation short, avoid duplicated
instructions, and distinguish implemented behavior from planned capabilities.

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

If something goes wrong, stop the affected operation and report relevant findings, data, and logs.
Redact secrets and private content.
If unsure about something, research, search the web, find latest techniques and best practices.

# Next steps

Consider what was recently done, what's in progress, and how it contributes to the goal.
Decide and recommend what to do next.

# Goal: Develop reproducible strategies from historical research through live trading

# Read the handoff and documentation: `docs/project/handoff.md`
