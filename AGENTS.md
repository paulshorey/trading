# Project: Trading research

Build a backtesting and trading bot development platform for futures (crypto may follow).
Developers configure, troubleshoot, and test custom metrics, strategies, and ML
models trained on those metrics. Historical research comes first; paper and live
trading will reuse strategy logic with a UI for monitoring and human overrides.

Start with CME futures GC (gold) and NQ (Nasdaq-100); keep everything per product and
per contract so more products can be added. Strategies predict only the next few
minutes: a `1h@1m` bias disqualifies a direction, and `1m@1s` features time entries in
the allowed direction. Validate Databento TBBO trades and their pre-trade top of book
before deriving candles or dependent metrics and models.

## Normalized features (required)

Features, strategy signals, and model inputs must never use raw price units. Use basis
points of price, ATR multiples, bounded ratios, oscillators, logs relative to a
trailing average, or elapsed time, declared with `strategy_core.features.Unit`. Raw
prices belong only in data handling and execution: order prices, fills, and P&L. Every
new feature must pass the scale-invariance test (all prices or all sizes multiplied).

## Code boundaries

- `lib/strategy-core`: market data types, base bars, rolling windows, per-phase
  indicators, features, strategies, simulated execution, the engine, and ML labels.
- `apps/backtest-runner`: Databento catalog and source, exchange calendars, runs, CLI, API.
- `apps/research-web`: run setup, results, and the trade inspector.
- `lib/research-charts`: reusable frontend charts.
- `lib/db-research`: proposed PostgreSQL schema; revise it before applying (see its README).
- `archive/`: reference-only snapshot of past decisions; do not deploy it or import it into active code.

Keep calculations in Python and separate strategy decisions from data access,
execution adapters, and UI code. Use `@/` for same-app frontend imports and relative
imports inside libraries. Add apps and libraries when a concrete need arises.

## One engine for backtests and live sessions

Backtests, rehearsals, and future paper/live sessions run the same `Engine` on
`MarketChunk`s: a whole session for speed, or one second at a time as live data
arrives. Results must be identical; `uv run research verify SPEC` checks this. Keep
timing explicit (`docs/project/engine.md`): no decision may use data received after it.

Candles follow `docs/sliding-windows/`:

- Build `1h@1m` and `1m@1s` rolling candles at every step from the last 60 disjoint
  base bars (1-minute or 1-second) aggregated from trades.
- Count windows in trading time: scheduled closures from the instrument's exchange
  calendar add no slot. Never infer a closure from missing data; mark it as a gap.
- Run each indicator per phase, on candles one full period apart (13:07, 12:07,
  11:07, …). Never feed consecutive rolling candles into an indicator or add up
  their overlapping volumes.
- Treat adjacent candles as strongly correlated: one portfolio in backtests, and
  chronological, purged splits for ML.

Storage: DBN files are the permanent tick archive. PostgreSQL (local database
`trading`, URL from `TRADING_DATABASE_URL`) holds everything derived: the file catalog,
contracts, rolls, coverage, one-second rows with their metrics, runs, trades, ML rows,
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

# Research and report

If something goes wrong, stop the affected operation and report relevant findings, data, and logs.
Redact secrets and private content.
If unsure about something, research, search the web, find latest techniques and best practices.

# Next steps

Consider what was recently done, what's in progress, and how it contributes to the goal.
Decide and recommend what to do next.

# Goal: Develop reproducible strategies from historical research through live trading
