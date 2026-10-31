# Strategy core

Pure Python logic shared by backtests, rehearsals, and future live sessions: TBBO
trade arrays, base bars, rolling windows, per-phase indicators, normalized features,
strategies, simulated execution, the engine, and ML labels. No file, network, or
database access; adapters live in `apps/backtest-runner`.

Features and signals use only normalized units (`features.Unit`); raw prices appear
only in execution and P&L. Read the [engine design](../../docs/project/engine.md)
before changing timing or fills, and the [sliding-window design](../../docs/sliding-windows/design.md)
before changing candles or indicators.

To add a metric: compute it per phase in `features.py` (compiled loops in
`kernels.py` if it is recursive), declare its `Unit`, and extend the tests. The
scale-invariance and whole-session versus second-by-second tests must pass.

```sh
uv run pytest lib/strategy-core/tests
```
