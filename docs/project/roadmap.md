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

1. **Data.** Done: one year of TBBO for GC, SI, PL, ES, NQ, YM, and RTY, verified and
   registered ([details](data.md#what-we-have)). TBBO is the only market data for every
   product. Next: download the free `definition` records.
2. **Ingestion.** Implemented: one row for every scheduled-open second per contract
   (exact per-second TBBO metrics) and its `1m@1s` candle with 85 features, contracts, and
   rolls, computed by `strategy-core` ([ingestion](ingestion.md)). Next: run it for GC and
   SI, add `1h@1m` rows, then runs, trades, and ML rows
   ([storage guidance](../../lib/db-research/README.md)).
3. **Research comparison.** Run the [validation experiments](../sliding-windows/design.md#11-validation):
   phases, bias on and off, and rolling against clock candles, after costs.
4. **Metrics.** Stored rows carry sweeps, spread, displayed size and order counts, CVD
   paths, and many indicators. Next: the remaining handoff entries (footprints, swing
   points, divergences), each passing the scale-invariance test.
5. **ML.** Train on the signal rows with purged walk-forward splits (gradient-boosted
   trees with a logistic baseline), then backtest the out-of-sample predictions on
   newer sessions. Keep a final holdout that is evaluated once.
6. **Paper trading.** A Databento live TBBO source feeding one-second chunks into the
   same engine with simulated fills; record each day and replay it as a backtest to
   confirm identical decisions.
7. **Live trading.** A broker execution adapter with order reconciliation, risk limits,
   pause and resume, manual overrides, and a log of automated and human decisions.
