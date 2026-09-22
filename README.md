# Backtesting and trading bot development platform

A developer platform for configuring, troubleshooting, and testing trading metrics,
strategies, and machine-learning models for futures and crypto markets.

The workflow starts with historical price, volume, and timestamp data from
QuantConnect LEAN. Developers will build custom metrics, train models on those
metrics, compare strategies through reproducible backtests, and inspect results in
a charting UI. The same strategy logic will later support continuous paper and live
trading, with controls to monitor, pause, and override bot decisions.

## Workspace

| Path                   | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `apps/backtest-runner` | Python CLI/API for historical data analysis and backtest experiments      |
| `apps/research-web`    | UI for strategy configuration, charts, execution details, and run history |
| `lib/strategy-core`    | Shared Python metrics, strategy logic, and replay calculations            |
| `lib/research-charts`  | Reusable charting components                                              |
| `data/manifests`       | Dataset sources, checksums, and instrument metadata                       |

Python owns research and trading calculations; the frontend configures experiments
and visualizes their results. `archive/` is reference-only, excluded from active
builds and deployments.

## Run locally

Requirements: Node 20+, pnpm 10.28.1, and Python 3.11+.

```sh
pnpm install --frozen-lockfile
pnpm data:download
pnpm dev
```

Open [the local UI](http://127.0.0.1:5173/). Its `/api` requests are proxied to the
Python API on port 8000. The current Python baseline uses the standard library.

```sh
pnpm data:analyze
pnpm backtest --dataset btc-usd-sample --config apps/backtest-runner/examples/btc.json
pnpm test
pnpm build
```

## Development focus

The current foundation provides public LEAN samples, SMA/RSI baseline strategies,
a local replay simulator, and a results UI. ML training and live execution are
planned capabilities. The runner reads LEAN data; it does not run the LEAN engine.

Next, acquire broader futures and crypto history from QuantConnect LEAN, validate
its coverage, and use it to develop custom metrics, models, algorithms, apps, and
services. See the [data workflow](docs/project/data.md) and
[roadmap](docs/project/roadmap.md).
