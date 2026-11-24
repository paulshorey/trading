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
| Paper (planned) | Databento live MBP-1, same record format  | One second per call  | Real time           |
| Live (planned)  | Live feed plus a broker execution adapter | One second per call  | Real time           |

Paper trading is live data with the simulated execution used in backtests, so it can
run while strategies are still in development. A recorded paper day replayed as a
backtest must reproduce the same decisions; differences expose timing assumptions.

## Strategy shape

- **Bias, `1h@1m`:** the last 60 one-minute rows, recomputed every minute. It only
  disqualifies a direction. `1d@1h` could add a slower bias later.
- **Entry timing, `1m@1s`:** the last 60 one-second rows, recomputed every second. It
  decides when to act in an allowed direction. This is the primary decision timeframe.

Windows and phases count rows (scheduled-open slots with an index counter), never
clock time; see [rows and index counters](../sliding-windows/README.md#rows-and-index-counters).

- **Exit:** a bracket fixed at entry, sized in 1-minute ATRs: target, stop, and a
  maximum hold of minutes.

Strategies return a signal per row from **normalized features only**. Raw prices are
used only to place orders and measure P&L. See the [feature rule](#normalized-features).

## Code map

| Module (`lib/strategy-core/src/strategy_core/`) | Responsibility                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `market.py`                                     | Products (GC, SI, PL, ES, NQ, YM, RTY), trade and book-event arrays, calendar and row index counters (`slot_ordinals`) |
| `bars.py`                                       | Trades to 1-second base bars, seconds to minutes                                                                       |
| `windows.py`                                    | Rolling candles over the last 60 rows; phase = row index mod 60                                                        |
| `kernels.py`                                    | Per-phase RSI, ATR, change, and EMA (numba)                                                                            |
| `features.py`                                   | Unit contract and the window features the stages compute (`StageFeatures` in `pipeline.py` assembles them)             |
| `strategies.py`                                 | Strategy interface (decisions while flat and while in a position), bracket, entry order, trend gate, `bias_pullback`   |
| `execution.py`                                  | Simulated fills against the MBP-1 book and trades                                                                      |
| `engine.py`                                     | Chunk processing, one portfolio, live-path splitter                                                                    |
| `labels.py`                                     | One would-be trade per signal, for ML                                                                                  |
| `metrics.py`, `window_metrics.py`               | Per-second trade metrics and their rolling windows, for stored rows                                                    |
| `indicators.py`, `state.py`, `warmup.py`        | Stored-row features, exact checkpoints, and warm-ups derived from indicator parameters                                 |
| `stages.py`, `stage_*.py`, `pipeline.py`        | Stages (one stored table each, versioned on its own), the pipeline that runs them, and the engine's features           |

`apps/backtest-runner` adds the Databento file catalog, exchange calendars, the
historical source (contract selection and rolls), run storage, the CLI, and the API.

## Timing model

All times are UTC nanoseconds. Each configurable delay applies in every mode.

1. **Assignment.** A trade or book event belongs to the second containing its event
   time. A second ending at `T` closes at `T + close_delay`; a record received later joins
   the second open when it arrived. Receipt is Databento `ts_recv + feed_latency`.
2. **Release.** Records reach the engine one second at a time, in receive order within
   the second. A record received early for a later second waits for that second.
3. **Decision.** Features of the second ending at `T` are computed at
   `T + close_delay`, and the strategy decides then. Slower timeframes are read as of their
   latest completed row, with its age. The position is long, flat, or short and moves one
   step per decision: while flat, the strategy's signal opens a position; while one is open,
   its closing decision closes it ([decision 35](roadmap.md#decisions)). A strategy that
   makes no closing decisions leaves every position to its bracket.
4. **Entry.** The order reaches the exchange `order_latency` later. A market entry fills
   then, at the best ask (buy) or bid (sell) the exchange showed at that moment: the book
   after the last event at or before the arrival. Size beyond the displayed size at that
   price pays `depth_penalty_ticks`. An order that meets no two-sided book is cancelled.
   `adverse_ticks` (default 0) charges every marketable order further ticks, as a stress
   test. A passive entry (`Entry("passive")`) is a limit order at the best bid (buy) or ask
   (sell) of the book it meets, cancelled after `wait_s`. It fills at its price when a trade
   prints through it, or, with `passive_fill: queue` (the default), when the size displayed
   ahead of it on arrival and its own have traded at its price. MBP-1 shows no queue: the
   first rule is the strict bound, the second assumes every order ahead stays until it
   trades. Only volume from the aggressor that would hit the order counts toward the queue
   (sells for a resting buy, buys for a resting sell): a trade with no stated side does not.
   A limit whose price the book is already at or through when it arrives fills then, at
   the book, when the whole order fills within its price; an order larger than the size
   displayed there, or one the book has not reached, rests. If data coverage breaks while an order rests and before it fills, its outcome is
   unknown: a fill in the gap would be invisible, so it is counted
   (`orders_with_unknown_outcome`) and never treated as an expiry, and since the portfolio
   is then not known to be flat, nothing more is opened until that session's close. While an order rests, no
   other is sent; when it expires, the next decision decides again.
5. **Exit.** The target is a resting limit that fills only when a trade prints beyond
   it (`limit_fill: through`, the default). The stop is a resting stop-market: a trade
   at or beyond it triggers it, and it fills at the book that trade left (the book events
   of the same match), never better than the trigger price. Each trade counts by its own
   event time: only trades that happened after the entry fill and before a timed exit
   arrives can trigger an exit, in whatever order they were received. Time and pre-close
   exits are market orders that fill at the book when they arrive. A closing decision is
   the same market order sent at its decision time: it fills `order_latency` later whatever
   the bracket says, unless the stop or the target fills first. A bracket may have no time
   limit (`max_hold_s: None`), may be sized by any timeframe's ATR (`atr`), and may move its
   stop to the entry price once a trade has printed `breakeven_atr` ATRs in favour: the
   engine learns of that trade when its second closes, and the amended stop is in force
   `order_latency` after that.
6. **Size and the daily limit.** With `account_usd`, each position is as many whole
   contracts as keep its stop's risk within `risk_pct` of the account; a signal whose one
   contract risks more is not traded and is counted. Once a session's closed trades have
   lost `daily_loss_pct` of the account, no position is opened until the next session
   ([decision 36](roadmap.md#decisions)). Without an account size every trade is `contracts`,
   and `daily_loss_r` sets the same limit in R.
7. **Costs for the decision.** Beside the features, a strategy sees `exec.spread_r` and
   `exec.commission_r`: the spread of the book the engine holds at the row and both
   commissions, over the stop distance. They let a rule compare a forecast with what the
   trade costs; they are not features and never reach a model.
8. **Reaction.** The engine learns of a fill when that fill's second closes. Cooldown
   and the hold timer start then, and a closing decision can act from then on.

Every book lookup is bounded by the second of its own time: it uses the events released by
the close of that second and nothing released later. A late record therefore never rewrites
an earlier fill, and whole-session and second-by-second runs price every order the same.

Six rules cover records that are unusual or out of order (`execution.BookView`):

- **A trade record carries the book before the trade.** The book changes only when a later
  record says so. On GCZ6 on 2026-09-15, 91,227 of 93,025 trades were followed by a book
  record at the same event time, which a lookup at the trade's time already reads. Of the
  other 1,798, the next book record left the traded price in place for 1,544: the trade
  met hidden or spread-implied liquidity and the book did not change. For 254 (0.3%) the
  price moved in a record stamped later, usually within a millisecond; a stop triggered by
  one of those fills at the trigger price, up to one tick better than it should.
- **Each record is the whole top of book after its event**, so it includes every record
  received before it. The book is therefore the record received last, and a record never
  takes effect before the records received ahead of it: with event times 107.8 s then
  107.7 s, a lookup at 107.75 s reads the book before both. Out-of-order event times are
  rare (none or one per session in four checked sessions).
- **A record Databento flags as possibly wrong** (after an unrecoverable gap in its feed)
  prices nothing: an entry that meets it is cancelled and an exit falls back to the last
  trade price (flag `no_book`), until a record without the flag arrives. In this year's
  files the flag appears only on 2025-11-28, in RTY and YM.
- **A book is not carried across missing data.** Where the files have a gap, a lookup inside
  it returns no book, and after it none until an event that happened after the gap: the
  entry is cancelled, or the exit falls back with `no_book`.
- **The book restated at the start of each file** carries a receive time Databento flags as
  inaccurate (exactly midnight UTC). Those records are ordered by their position in the
  file, and their receive time is never compared with another record's. In the GC and SI
  files they are the only records with that flag.
- **A stop triggered by a trade released late** (after its own second had closed) fills at
  the book of the last record released with it that happened at or before the trigger, and
  at the trigger price (flag `no_book`) when there is none. Earlier seconds are not read:
  a live session no longer holds them.

Each trade records what its entry cost: `decision_spread_ticks`, the spread the engine held
when it decided, and `entry_slip_ticks`, the fill price against that book's mid-price (half
the spread, the market's move during `close_delay + order_latency`, and any depth penalty).
The run summary reports the average and the 90th percentile.

One position at a time; no entries and a forced exit `flat_before_close_s` before each
scheduled close. Contracts roll at a session open (previous-session volume, only to a later
delivery month). Each contract first replays its warm-up sessions, by default the stored rows'
lead (40), so its features equal the stored rows from every roll on. Every run records these
settings as assumptions.

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
MGC sample day used until November 2026, a 23-hour session of one-second steps took 0.18 s
including DBN decoding (about 450,000 market seconds per second), or roughly 5 minutes per
contract-year of one-second data. The one-second path costs about 4 ms per second with every stored feature
(November 5, 2026): ample for live, too slow for research, which is why backtests pass whole
sessions. Ten months of GC (2026) run whole in about 4 minutes, warm-up included.

## Verification

```sh
uv run research verify apps/backtest-runner/examples/gc-day.json
uv run research rehearse apps/backtest-runner/examples/gc-day.json --speed 60
```

`verify` runs the same trading sessions whole and second by second and requires identical
features and trades; both engines first replay the warm-up sessions whole, as a live session
prepares before it trades, and frames are compared an hour at a time, so memory holds one
session. A vectorized step that reads a later row inside its chunk fails this check, so it
also guards against look-ahead. On a GC day with MBP-1 (GCZ6 2026-09-15, 2.3 million book
events; November 15, 2026) all 235 features and 15 trades matched: whole 3.7 s, second by
second 403 s (4.9 ms per second, far inside the 100 ms close delay), 2.3 GB. Before the move
to MBP-1, a GC and an SI week matched in every feature and trade (92 and 110 trades,
November 5). Tests also cover hand-checked
fills, brute-force rolling candles, phase parity with standard hourly candles, scale
invariance, and prefix invariance.

## ML rows

`labels.candidate_outcomes` simulates every signal row independently with the
engine's fills and bracket. Each row has the exact normalized features at the
decision and the outcome (P&L in ticks and dollars, R multiple, exit reason, best and
worst excursion, hold time). Signals that never fill or are still open when the
session's data ends yield marker rows (`unfilled`, `censored`) instead of vanishing.
Rows overlap in time; keep `decision_ns` and `exit_ns`
for purged, chronological splits. Runs report a summary now; rows go to PostgreSQL
with the ingestion milestone.

## Stored rows

`research ingest` writes one row per scheduled-open second and minute and their rolling
`1m@1s` and `1h@1m` candles with features, computed by the stages that the engine itself
runs (`pipeline.Pipeline`) with the backtest's default assignment timing; see
[ingestion](ingestion.md). The engine reads its features from the same stages
(`pipeline.StageFeatures`): every `candle_1m_1s` and `vol_1s` feature of the window ending at
each second as `1m@1s.<name>` (joined row by row), and every
`candle_1h_1m`, `stats_1h_1m`, and `vol_1m` feature of the latest completed minute as
`1h@1m.<name>` with its age `1h@1m.age_s` (their names never collide; a test checks it). A backtest may read stored rows instead of
rebuilding them only when their builder version and assignment settings match the run's
configuration (not implemented yet); fills always come from the DBN trades and book events.

## Data limits: MBP-1

Decision (November 15, 2026, replacing TBBO): every product uses Databento MBP-1 under
identical rules. MBP-1 records every trade and every change to the best bid and ask: price,
displayed size, and order count on each side, one price level deep. A trade record carries
the book just before the trade; these records alone are exactly the TBBO schema, and they
reproduce the second rows stored from TBBO field for field
([check](data.md#what-we-have)).

**Exact:** every trade's price, size, aggressor side, and time, so OHLCV, VWAP, buy and
sell volume, CVD, trade counts and sizes, and sweeps are exact at any resolution and in
both rolling windows. The best bid and ask are exact at every moment, so a market order is
priced at the book it would have met and the spread it paid is measured, not assumed.

**Limited:**

- **Depth.** Only the best price on each side is visible. An order larger than the
  displayed size pays `depth_penalty_ticks` for the remainder: a setting, not a
  measurement. One contract in GC, SI, or ES almost never exceeds the displayed size.
- **Limit orders.** There is no queue position (that needs MBO). Targets fill only when a
  trade prints beyond them, which is conservative, and passive or market-making strategies
  cannot be tested.
- **Latency.** `feed_latency_ms`, `close_delay_ms`, and `order_latency_ms` are assumptions
  about this machine and broker. Measure them in paper trading and rerun promising results
  with larger values.
- **Market impact.** A simulated order does not change the book that later orders meet.
  That is negligible for one contract and wrong for size.
- **Stored book features.** The stored rows still describe the book only as trades saw it
  (spread, displayed size, order count, and imbalance at trades, each with its age). A
  stage that reads every book event, `book_1s`, is planned
  ([second-scale metrics](../research/pivots/2026-11-06-second-scale-and-mbp1.md)).
- **Paper trading** on the live MBP-1 feed sees the same book. Only broker fills show true
  execution.

Rerun any promising result with one tick of extra slippage and a longer order latency
before trusting it.

## Known limits

- **Live adapters.** Databento live ingestion, paper sessions, and broker execution
  are not implemented. They plug into the same chunk interface.
