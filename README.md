# Backtesting and trading bot development platform

A developer platform for building, testing, and running short-horizon futures
strategies and the machine-learning models behind them. It starts with CME GC (gold)
and NQ (Nasdaq-100) and supports adding more products.

Strategies read Databento TBBO trades with their pre-trade bid and ask. A rolling
`1h@1m` candle (the last hour, every minute) sets the direction bias; a rolling
`1m@1s` candle (the last minute, every second) times entries; a bracket sized in ATRs
exits within minutes. Every feature is normalized: basis points, ATR multiples,
ratios, oscillators, or time; never raw prices. The same engine runs backtests (as fast
as possible) and second-by-second live-style sessions with identical results, so paper
trading can start before a strategy is final.

## Workspace

| Path                   | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `lib/strategy-core`    | Base bars, rolling windows, features, strategies, execution, engine, labels |
| `apps/backtest-runner` | Databento catalog and source, calendars, runs, CLI (`research`), local API  |
| `apps/research-web`    | Run setup, results, and the second-by-second trade inspector                |
| `lib/research-charts`  | Reusable chart components                                                   |
| `lib/db-research`      | PostgreSQL migrations and storage design (local database `trading`)         |
| `data/`                | Databento job folders, the one-day sample, and saved runs (all gitignored)  |

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
uv run research backtest apps/backtest-runner/examples/mgc-sample.json
uv run research verify apps/backtest-runner/examples/mgc-sample.json # live path = backtest
uv run research rehearse apps/backtest-runner/examples/mgc-sample.json --speed 60
pnpm lint && pnpm test && pnpm build
```

The bundled sample (`data/sample/`, not in git) is one day of Micro Gold. GC and NQ
history comes from Databento batch downloads; see the [data plan](docs/project/data.md).

## Documentation

- [Engine: backtests and live sessions](docs/project/engine.md): timing, fills, speed, verification.
- [Sliding-window candles](docs/sliding-windows/README.md) and their [design](docs/sliding-windows/design.md).
- [Historical data](docs/project/data.md), [roadmap](docs/project/roadmap.md), and the
  [handoff notes](docs/project/handoff.md) with decisions and next steps.
- [Research UI](docs/project/metric-explorer.md) and the [storage contract](lib/db-research/README.md).

## Private phone access through Tailscale

`~/git/local-dev` manages the local services and the private Tailscale route; see
[the local Tailscale guide](docs/local-development-tailscale.md).
