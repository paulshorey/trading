# Backtesting and trading bot development platform

A developer platform for building, testing, and running short-horizon futures
strategies and the machine-learning models behind them. It prototypes with CME GC
(gold) and SI (silver), the proof of concept; other products are added later.

The engine reads Databento MBP-1 trades and best-quote changes. In the baseline strategy, a rolling
`1h@1m` candle (the last 60 one-minute rows, every minute) sets the direction bias; a
rolling `1m@1s` candle (the last 60 one-second rows, every second) times entries.
Windows count rows of scheduled trading time through an index counter on every row,
never clock time, so closures never break them. A bracket sized in ATRs
exits within minutes. Every feature is normalized: basis points, ATR multiples,
ratios, oscillators, or time. The same engine runs whole-session backtests and
second-by-second historical rehearsals. A live feed and broker adapter are planned.

The goal is a trained model that makes the trading decisions from layers of signals on
several timeframes: indicators, the swing structure of price and of its derivatives, and
whether they agree ([goal and process](AGENTS.md#goal)). The
[roadmap](docs/project/roadmap.md#the-process-and-where-it-stands) shows which steps are
built, what the results so far show, and the build order.

## Workspace

| Path                   | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `lib/strategy-core`    | Base bars, rolling windows, features, strategies, execution, engine, labels |
| `apps/backtest-runner` | Databento catalog and source, calendars, runs, CLI (`research`), local API  |
| `apps/research-web`    | Run setup, results, and the second-by-second trade inspector                |
| `lib/research-charts`  | Reusable chart components                                                   |
| `lib/db-research`      | PostgreSQL migrations and storage design (local database `trading`)         |
| `data/`                | Databento job folders and saved runs (all gitignored)                       |

`archive/` is reference-only, excluded from active builds and deployments.

## Run locally

Requirements: Node 20+, pnpm 10.28.1, [uv](https://docs.astral.sh/uv/) 0.13+ (it
installs Python 3.13 from `.python-version`), and PostgreSQL 18 for stored data.

```sh
pnpm deps:install    # pnpm install --frozen-lockfile && uv sync --frozen
pnpm dev             # research UI at http://127.0.0.1:4400, API on 8001
uv run research db migrate   # local database `trading`; setup in lib/db-research
```

```sh
uv run research catalog                                              # data on disk
uv run research backtest apps/backtest-runner/examples/gc-day.json
uv run research verify apps/backtest-runner/examples/gc-day.json # live path = backtest
uv run research rehearse apps/backtest-runner/examples/gc-day.json --speed 60
uv run research ingest plan GC SI    # stored one-second rows; one series per product
pnpm lint && pnpm test && pnpm build
```

Market data is not in git: one year of Databento MBP-1 for GC and SI lives in
`data/databento/mbp-1/` (27 GB).
See [the data and ingestion](docs/project/ingestion.md) for the layout and verification.

## Documentation

- [Engine: backtests and live sessions](docs/project/engine.md): timing, fills, speed, verification.
- [Sliding-window candles](docs/sliding-windows/README.md) and their [design](docs/sliding-windows/design.md).
- [The data and ingestion](docs/project/ingestion.md), the [roadmap](docs/project/roadmap.md) (the
  steps of the process and the build order), the
  [status](docs/project/status.md) with the current state and next steps, the
  [build log](docs/project/build-log.md) of what was built and found, and the
  prioritized [open items](docs/project/status.md#open-items).
- [Ingestion](docs/project/ingestion.md), the [trade-metrics reference](docs/project/trade-metrics-reference.md) it implements, and the [storage contract](lib/db-research/README.md).
- [Research UI](apps/research-web/README.md).

## Local services and private phone access

`~/git/local-dev` manages this project's services (web on 4400, API on 4401) and the private
Tailscale route to the web UI, https://pauls-macbook-pro.taila9173b.ts.net:4400/; start,
stop, and restart them there. Plain `pnpm dev` runs the web UI on 4400 and the API on 8001.
