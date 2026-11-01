# Research UI and metric explorer

Status: `apps/research-web` implements run setup, results, and the trade inspector.
The metric explorer views below are planned extensions of the same app.

The UI exists to make backtesting logic easy to check. Metrics, parameters, feature
sets, and strategies are defined in Python; the UI sets run parameters, displays
results, and never computes indicators itself.

## Implemented

- **Run setup.** Product and contract (or the volume-based front month), sessions,
  warmup, bias and timing thresholds, the ATR bracket, execution latencies, costs,
  fill rules, and indicator periods.
- **Results.** Net P&L, win rate, average ticks and R, profit factor, drawdown,
  fill-delay percentiles, an equity curve by closed trade, and the outcome of every
  signal simulated as an independent would-be trade (the ML rows).
- **Trade inspector.** One-second candles around a trade, rebuilt from DBN on demand,
  with the signal second, entry and exit markers, target, stop, and entry levels, and
  the exact normalized features at the decision with their units.
- **Data quality** per session, and **provenance**: assumptions, calendar, data files
  with checksums, code hash, and package versions. Runs export as JSON.

API (loopback only): `GET /api/catalog`, `GET /api/runs`, `GET /api/runs/:id`,
`GET /api/runs/:id/trades/:n/bars`, and `POST /api/runs` with a run spec.
Nanosecond timestamps cross JSON as decimal strings.

## Next

1. **Session explorer.** Plot any feature over a session beside one-second or
   one-minute candles, with signal seconds and trades marked. The API computes the
   session on demand from DBN with the run's settings.
2. **Run comparison.** The research comparison in the
   [sliding-window design](../sliding-windows/design.md#11-validation): phase-by-phase
   results, bias on and off, and variation across time blocks.
3. **ML views.** Training rows, walk-forward folds, predictions beside outcomes, and
   calibration, once rows and models are stored in PostgreSQL.
4. **Live sessions.** Paper-trading status, decisions as they happen, pause, and
   manual overrides, reading the same engine outputs.

Chart rules: use Lightweight Charts with UTC time; render slots without trades as
gaps, never invented prices; treat display downsampling as presentation only; never
choose a later point because it is closest to the cursor.

## Lessons kept from the archived UI

The archived `view-next` app (reference only) contributed synchronized panes and
exact-point inspection. Do not port its live polling, database-specific routes,
duplicate indicator calculations in workers, or presentation transforms that leak
future data (normalizing to the last price, forward-filled projections).
