# Platform roadmap

Goal: reproducible short-horizon futures strategies, from historical research through
live trading, on one engine. See the [engine](engine.md) for how the stages share code.

## Done

- uv-managed Python workspace with numpy, numba, Databento, and exchange calendars.
- DBN catalog with checksums, per-date contract resolution, volume-based front-month
  rolls, and per-session data-quality reports.
- One-second and one-minute base bars, `1m@1s` and `1h@1m` rolling candles, per-phase
  indicators, and normalized features with enforced scale invariance.
- One engine for whole-session backtests and second-by-second rehearsals, verified
  identical; TBBO-based fills, ATR brackets, one portfolio.
- Per-signal would-be-trade outcomes (ML rows) and a UI to inspect runs and trades.

## Next

1. **Data.** Buy GC and NQ TBBO plus `definition` records: a few months first, then
   the full history. Check fill delays and data quality per session.
2. **Storage.** Revise and apply the [PostgreSQL schema](../../lib/db-research/README.md):
   catalog, contracts, rolls, quality, runs, trades, ML rows, and models.
3. **Research comparison.** Run the [validation experiments](../sliding-windows/design.md#11-validation):
   phases, bias on and off, and rolling against clock candles, after costs.
4. **Metrics.** Add order-flow and structure metrics (CVD slope and divergence, sweeps,
   spread and displayed size, swing points) that pass the scale-invariance test.
5. **ML.** Train on the signal rows with purged walk-forward splits (gradient-boosted
   trees with a logistic baseline), then backtest the out-of-sample predictions on
   newer sessions. Keep a final holdout that is evaluated once.
6. **Paper trading.** A Databento live TBBO source feeding one-second chunks into the
   same engine with simulated fills; record each day and replay it as a backtest to
   confirm identical decisions.
7. **Live trading.** A broker execution adapter with order reconciliation, risk limits,
   pause and resume, manual overrides, and a log of automated and human decisions.
