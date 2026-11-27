# Research web

React/Vite UI for setting up runs and checking backtesting logic. It exists to make the
logic easy to check: metrics, parameters, feature sets, and strategies are defined in
Python; the UI sets run parameters, displays results, and never computes indicators itself.

## Run it

`pnpm dev` from the repository root starts the UI on port 4400 and the API on port 8001
(loopback only); Vite proxies `/api` to the API. Times are UTC. The API serves
`GET /api/catalog`, `GET /api/runs`, `GET /api/runs/:id`,
`GET /api/runs/:id/trades/:n/bars`, and `POST /api/runs` with a run spec. Nanosecond
timestamps cross JSON as decimal strings.

## What it does

- **Run setup.** Product and contract (or the volume-based front month), sessions, warm-up,
  strategy thresholds, the ATR bracket, execution latencies, costs, fill rules, and
  indicator periods.
- **Results.** Net P&L, win rate, average ticks and R, profit factor, drawdown, fill-delay
  percentiles, an equity curve by closed trade, and the outcome of every signal simulated as
  an independent would-be trade (the ML rows).
- **Trade inspector.** One-second candles around a trade, rebuilt from DBN on demand, with
  the signal second, entry and exit markers, target, stop, and entry levels, and the exact
  normalized features at the decision with their units.
- **Data quality** per session, and **provenance**: assumptions, calendar, data files with
  checksums, code hash, and package versions. Runs export as JSON.

## Not built

A session explorer (any feature plotted over a session beside the candles), run comparison
(the research comparison in the [sliding-window design](../../docs/sliding-windows/design.md#11-validation)),
views of training rows, folds, and predictions, and live-session status.

## Chart rules

Use Lightweight Charts with UTC time; render slots without trades as gaps, never invented
prices; treat display downsampling as presentation only; never choose a later point because
it is closest to the cursor. From the archived `view-next` app keep synchronized panes and
exact-point inspection; do not port its live polling, duplicate indicator calculations, or
presentation transforms that leak future data (normalizing to the last price, forward-filled
projections).
