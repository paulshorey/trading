# Project goals

Build a backtesting and trading bot development platform for futures and crypto.
Developers configure, troubleshoot, and test custom metrics, strategies, and ML
models trained on those metrics. Historical research comes first; paper and live
trading will reuse strategy logic with a UI for monitoring and human overrides.

The next priority is downloading and validating historical price, volume, and time
data from QuantConnect LEAN, then developing metrics, models, apps, algorithms, and
services around that data.

## Code boundaries

- `apps/backtest-runner`: Python data workflow, experiment runner, API, and saved results.
- `lib/strategy-core`: shared Python metrics, strategies, and replay calculations.
- `apps/research-web`: developer configuration, troubleshooting, and visualization UI.
- `lib/research-charts`: reusable frontend charts.
- `archive/`: reference-only; do not deploy it or import it into active code.

Keep calculations in Python and separate strategy decisions from data access,
execution adapters, and UI code. Use `@/` for same-app frontend imports and relative
imports inside libraries. Add apps and libraries when a concrete need arises.

## Research principles

- Preserve dataset provenance, timestamps, instrument/contract metadata, and execution assumptions.
- Report data gaps and unavailable inputs; do not invent observations or order flow.
- Compute features and decisions using only information available at that time.
- Train and evaluate ML chronologically, with preprocessing fitted on training data only.
- Save enough configuration, data/model versions, costs, and outputs to reproduce and debug experiments.
- Keep credentials, downloaded market data, generated runs, and model artifacts out of git.

## Working conventions

Use pnpm for JavaScript tooling and install dependencies at the workspace root.
Python requires 3.11+. Use `python3 scripts/research.py` for the current runner.
Do not install dependencies inside build, test, dev, or start scripts.

For code changes, run relevant tests and `pnpm build`. For documentation changes,
check accuracy and links. Keep documentation short, avoid duplicated instructions,
and distinguish implemented behavior from planned capabilities.
