# Backtest and live engine

Status: implemented for historical runs and second-by-second rehearsal of recorded
sessions. A live Databento feed and paper/broker adapters are next.

One engine serves backtests, rehearsals, and (next) live sessions. Strategy logic,
features, and simulated fills are the same code in every mode; only the data source
and the pace differ.

| Mode            | Source                                    | Chunk                | Pace                |
| --------------- | ----------------------------------------- | -------------------- | ------------------- |
| Backtest        | DBN files                                 | One session per call | As fast as possible |
| Rehearsal       | DBN files, cut by `split_by_second`       | One second per call  | Real time or faster |
| Paper (planned) | Databento live TBBO, same record format   | One second per call  | Real time           |
| Live (planned)  | Live feed plus a broker execution adapter | One second per call  | Real time           |

Paper trading is live data with the simulated execution used in backtests, so it can
run while strategies are still in development. A recorded paper day replayed as a
backtest must reproduce the same decisions; differences expose timing assumptions.

## Strategy shape

- **Bias, `1h@1m`:** the last 60 minutes, updated every minute. It only disqualifies a
  direction. `1d@1h` could add a slower bias later.
- **Entry timing, `1m@1s`:** the last 60 seconds, updated every second. It decides when
  to act in an allowed direction. This is the primary decision timeframe.
- **Exit:** a bracket fixed at entry, sized in 1-minute ATRs: target, stop, and a
  maximum hold of minutes.

Strategies return a signal per row from **normalized features only**. Raw prices are
used only to place orders and measure P&L. See the [feature rule](#normalized-features).

## Code map

| Module (`lib/strategy-core/src/strategy_core/`) | Responsibility                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `market.py`                                     | Products (GC, SI, PL, ES, NQ, YM, RTY), TBBO trade arrays, calendar |
| `bars.py`                                       | Trades to 1-second base bars, seconds to minutes                    |
| `windows.py`                                    | Rolling candles over the last 60 trading-time slots                 |
| `kernels.py`                                    | Per-phase RSI, ATR, change, and EMA (numba)                         |
| `features.py`                                   | Normalized feature pipeline and unit contract                       |
| `strategies.py`                                 | Strategy interface, bracket, `bias_pullback` baseline               |
| `execution.py`                                  | Simulated fills against TBBO trades                                 |
| `engine.py`                                     | Chunk processing, one portfolio, live-path splitter                 |
| `labels.py`                                     | One would-be trade per signal, for ML                               |

`apps/backtest-runner` adds the Databento file catalog, exchange calendars, the
historical source (contract selection and rolls), run storage, the CLI, and the API.

## Timing model

All times are UTC nanoseconds. Each configurable delay applies in every mode.

1. **Assignment.** A trade belongs to the second containing its event time. A second
   ending at `T` closes at `T + close_delay`; a trade received later joins the second
   open when it arrived. Receipt is Databento `ts_recv + feed_latency`.
2. **Release.** Trades reach the engine one second at a time, in receive order within
   the second. A trade received early for a later second waits for that second.
3. **Decision.** Features of the second ending at `T` are computed at
   `T + close_delay`. The bias uses the latest completed minute, with its age.
4. **Entry.** The order reaches the exchange `order_latency` later. It fills at the
   first trade at or after arrival, at that trade's pre-trade ask (buy) or bid (sell).
   Size beyond the displayed top-of-book size pays `depth_penalty_ticks`.
5. **Exit.** The target is a resting limit that fills only when a trade prints beyond
   it (`limit_fill: through`, the default). The stop is a resting stop-market: a trade
   at or beyond it triggers it, and it fills at the book of the next trade that
   happened after the trigger, never better than the trigger price. Only trades that
   happened after the entry fill can trigger an exit, even if receive order delivers an
   earlier one later. Time and pre-close exits are market orders.
6. **Reaction.** The engine learns of a fill when that fill's second closes. Cooldown
   and the hold timer start then.

One position at a time; no entries and a forced exit `flat_before_close_s` before each
scheduled close. Contracts roll at a session open (previous-session volume) after the
new contract's warmup sessions. Every run records these settings as assumptions.

## Normalized features

Features, signals, and model inputs never use raw price units. Use basis points of
price, multiples of the same window's ATR, bounded ratios (close location, delta
ratio), oscillators such as RSI, logs of a quantity relative to its own trailing
average, or elapsed time. `Unit` has no price, tick, dollar, or raw-volume member, and a
test requires every feature to be unchanged when all prices, or all sizes, are
multiplied by a constant. `FeatureFrame.context` holds the price-unit values that
execution needs and must not feed signals or models.

## Speed

Within a chunk, base bars and rolling candles are vectorized with numpy, and
per-phase indicators are compiled loops whose state carries between calls. On the
sample day, a 23-hour session of one-second steps took 0.18 s including DBN decoding
(about 450,000 market seconds per second), or roughly 5 minutes per contract-year of
one-second data. The one-second path costs about 0.5 ms per second: ample for live,
too slow for research, which is why backtests pass whole sessions.

## Verification

```sh
uv run research verify apps/backtest-runner/examples/mgc-sample.json
uv run research rehearse apps/backtest-runner/examples/mgc-sample.json --speed 60
```

`verify` runs the same sessions whole and second by second and requires identical
features and trades. A vectorized step that reads a later row inside its chunk fails
this check, so it also guards against look-ahead. On the sample day all 17 features
and 13 trades matched. Tests also cover hand-checked fills, brute-force rolling
candles, phase parity with standard hourly candles, scale invariance, and prefix
invariance.

## ML rows

`labels.candidate_outcomes` simulates every signal row independently with the
engine's fills and bracket. Each row has the exact normalized features at the
decision and the outcome (P&L in ticks and dollars, R multiple, exit reason, best and
worst excursion, hold time). Rows overlap in time; keep `decision_ns` and `exit_ns`
for purged, chronological splits. Runs report a summary now; rows go to PostgreSQL
with the ingestion milestone.

## Stored one-second rows

The planned ingestion job writes one row per scheduled-open second, computed by this
engine's code (`bars.aggregate` and its extensions). A backtest may read stored rows
instead of rebuilding them only when their builder version and assignment settings
match the run's configuration; fills always come from the DBN trades.

## Data limits: TBBO only

Decision (November 1, 2026): every product uses Databento TBBO and nothing more
detailed, under identical rules. TBBO records each trade with the best bid and ask
just before it, and nothing between trades.

**Exact:** every trade's price, size, aggressor side, and time. OHLCV, VWAP, buy and
sell volume, CVD, trade counts and sizes, and sweeps through the book are exact at
any resolution and in both rolling windows.

**Limited:**

- **Fill prices.** A real market order fills instantly against the book it meets; the
  simulator sees the book only at the next trade. At random moments in September 2026:

  | Product | Next trade (median, 90th pct) | Book older than 1 s | Ask moved across the gap: 0 / 1 / 2+ ticks | Spread / 1-minute range |
  | ------- | ----------------------------- | ------------------- | ------------------------------------------ | ----------------------- |
  | GC      | 1.7 s, 9.5 s                  | 64%                 | 19 / 31 / 50%                              | 2 / 16 ticks            |
  | SI      | 5.9 s, 36 s                   | 85%                 | 17 / 29 / 54%                              | 2 / 7 ticks             |
  | ES      | 0.9 s, 5.9 s                  | 48%                 | 58 / 42 / 1%                               | 1 / 5 ticks             |

  Simulated fills are therefore uncertain by about 1–2 ticks in GC and SI and up to a
  tick in ES. Edges smaller than that cannot be tested; target moves several times
  larger, such as minute-scale holds with ATR-sized brackets. Runs report
  `entry_delay_ms`, the time from the signal to the trade whose book priced the fill.
  A real order would not wait; read it as how old the simulated price is.

- **Limit orders.** There is no queue position or quote history. Targets fill only when
  a trade prints beyond them, and passive or market-making strategies cannot be tested.
- **Book features.** Spread, displayed size, order count, and imbalance exist only at
  trades and only at the best price. In quiet seconds (80% of SI's seconds) they are as
  old as the last trade, so store them with their age. There is no depth beyond the
  best level and no record of cancellations.
- **Uneven precision.** The rules are the same for every product, but busy contracts
  are measured more precisely than thin ones; compare products with that in mind.
- **Paper trading** on the live TBBO feed has the same blind spot. Only broker fills
  show true execution.

Recommended next, using the same rules for every product: fill each order at the worse
of the last known and the next observed book; allow entries only shortly after a trade
(one parameter, in seconds); report each entry's book movement in ticks; and rerun any
promising result with fills one tick worse before trusting it.

## Known limits

- **Live adapters.** Databento live ingestion, paper sessions, and broker execution
  are not implemented. They plug into the same chunk interface.
