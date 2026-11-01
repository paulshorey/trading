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
- Local PostgreSQL 18 database `trading` with numbered migrations, a Databento file
  registry, and database tests in CI.

## Next

1. **Data.** One year of TBBO for GC, NQ, and other products is downloading. Add a
   product spec for each new root, register the files, and review fill delays and
   per-session data quality. Add `definition` records for contract metadata.
2. **Ingestion.** Store one row per scheduled-open second per contract (OHLCV plus
   per-second metrics) computed by `strategy-core`, then contracts, rolls, runs,
   trades, and ML rows ([storage guidance](../../lib/db-research/README.md)).
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
