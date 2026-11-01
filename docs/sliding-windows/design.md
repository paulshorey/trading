# Sliding-window engineering design

Status: sections 1–8 are implemented in `lib/strategy-core` (`bars.py`, `windows.py`,
`kernels.py`, `features.py`, `engine.py`); see the [engine](../project/engine.md).
Stored `1m@1s` candles (section 10) are implemented ([ingestion](../project/ingestion.md));
stored `1h@1m` candles and the research comparison (section 11.7) are next.
Window specifications, metrics, and parameters are defined in Python code; the UI
only displays results.

`1m@1s` is the primary decision timeframe: it times entries every second. `1h@1m`
supplies the direction bias, read as of the latest completed minute.

## Terms

| Term           | Meaning                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Window `W`     | 60 rows: 60 scheduled-open minutes for `1h@1m`, 60 seconds for `1m@1s`.                         |
| Step `S`       | One row: 1 minute or 1 second of scheduled-open time.                                           |
| Base bar       | A disjoint `S`-long bar built directly from trades; one row and one window slot.                |
| Trading time   | Steps when the market is scheduled open. Closed steps add no slot.                              |
| Rolling candle | The last 60 rows (index `o − 59 … o`). Equals clock `[T−W, T)` only when no closure intervenes. |
| Ordinal        | The row's index counter (`slot_ordinal`): scheduled-open slots counted from a fixed origin.     |
| Phase          | `ordinal mod 60`; equals the clock minute or second until a closure that is not a whole period. |
| Phase series   | Candles of one phase, 60 rows apart. The input to standard indicators.                          |
| Rolling stream | One output per step, cycling through phases. Read by charts and strategy.                       |

## 1. Base bars

Build 1-second base bars from Databento TBBO trades and roll them up into 1-minute
base bars (an exact aggregation).

- Use integer UTC nanoseconds. A bar covers `[start, end)`; a trade exactly at a
  boundary belongs to the later bar. Assign trades by `ts_event` and keep `ts_recv`
  to model when data became available.
- Store open, high, low, and close (first, maximum, minimum, and last trade price),
  the times of the high and low, volume, trade count, the price × size sum for VWAP,
  and buy, sell, and unknown-side volume from the TBBO `side` field.
- Give every step when the market is scheduled open a slot, with one status:
  `observed` (at least one trade), `no_trades` (feed healthy, no trades), or
  `missing` (feed gap or unknown). Scheduled closures get no slot; see
  [section 7](#7-closures-and-data-gaps).

Build hourly candles from 1-minute base bars. Adding up overlapping `1m@1s` volumes
would count each trade up to 60 times.

## 2. Window engine

Each spec and instrument keeps a ring buffer of 60 slots. Steps during a scheduled
closure do nothing. When an open-market step ending at `T` closes:

1. Append the base bar for `[T−S, T)` and drop the oldest slot.
2. Compute the candle: open from the earliest slot with trades, close from the
   latest, high and low (with their times) over all slots, and sums of volume, trade
   count, price × size, and side volumes. Recalculate VWAP from the sums; never
   average ratios.
3. Assign a status, attach the phase index, and pass the candle to the indicator
   runner.

Recomputing a maximum and sums over 60 slots is cheap and avoids floating-point
drift. Running sums or a monotonic deque ([Lemire](https://arxiv.org/abs/cs/0610046))
are optimizations to add only if profiling shows a need.

| Candle status | Condition                                                         |
| ------------- | ----------------------------------------------------------------- |
| `complete`    | Every slot is `observed` or `no_trades`, with at least one trade. |
| `empty`       | Every slot is `no_trades`. No price; volume is zero.              |
| `gap`         | Any slot is `missing`.                                            |
| `warmup`      | Fewer than 60 open-market slots exist since data began.           |

A candle whose slots straddle a scheduled closure also carries a `spans_closure`
flag. By default only `complete` candles feed indicators and model features. A
chart may carry the last price forward with a visible marker; training never treats
it as a trade.

## 3. Phases

Phases count trading time, never the clock. Every scheduled-open slot has an
**ordinal**: the number of scheduled-open slots of its step that end at or before it,
counted from a fixed origin (the first session on or after 2010-01-01). Closures add
no ordinals, and every scheduled slot is a row, including slots without trades or data.

```text
ordinal(T)     = scheduled-open slots ending in (origin, T]   (SessionCalendar.slot_ordinals)
phase          = ordinal mod 60
window(T)      = the 60 slots with ordinals ordinal(T) − 59 … ordinal(T)
previous period = the candle at ordinal(T) − 60
```

Same-phase candles are therefore always exactly 60 slots apart: adjacent,
non-overlapping periods of open market, across any closure. In a stretch without an
irregular closure since the origin, the phase equals the clock minute (`1h@1m`) or
second (`1m@1s`):

| Spec    | Candle completed | Phase | Previous same-phase candle |
| ------- | ---------------- | ----- | -------------------------- |
| `1h@1m` | 10:23:00         | 23    | 09:23:00                   |
| `1m@1s` | 10:15:23         | 23    | 10:14:23                   |

After the daily halt (a whole hour) the clock alignment holds: the 17:30 candle's
previous same-phase candle ends at 15:30. After an early close that is not a whole
hour, such as 18:15 UTC with a 23:00 reopen, the window ending 23:01 covers 17:16 to
18:15 plus 23:00 to 23:01, and its previous same-phase candle ends at 17:16, 60 rows
earlier. Phase labels shift relative to the clock from then on; values never depend on
the labels or the origin.

## 4. Indicators per phase

Each indicator instance, such as RSI(14) on `1h@1m` closes, has 60 independent
states. At `T` only the state for `phase(T)` advances, and it receives the candle
ending at `T`.

- **Reference parity.** Pin a reference implementation for each indicator,
  including its smoothing and seed. Phase `k`'s output must equal that reference run
  on phase `k`'s series.
- **Warmup per phase.** Wilder RSI(14) needs 15 closes: 15 hours for `1h@1m`, 15
  minutes for `1m@1s`. Phases become usable one step apart. Recursive indicators
  also depend on how far back they started (TA-Lib's
  [unstable period](https://ta-lib.org/api/unstable-period)). Run them from a fixed
  origin or a saved checkpoint rather than refetching the last N candles.
- **Composites stay in phase.** MACD, RSI of an EMA, and divergences use the same
  phase at every level.
- **Missing candles stay missing.** A missing candle leaves an empty slot in the
  phase series; never pull an older candle forward to fill it. Implemented
  indicators hold their averages over the gap and restart the previous close, so no
  change is measured across it. Closed periods are not missing: they do not exist in
  trading time, so state simply continues.
- **Cost.** Memory is `60 × indicator instances × instruments` small states.

A history lookup reads rows by index, never by clock time. For the candle at index
`o`, its phase series is the rows `o, o − 60, o − 120, …`, oldest first. Every
scheduled slot has a row, so the list has no holes; a row's status says whether its
candle is usable:

```sql
-- Inputs of RSI(14) for the 1h@1m candle at minute index :o, from rolling candles stored
-- one per minute row (or each rebuilt from base rows i − 59 … i). A base row's own close
-- is not the rolling candle's close when that minute had no trades.
SELECT slot_ordinal, end_ns, status, close FROM research.candles_1h_1m
WHERE contract_id = :contract AND slot_ordinal <= :o AND slot_ordinal % 60 = :o % 60
ORDER BY slot_ordinal DESC LIMIT 15;
```

Lag is typed. `previous_period()` moves back 60 rows within a phase; `previous_step()`
moves back one row in the rolling stream. A plain `.shift(1)` on an interleaved table
is a step lag, so it must not feed standard indicators.

## 5. Highs, lows, and pivots

- A rolling candle's high is the highest trade in its 60 slots. It changes when a
  new extreme enters or when the old one drops out 60 slots later, so a falling
  rolling high can mean the old high expired, not that price fell.
- A standard pivot, such as a high above the N candles on each side, runs on the
  phase series and is confirmed N periods later. With 60 phases, confirmation can
  happen at any minute instead of only at the top of the hour.
- A minute-precise swing high is a base-bar high with no higher high in the 60
  slots before or after it, confirmed 60 slots later. The window's high and its
  time are enough to detect it. Ties resolve to the earliest occurrence.
- Every pivot keeps its origin time and its confirmation time. Features use it only
  after confirmation.
- Indicator extremes, such as RSI highs, come from the computed indicator series,
  not from RSI calculated on candle highs.

## 6. Combining timeframes

At 10:23:23 the latest `1m@1s` candle ends at 10:23:23, but the latest `1h@1m`
candle ends at 10:23:00. Record each feature's age, and never use a candle that ends
after the decision time. An hourly candle every second would be a separate
`1h@1s` spec with 3,600 phases and is out of scope.

## 7. Closures and data gaps

**Decision: trading time.** A window holds the last 60 steps when the market was
scheduled open. Steps during a scheduled closure add no slot and produce no candle.
After CME Globex's 16:00–17:00 CT daily halt, the 17:30 candle covers
`[15:30, 16:00)` plus `[17:00, 17:30)`. Spot crypto trades continuously; CME crypto
futures follow the Globex schedule.

Every candle is built the same way from 60 open-market slots. Indicators, features,
and models never handle partial candles, and indicator state continues across
closures without special cases. The archived writer used the same rule. The
alternative, elapsed time, builds windows without a calendar, but a candle that
overlaps a closure is incomplete. Every consumer would then have to handle an hour
of unusable candles after each reopen.

### Session calendar

Trading time concentrates the complexity in one component: a calendar that says
whether each step was scheduled open. It is defined in exchange time, including
daylight saving, holidays, and early closes. Errors in it change candle contents, so
it needs its own tests. [pandas_market_calendars](https://github.com/rsheftel/pandas_market_calendars)
provides CME Globex calendars for equity index (ES, MES) and metals (MGC) futures,
including the daily break, holidays, and early closes. Databento's `status` schema
could cross-check it, if the dataset provides it.

| Calendar | Trades seen        | Result                                           |
| -------- | ------------------ | ------------------------------------------------ |
| Closed   | none               | No slot; the window does not move.               |
| Open     | yes                | `observed` slot.                                 |
| Open     | none, feed healthy | `no_trades` slot.                                |
| Open     | none, feed missing | `missing` slot; the candle is `gap`.             |
| Closed   | yes                | Report a data-quality error; check the calendar. |

Never infer a closure from absent data. Treating a feed outage as a closure would
silently join candles across missing data. Evidence of missing data comes from
Databento's per-date dataset condition, file coverage, or a validation report of
unusual silence during open hours.

### Candles that span a closure

These candles carry `spans_closure`. Their range includes any price gap across the
closure, such as a weekend gap. Standard ATR includes the same gap through the
previous close, but features and the inspector should still be able to see it.

Because phases come from trading-time ordinals (section 3), same-phase candles stay
exactly 60 slots apart across every closure, including early closes that are not whole
hours. No candle needs special handling; only the phase labels shift relative to the
clock after such a closure. `1m@1s` labels never shift, because closures are whole
minutes.

### Other rules

- A `missing` slot makes the candle `gap`. Unscheduled gaps are never skipped.
- Resetting indicators at each daily halt would make hourly RSI(14) unavailable for
  the first 15 hours of every session; trading time avoids this.
- Futures keep actual contract identities. Warm up a new contract's states before
  trading it, or reset them explicitly at the roll.

## 8. Backtesting

- Use one chronological replay with one portfolio, one set of orders, and one set of
  risk limits for all phases.
- Neighboring phases usually report the same event; a crossover at phase 7 is likely
  at phases 8 and 9 too. Strategies set a target position, so repeated signals do
  not add positions. Use hysteresis or a cooldown where phases disagree.
- A decision at `T` uses only candles completed and available by `T`. Fill at the
  next observed trade after the decision plus modeled latency, never at a price from
  the window that produced the decision.

## 9. Machine learning

- Train one model, not 60. Each decision row holds the current phase's features,
  their statuses, and their ages. Store the phase as provenance; using it as an
  input is a separate experiment.
- Rows one minute apart share 59 of 60 minutes of hourly input, and their labels
  overlap. Split chronologically, keep each time block in one fold, purge training
  rows whose labels reach into validation, and add an embargo.
- The effective sample size of hourly features is much closer to the number of hours
  than minutes. Compare training on every step, every 60th step, and rotating phases.
- Define targets by time, such as five minutes after entry, not by row count. Flag
  targets that cross a closure. Fit scaling and encoding on training data only.

## 10. Storage

Store one row per scheduled-open second (base bars and their per-second metrics) in
PostgreSQL, computed by the same code live sessions run, with the rolling `1m@1s` candle
and its per-phase indicators beside it (`market.candle_1m_1s`; `1h@1m` next). Persist the
exact inputs of every decision and trade, and the ML rows. See
[ingestion](../project/ingestion.md) and the [storage contract](../../lib/db-research/README.md).

## 11. Validation

Build in this order. Each step's tests must pass before the next step starts.

1. **Base bars.** Hand-checked fixtures cover a trade exactly on a boundary, empty
   steps, missing data, and duplicate timestamps.
2. **Session calendar.** Fixtures cover the daily halt in summer and winter (its UTC
   time shifts with daylight saving), a weekend, a holiday, a 12:15 CT early close,
   a feed outage during open hours (flagged, not skipped), and trades during a
   scheduled closure (reported).
3. **Window engine.** Each rolling candle equals a brute-force aggregation of trades
   over its 60 open-market steps. Batch, incremental, and chunked replays produce
   identical output.
4. **Phases.** Same-phase candles are exactly 60 slots apart across every closure,
   including an early close that is not a whole hour. In a stretch without such a
   closure, phase 0 equals standard session-chart candles and phase `k` equals those
   candles offset by `k` steps.
5. **Indicators.** Each phase's SMA, RSI, EMA, ATR, and MACD equal the pinned
   reference on that phase's series. A restored checkpoint matches an uninterrupted
   run.
6. **Causality.** Appending later data never changes earlier outputs, and no feature
   uses a candle that ends after its decision time.
7. **Research comparison.** The question: does the rolling, per-phase representation
   produce better decisions _after costs_ than simpler uses of the same trades? Hold
   everything else fixed (data, costs, entry and exit rules, holdout) and change only
   how the bias and timing inputs are built:
   - standard clock candles, deciding only when a candle closes;
   - standard candles plus the forming candle, deciding every step;
   - each single phase alone (60 runs);
   - the full rolling system;
   - the same model on plain base bars without phases, which tests whether the
     representation adds anything beyond the raw data;
   - for the bias: no bias filter at all, which tests whether `1h@1m` adds value to
     `1m@1s` timing.

   **Timing luck.** A single-phase run is an ordinary hourly strategy whose candles
   end at minute `k` instead of `:00`. All 60 choices are equally valid, so the spread
   of their results is what the clock alone can do. If phase-0 returns +8% and the
   other phases range from −4% to +12%, a variant that beats phase 0 by 3% has not
   shown anything. A result counts only when it beats that spread, holds across time
   blocks, and survives costs. The rolling system should land near the middle of the
   phase distribution with less variation, and react sooner.

   Report after-cost returns, drawdown, turnover, and variation across phases and
   time blocks.

## Open decisions

1. Decision cadence for each strategy: every step or every Nth step.
2. Whether to add features that combine phases, such as the median RSI of the last
   60 phases. These reduce alignment noise but add lag.
