# Roadmap

Goal: one machine-learning model that makes the trading decisions, in backtests and then
live, on one engine. Its inputs are pre-processed signals on several timeframes: the state
of the market, and where price and its derivatives stand against their own confirmed swing
highs and lows ([goal and process](../../AGENTS.md#goal)).

This page is the plan: what is computed, in what order, the decisions in force, and how a
result is judged. Where the work stands today is in the [status](status.md); what each
experiment found is in the [results](results.md); the dated record is the
[build log](build-log.md).

## Two ideas everything rests on

1. **Sliding windows.** A candle covers a higher timeframe but is recomputed at every step
   of a lower one: `1m@1s` is the last 60 one-second rows, every second; `1h@1m` is the last
   60 one-minute rows, every minute. Windows count rows of scheduled trading time, never
   clock time ([sliding windows](../sliding-windows/README.md)).
2. **Passes.** History is processed in passes, like floors of a building: each pass reads
   only the passes below it, and a pass is finished for a moment in time before anything
   above reads it. A value never uses information from after its own row.

Indicators that advance by one candle period read the previous window of the same phase.
The swing detector reads the released trades in order, so it can tell which level was
reached first inside a row. A second-level decision can read the latest completed row of a
slower timeframe, with its age.


## How the analysis is structured

| Role | The question it answers | What it holds | Steps |
| --- | --- | --- | --- |
| **State** | What is the market doing now? | Base rows, windows, indicators, volatility, the book, net flow, time to scheduled news, on every timeframe | 1 to 3 |
| **Structure** | Where does it stand against its own recent highs and lows? | An ATR zigzag of price, then of RSI and of CVD, each with its own ATR: confirmed swings, the trend they make, the levels the current value has broken, how far the open move has come, and whether the derived series agree with price | 4 and 5 |
| **Decisions** | What position to hold? | One trained model and the rule that turns its forecast into buy, sell, or nothing. One portfolio, after costs | 6 |

Beside all three stands **evaluation**: labels, splits by time, the engine's fills, and the
record of every variant tried. It is built before the things it judges.

No model sits in the middle. Swings and structure are computed by rule
([decision 29](#decisions)); the only thing trained is the decision model.

### The trade the system looks for

**One decision, every second, reading every timeframe** ([decision 38](#decisions)). The
model runs at every `1m@1s` row and sees all three timeframes as of that second:

- **Fast (`1m@1s`)** is where the decision is made and the entry is timed: a limit order
  that lasts a few seconds.
- **Middle (`10m@10s`) and slow (`1h@1m`)** give the larger trend, and they can forbid a
  trade: a long is opened only when no timeframe's trend is down, a short only when none is
  up.
- **The slow ATR sizes the trade.** An ATR is the typical range of one window, so it differs
  by timeframe: for GC about $2.30 on `1m@1s`, $8 on `10m@10s`, and $20.60 on `1h@1m`
  (January to August 2026). The stop and the target are each 1.5 slow ATRs away
  ([decision 39](#decisions)): about $31 on GC, a move that takes hours, not seconds, and
  against which the spread is about 2%.

**A decision is a step, and the position follows the market** ([decision 35](#decisions)).
At each second the model's forecast becomes buy, sell, or nothing. The position is
long, flat, or short, and a decision moves it one step: a buy opens a long when flat and
closes a short when short; a sell is the mirror. A closing decision exits at the market and
cancels the position's orders, whatever the bracket says. The bracket is a stop, a target,
and the flat-before-close rule; there is no time limit inside the day. Whether a policy closes on decisions at all is a
setting: the default holds a position to its bracket, and two rules that close early run
beside it ([decision 37](#decisions)). Trades are intraday.

**Risk is a share of the account** ([decision 36](#decisions)): each trade risks a set
percentage between its entry and its stop, and a day stops after a set percentage is lost.
Both are variables. Results are read in R, the unit of risk of one trade, which does not
depend on them.


## The process and where it stands

The six steps are in [AGENTS.md](../../AGENTS.md#the-process-required-order). A **step** is
a part of the process; a **tier** is a dependency level in the code
([feature pipeline](feature-pipeline.md)); a **stage** is one stored table with its own
version.

| Step | Stages | Built | Missing |
| --- | --- | --- | --- |
| 1. Base rows | `bar_1s`, `bar_10s`, `bar_1m`, `clock_1s` | From trades, with a CVD that runs through each contract's life | The book between trades (`book_1s`) |
| 2. Sliding windows | `candle_1m_1s`, `candle_10m_10s`, `candle_1h_1m` | Three timeframes, rows counted by index, indicators per phase | A session-long window for a view of several days |
| 3. Indicators | `candle_*`, `stats_*`, `vol_*` | Indicators and volatility on price | Indicators of indicators, beyond the swings of RSI |
| 4. Swings and structure of price | `pivot_1s`, `pivot_10s`, `pivot_1m`, `pivot_event` | An ATR zigzag at 0.5, 1, 2, and 3 ATR on each timeframe, with the `structure` code | The current pullback over the threshold as its own feature |
| 5. Swings and structure of derived series | `pivot_rsi_*`, `pivot_cvd_*` | The same zigzag on RSI and on CVD, each in its own ATR ([definition](series-structure-spec.md)) | The codes that compare the three structures |
| 6. Decision model | `targets.py`, `dataset.py`, `yardstick.py`, `policy.py`; `research.run` | A first model, fitted walk-forward and replayed in the engine | Skill: it has none at the horizon traded ([results](results.md)) |

The engine holds 1,590 features. Base rows and indicator stages hold one row per scheduled
slot and contract. Swing rows of the fast timeframe and all events are sparse: stored where
something reads them.

**Pairs.** Steps 1 to 5 are computed for each product alone. Pair stages then read two
products that move together at the same row ([pair design](pair-design.md), not built).

## Costs choose the timeframe

Measured on the continuous minute rows, January 2 to August 31, 2026 (non-overlapping
blocks inside a session; the spread is the mean at trades):

| Block | GC median move | GC spread ÷ move | SI median move | SI spread ÷ move | Blocks per product | Return autocorrelation, GC / SI |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 minute | 2.2 bps | 36% | 5.1 bps | 50% | 234,000 | −0.01 / −0.02 |
| 5 minutes | 4.7 bps | 17% | 10.6 bps | 24% | 47,000 | −0.01 / −0.03 |
| 15 minutes | 8.1 bps | 9.5% | 18.0 bps | 14% | 15,700 | −0.01 / +0.01 |
| 60 minutes | 16.2 bps | 4.7% | 35.9 bps | 7.1% | 3,900 | −0.02 / −0.01 |
| 240 minutes | 32.3 bps | 2.3% | 69.1 bps | 3.6% | 980 | +0.03 / −0.01 |

A trade that wins or loses one typical move and pays one spread breaks even at a hit rate of
50% plus half the ratio: 68% on GC at one minute, 55% at fifteen, 52% at an hour, before
commission. One block's return says nothing about the next at these horizons (a one-lag
linear check only). So the fast timeframe times an entry and the slower ones carry the trade.

**One year of two products cannot judge an hourly policy.** Results are only as many as
their independent trade dates: the four test months hold 86, and a comparison of two
forecasts is known to about ±0.05 of rank correlation, larger than any difference seen so
far. More products on the same year are the lever chosen
([decision 42](#decisions)); how much they help is set out [below](#how-results-are-judged).

## Known limits

Found in the review of November 23, 2026
([archived](../archive/review-2026-11-23.md)) and still true:

- **GC and SI are closer to one market than to two.** They move together, so the second
  adds fewer independent days than its row count suggests. A product of another kind adds
  more.
- **Most of the storage is the fast timeframe.** The one-second tables are most of the
  database, and most seconds hold no trade. One-second values must be stored only where
  they are read before many products arrive ([decision 25](#decisions)).
- **Many features are the same price path seen again.** Inputs are judged by group, not
  column by column, and new work goes to different information.
- **A limit order's fill cannot be known from this data.** MBP-1 shows the best bid and ask,
  not the queue. Two fill rules are run, a strict one and a generous one; paper trading
  calibrates them.
- **The book will help time an entry, not choose a direction.** Order-flow signals from the
  book predict seconds ahead, so `book_1s` is judged at the one-minute horizon and by the
  quality of entries.
- **"Several days of trend" is not in the inputs.** The slow RSI spans 14 hours. A window of
  60 rows of 23 minutes is one session; it is not built.

## Decisions

The decisions in force, with the numbers they were given. Numbers missing from the list
were withdrawn or replaced: 2 to 5, 10, and 17 (models in the middle and their targets), 9
(more history; replaced by 13 and 42), 18 and 34 (replaced by 35), 19 (replaced by 36). 8,
24, and 26 were decisions about how to build what is now simply built (a timeframe is a
parameter, one set of stages, the machine's baseline).

1. **Keep the codebase.** Stages, tiers, row counting, per-contract computation, and one
   engine are the multi-pass design the process describes.
6. **Evaluation after costs is the yardstick.** A policy counts only against staying flat,
   paired on the same decisions with a 95% interval from resampled trade dates, on neither
   product alone a loss, and still positive under the latency and extra-tick stress.
7. **Sparse layers store events and decision rows, not every second.**
11. **The middle timeframe is `10m@10s`.** A step must divide a minute, or rows would mix
    the seconds before a close with those after the reopen.
12. **GC and SI are the proof of concept.** Everything is built for any number of products
    and pairs. Disk space is not a design constraint.
13. **No more years are bought; the free year is used for more products** (Paul, November
    27, replacing the plan to download five more years of GC and SI, which costs money). The
    most recent year of every product is free, so the model is trained on many products
    over that one year ([decision 42](#decisions)). September 1, 2026 onward stays the final
    holdout, and paper trading is the test after it.
14. **Intraday first.** Positions are flat before each close. Holding across days comes as a
    switch beside it ([decision 40](#decisions)).
15. **Scheduled news is an input:** a table of release times known in advance gives every
    row its time to the next release and since the last one. Results are also reported
    without the minutes around a release.
16. **The live contract is undecided** (full-size GC and SI, or the micros MGC and SIL).
    Results are reported at both costs. The micro books are not in the data, so the second
    is a stress, not a simulation.
20. **No trade count is aimed for.** A policy is never tuned toward a number of trades.
21. **It runs unattended, inside the session.** Every position is closed before the day's
    close, and no position is opened in the last hour before that forced exit.
22. **The purpose is to prove the method before any capital is committed.** Unusual ideas
    are welcome; each is still written down before it is run and recorded whatever it shows.
23. **No trade where the market cannot be trusted.** An entry is not eligible when the
    session's data is flagged, the book at the decision is missing, one-sided, or flagged,
    or the spread is too large a share of the stop distance. Such rows are left out of
    training, by eligibility at the decision row, and counted. The ATR that normalizes
    features is floored at the spread, as the swing threshold is.
25. **Storage.** With every second stored, the database holds 375 GB for one year of two
    products. Many products do not fit a 4 TB disk unless the one-second window, statistics,
    and volatility rows are stored only where something reads them (every ten-second row's
    end, every decision and event row). `bar_1s` stays complete, and the engine computes
    every second either way.
27. **Costs.** Full-size commission is $2.50 a contract a side and micro commission $1.25
    (the broker will be TradeStation). An entry is ineligible when the spread is more than a
    quarter of the stop distance.
28. **Limit entries are preferred, and they are short.** A limit entry lasts a few seconds
    and is priced from the book at the decision. Market entries pay too much spread.
29. **No model predicts a reversal.** It is not possible to say with useful confidence that
    the current move is a reversal or a continuation. Middle candidates at a quarter and at
    half of a 0.5 or 1 ATR threshold reversed 42% to 46% and 59% to 62% of the time, where a
    random walk with the same barriers gives 40% and 60%, and no model beat the distance
    already moved. There is one trained model, the decision model.
30. **Swings are an ATR zigzag at about 3 ATR**, confirmed when price has moved the
    threshold away from the extreme and never changed afterwards. The scales at 0.5, 1, and
    2 ATR stay; the model reads all of them.
31. **The confidence of an unconfirmed swing is arithmetic:** the pullback so far divided by
    the threshold (2 of 3 ATR: 67%; 2.5 of 3: 83%). Corrected November 27: the stored
    `progress` is the *deepest* pullback since the running extreme over the threshold, so
    it stays at 0.8 after a move has recovered to within a point of its extreme, and it is
    not a probability. Where the move stands now is `ext_dist_atr`, in ATRs; the current
    pullback over the frozen threshold is not stored as its own feature yet
    ([status](status.md#open-items)).
32. **Structure is a code computed from confirmed swings and the current price:** higher or
    lower highs and lows, and whether the current price has broken the last confirmed low
    or high.
33. **Two passes.** The first computes everything on price and flow. The second computes
    the same swings and structure on derived series (RSI, net flow, later others) and
    whether they agree with price. A disagreement is evidence against a trade, not a signal
    to take one; the decision model weighs it.
35. **A decision is a step in position** (Paul, November 23). The position is long, flat, or
    short. A decision is buy, sell, or nothing, and moves the position one step: a sell
    while long closes the long, and a later sell opens a short. A closing decision exits at
    the market and cancels the position's orders, whatever its bracket says. Built into the
    engine before anything is judged by it.
36. **Risk and the daily limit are percentages of the account**, not dollars (Paul,
    November 23). The risk of a trade between entry and stop, the loss that ends a day, and
    the account size are variables of a run; the position is sized from them. The first
    values are 0.5% a trade and 2% a day, to be changed freely.

37. **Closing rules** (Paul, November 23). The engine can always close on a decision
    (decision 35); when a policy does so is a setting. The default and the headline result is
    `hold`: a position leaves only by its stop, target, time limit, or the session's forced
    exit, the simple and traditional way. `turn` (close when the forecast no longer favours
    the position) and `opposite` (close on a clear signal the other way) run beside it on the
    same openings, to see what closing early adds.

38. **One decision, every second** (Paul, November 24). Inference and the decision run at
    every `1m@1s` row; there is no separate decision timeframe. The slower timeframes give
    the trend and can forbid a trade: when the fast timeframe looks up and a slower one is
    down, no long is opened. "Up" and "down" are each timeframe's `trend` on its 3 ATR
    zigzag (a higher high and a higher low, or the mirror). A long needs no timeframe down
    and a short none up; requiring all to agree is the stricter rule to switch to if this
    one lets too many bad trades through. The gate is applied by the policy, and the model
    also reads the same trends as inputs; a run without the gate shows what it does.
39. **The bracket** (Paul, November 24). Stop and target are the same distance from the
    entry, 1.5 slow ATRs, with no time limit; a position still open is closed before the
    day's close. Measured on January to August 2026, from starts every 15 minutes: price
    reaches 1.5 slow ATRs either way before the close in 71% of cases, after a median of 3.6
    hours (1 ATR: 82%, 1.9 hours; 2 ATRs: 57%, 5.2 hours; 3 ATRs: 36%, 7.6 hours). Larger
    than 2 and most trades would simply end at the close. The multiple is a variable.

40. **Two modes, one switch** (Paul, November 24). The system trains and trades either way:
    *intraday*, every position closed before the day's close, or *swing*, positions held
    across the daily break and across days. The switch sets both the target a model is
    trained on and what the engine does at a close, so a model is always replayed in the mode
    it was trained for. Intraday stays the mode results are judged in first.

41. **Three structures: price, RSI, and CVD, each sized by its own ATR** (Paul, November 24).
    The same zigzag and structure code are computed on RSI and on CVD, the running total of
    buying minus selling. Each series has its own ATR, the average range of that series over
    its timeframe's windows: a swing of RSI is so many ATRs of RSI, never of price. The
    model is given all three structures and what they say about each other, and it decides
    whether they must agree; no rule requires it.

42. **Many products, one year each** (Paul, November 27). The model is one model for every
    product, with no product identity among its inputs, so every product added is more
    training data for the same model. Products are added across kinds of market (metals,
    equity indices, energy, rates, currencies) before more of one kind, because products of
    one kind move together and add fewer independent days. What this changes in how a
    result is judged is [below](#how-results-are-judged).
43. **The clock is an input** (Paul, November 27). Every decision row carries where it is in
    time: the time of day, the time since the session opened and until it closes, the time
    to and from the opening and closing of the product's main market hours, and the day of
    the week. Beside the scheduled-news table of decision 15.

**Open, to be tested and not decided:** moving the stop to the entry price once price has
moved a set number of ATRs in favour ([named in the spec](yardstick-spec.md#named-now-run-later)).

## How results are judged

Rewritten November 27, 2026, for one year of many products, before any product is added,
so that no split is chosen after seeing a result. **Proposed; Paul has not confirmed the
numbers marked so.**

- **The unit of evidence is still the trade date.** Products trade on the same days and
  respond to the same news, so rows of different products on one date are not independent.
  Every interval resamples whole trade dates, with all products' rows of a date together.
  More products narrow an interval only as far as they are not moving together: products of
  five different kinds are worth perhaps two to three times the dates of one, never five.
- **Three kinds of data.** *Development*: every product's rows from January 2 to August 31,
  2026, walked forward by month as now (test months May to August). *Final holdout in
  time*: September 1, 2026 onward, for every product, evaluated once. *Held-out products*
  (proposed): two products, of kinds also present in development, that no model is fitted
  on and nobody looks at until the final evaluation. A model that has learned something
  general about markets should work on a product it never saw; one year gives no other way
  to test that.
- **A claim needs more than one product.** A result is reported pooled, by product, by kind
  of market, and for buys and sells apart. It counts when it is above zero with its
  interval pooled, and at or above zero for most products and for every kind (proposed: at
  least three kinds present). One good product or side is a lead, not a result.
- **Leave one kind out.** Beside the walk-forward fit, the model is fitted without each
  kind of market in turn and scored on it. A model that only works on the kind it was
  fitted on has learned that market's year, not a pattern.
- **What is reported**, for every policy: net R and drawdown in one portfolio under the
  daily limit, at base and stressed execution; the result per trade date with a 95%
  interval from resampled trade dates; and the number of independent trade dates.
- **Every variant is counted.** Each run is recorded with its spec before it starts
  (`research.run`); the count of variants tried on a period is reported beside any result
  chosen from them.

## Build order

Reordered November 27, 2026 (Paul: no more years are bought; many products on the free
year; the clock as an input). Each item names the step of the process it advances. What is
done is in the [build log](build-log.md).

1. **The clock and session inputs: done** (November 27;
   [record](build-log.md#the-clock-and-session-inputs-november-27-2026)). (step 1; [decision 43](#decisions)). A stage computed
   from the calendar alone, so it rebuilds nothing: time of day in the exchange's local
   time as a cycle, seconds since the session opened and until it closes and until the
   forced exit, seconds to and from the open and close of the product's main market hours,
   whether the row is inside them, the day of the week, and early-close days. The main
   hours are a property of each product. Judged like any input, by the decision model with
   and without it.
2. **Does the minute-end result hold between minute ends?** (step 6.) The dataset has one
   row a minute, at its last second, where every slower timeframe has just completed a row.
   Add rows at the other ten-second ends, which are stored, with the minute-end rows as the
   control.
3. **Store one-second values only where they are read** (steps 1 to 3;
   [decision 25](#decisions)). The database holds 375 GB for two products today. Without
   this, eight products do not fit the disk.
4. **More products on the free year** ([decision 42](#decisions)). In this order: one
   product of each new kind of market first (an equity index, then energy, rates, a
   currency), then more of a kind. Each needs its tick size and value, costs, calendar, and
   main hours in the product table, its files validated, and an ingest of a few hours. The
   evaluation above is switched on before the first one is scored.
5. **The book between trades** (`book_1s`, step 1), judged at the one-minute horizon and by
   the quality of entries, and **the scheduled-news table** ([decision 15](#decisions)).
6. **The codes that compare the structures of price, RSI, and CVD** (step 5;
   [decision 41](#decisions)): what each series had confirmed when price confirmed a higher
   high or a lower low, the age of each confirmation, and "still waiting" kept apart from
   "confirmed and disagreeing", since RSI and CVD confirm later than price. With the
   current pullback over the threshold as a feature, which also needs the swing stages
   rebuilt.
7. **One portfolio across products** (step 6): one position at a time and one daily limit
   shared by every product, needed as soon as a model trades more than one.
8. **The swing mode** (step 6; [decision 40](#decisions)): positions held across the daily
   break and across days, as a switch for training and trading alike. A stop is then judged
   by the first trades after the reopen, a position is closed before its contract stops
   being the front one, and the target follows price across sessions.
9. **More inputs, each judged by the decision model:** structure across timeframes in one
   code, the [pair stage](pair-design.md), indicators of indicators last, and the variants
   the [spec](yardstick-spec.md) names.
10. **The final evaluation** of the decision model on the holdout in time and on the
    held-out products, once. Then paper trading on the live feed, and live trading after it.

### How a policy is evaluated

- **In the engine, in one portfolio.** The same code as a live session, with the book each
  order meets, one position at a time across the products, and the daily limit.
- **In R first.** A trade's result is its profit over its entry-to-stop distance, after
  fills and before commission. Commission is a known amount per contract and is subtracted
  after sizing; dollars and percentages follow from the run's account size and risk.
- **Known and unknown are kept apart.** A trade that closed at prices the book showed has a
  result. An entry that is known not to have traded (a limit that expired) is worth zero. An
  entry that met no usable book, an exit priced without one, and follow-up cut off by the end
  of the data are unknown: counted, and left out of training. In the portfolio a position
  whose exit had no book stays in the ledger at its fallback price, flagged, and the result
  is also given with each flagged exit charged one further stop distance.
- **Fitted on earlier sessions only**, purged by the label's horizon; thresholds are chosen
  on the same training history.
- **Stressed.** Again with longer order latency, one more tick against every marketable
  order, and the stricter fill rule for limit orders.
- **Every variant is logged**, including unsuccessful ones, before the reserved period is
  examined. Repeated selection on the same history can make an ordinary strategy appear
  profitable ([Bailey et al.](https://escholarship.org/uc/item/4w1110bb)).

One control tests the value of the sliding clock itself: the same policy deciding only at
completed minute boundaries, against deciding at every second, in one portfolio with the
same limits.

## After the build order

- **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the same
  engine; record each day and replay it as a backtest to confirm identical decisions.
- **Live trading**: a broker execution adapter with order reconciliation, risk limits,
  pause and resume, manual overrides, and a log of automated and human decisions.
