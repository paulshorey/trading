# Platform roadmap

Goal: one machine-learning model that makes the trading decisions, in backtests and then
live, on one engine. Its inputs are pre-processed signals on several timeframes: the state
of the market, and where price and its derivatives stand against their own confirmed swing
highs and lows ([goal and process](../../AGENTS.md#goal)).

This page is the current plan: what is computed, in what order, and how far it has come.
It was cut to the plan in force on November 23, 2026; earlier designs and the decisions
that were withdrawn are in the git history (the last version with them is commit `df5a907`)
and what they found is in the [build log](build-log.md). Details are in the
[feature pipeline](feature-pipeline.md), the [pivot/structure contract](pivot-structure-design.md),
the [pair design](pair-design.md), the [first decision model's spec](yardstick-spec.md), and
the [handoff](handoff.md).

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
| **Structure** | Where does it stand against its own recent highs and lows? | An ATR zigzag of price, then of RSI and of net flow: confirmed swings, the trend they make, the levels the current value has broken, how far the open move has come, and whether the derived series agree with price | 4 and 5 |
| **Decisions** | What position to hold? | One trained model and the rule that turns its forecast into buy, sell, or nothing. One portfolio, after costs | 6 |

Beside all three stands **evaluation**: labels, splits by time, the engine's fills, and the
record of every variant tried. It is built before the things it judges.

No model sits in the middle. Swings and structure are computed by rule
([decision 29](#decisions)); the only thing trained is the decision model.

### The trade the system looks for

Three timeframes, each with one job:

- **Slow (`1h@1m`)** sets direction and regime. Its ATR sizes the protective stop, so the
  move traded is large against the spread.
- **Middle (`10m@10s`)** is where decisions are made: every ten-second row is a decision row.
- **Fast (`1m@1s`)** times the entry: a limit order that lasts a few seconds.

**A decision is a step, and the position follows the market** ([decision 35](#decisions)).
At each decision row the model's forecast becomes buy, sell, or nothing. The position is
long, flat, or short, and a decision moves it one step: a buy opens a long when flat and
closes a short when short; a sell is the mirror. A closing decision exits at the market and
cancels the position's orders, whatever the bracket says. The bracket is a stop, a target, a
time limit, and the flat-before-close rule. Whether a policy closes on decisions at all is a
setting: the default holds a position to its bracket, and two rules that close early run
beside it ([decision 37](#decisions)). Trades are intraday.

**Risk is a share of the account** ([decision 36](#decisions)): each trade risks a set
percentage between its entry and its stop, and a day stops after a set percentage is lost.
Both are variables. Results are read in R, the unit of risk of one trade, which does not
depend on them.

## The process and where it stands

The six steps are in [AGENTS.md](../../AGENTS.md#the-process-required-order). A **step** is
a part of the process; a **tier** is a dependency level in the code
([feature pipeline](feature-pipeline.md#tiers-calculations-in-dependency-order)); a **stage**
is one stored table with its own version.

| Step | Stages | State | What is missing |
| --- | --- | --- | --- |
| 1. Base rows | `bar_1s`, `bar_10s`, `bar_1m`; planned `book_1s` | Built from trades | The book between trades: the data reaches the engine, no stage reads it. A net-flow series that does not reset at the session open |
| 2. Sliding windows | `candle_1m_1s`, `candle_10m_10s`, `candle_1h_1m` | Built on three timeframes, with row counting and per-phase indicators; a timeframe is a parameter | A session-long window for a view of several days |
| 3. Indicators, then indicators of indicators | `candle_*`, `stats_*`, `vol_*` | Indicators and volatility on price are built: 637 features | Nothing is computed on an indicator. Many of the 637 restate the same price path ([review](#review-of-november-23-2026), point 6) |
| 4. Swings and structure of price | `pivot_1s`, `pivot_10s`, `pivot_1m`, `pivot_event` | An ATR zigzag at 0.5, 1, and 2 ATR on each timeframe, with `progress`, `trend`, the class of the last high and low, and the age of each break | The 3 ATR scale; one structure code per scale |
| 5. Swings and structure of derived series | Planned `pivot_rsi_*`, `pivot_flow_*`, `signal_*` | Not built. The swing code already takes a source in its own units | Swings of RSI and of net flow; agreement and divergence against price |
| 6. Decision model | `labels.py`; planned `ml.*`, `research.*` | An engine with fills at the book and a losing rule-based baseline. The engine takes entry signals only | Position decisions in the engine; the model; its evaluation ([spec](yardstick-spec.md)) |

Base rows and indicator stages hold one row per scheduled slot and contract. Swing rows of
the fast timeframe and all events are sparse: stored where something reads them.

**Pairs.** Steps 1 to 5 are computed for each product alone. Pair stages then read two
products that move together at the same row ([pair design](pair-design.md)).

## What the results so far do and do not show

Everything tested so far was a rule that enters at a swing candidate, and none beat staying
flat ([build log](build-log.md), [record of the replays](../archive/replay.md)):

- **Entering at a fast or a middle swing candidate loses about one spread**, at a
  one-minute bracket and at an hourly one, with a market order or with a limit resting at
  the candidate's extreme. No rule on the slow swings changes that.
- **No model told which early reversals complete** better than the distance price had
  already moved, and candidates reversed about as often as a random walk would
  ([decision 29](#decisions)).
- **One pattern repeated:** entering against the `slow_atr_1` trend was worse than entering
  with it, by $20 to $240 an attempt, in both halves of the period and for fast and middle
  candidates alike. It removes losses and leaves a result near zero.

What has not been asked: whether the inputs predict what price does next, at any horizon.
That is the first thing the [decision model's spec](yardstick-spec.md) measures.

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

**One year cannot judge an hourly policy.** Results are only as many as their independent
trade dates: the four test months hold 87, and a mean per attempt is known to about ±$100
to ±$300 against a cost near $80. Five more years of GC and SI are the largest single lever
([decision 13](#decisions)).

## Review of November 23, 2026

Asked for by Paul after the trained reversal model was withdrawn: what else in the code or
the plan should not be there, and what is missing. Checked against the code and the rebuilt
database.

1. **The engine cannot make the decision the goal describes.** A strategy returns an entry
   signal per row. The engine ignores signals while a position is open, enters with a market
   order, and exits only by the bracket (`engine.py`, `strategies.py`). Closing a position
   on a decision, a limit entry that lasts seconds, and a stop sized by the slow timeframe do
   not exist there. This is the largest gap between the code and the goal, and the first
   item of the [build order](#build-order).
2. **Nothing has asked whether the inputs predict anything.** No model was fitted from the
   637 features to what price did next, at any horizon. That costs days, and it tells where
   to look ([the horizon map](yardstick-spec.md#part-a-the-forecast)).
3. **A fixed-dollar cap did not fit the bracket.** The median hourly ATR from January to
   August was $20.50 an ounce for GC and $0.76 for SI: a stop of one ATR risks about $2,050
   on a GC contract and $3,800 on SI ($205 and $760 on the micros). Under a $3,000 cap an SI
   trade was usually refused outright, which set the product mix of the middle replay.
   Resolved by [decision 36](#decisions): risk is a percentage of the account, and the
   position is sized from it.
4. **GC and SI are closer to one market than to two.** They move together, so the second
   adds fewer independent days than its row count suggests. An unrelated product (ES) adds
   more evidence, and the model is pooled with no product identity, so it benefits directly.
5. **Most of the storage is the timeframe that cannot pay.** The one-second tables are about
   135 of the database's 150 GB (`candle_1m_1s` alone is 61). In two weeks of March, 63% of
   GC seconds and 83% of SI seconds had no trade, against 8% and 32% of ten-second rows.
   With 4 TB this is not urgent, but one-second values should be stored only where they are
   read before more products arrive ([decision 25](#decisions)).
6. **Many features are the same price path seen again.** Of the 119 middle-timeframe
   features, 44 have a twin with a rank correlation above 0.9, and 39 combinations carry
   90% of their variation (GC, March and April). Stochastics, CCI, Aroon, Bollinger,
   Donchian, MACD, and three EMAs all restate where price is in its recent range, and the
   candle stage stores body and wick ratios, which the project's own principle says are not
   signals. A tree model tolerates this; the cost is that an input cannot be judged column by
   column. Inputs are judged by group, and new work goes to different information.
7. **A limit order's fill cannot be known from this data.** MBP-1 shows the best bid and
   ask, not the queue. Counting a fill only when a trade goes through the price is too
   strict and keeps the worst fills; counting it at a touch is too generous. The usual
   conservative model puts the order at the back of the displayed size and advances it only
   by trades at its price. Both are run, and paper trading calibrates them. Fills of
   resting orders are followed by adverse moves on average
   ([measured elsewhere](https://arxiv.org/abs/2407.16527)), which the middle replay showed
   here too.
8. **The book will help time an entry, not choose a direction.** Order-flow signals from
   the book have been found to predict about two price changes ahead
   ([Kolm, Turiel and Westray](https://papers.ssrn.com/abstract=3900141)): seconds. So
   `book_1s` is judged at the one-minute horizon and by the quality of entries.
9. **"Several days of trend" is not in the inputs.** The slow RSI spans 14 hours and its
   EMA(200) about nine sessions. `Timeframe` allows steps of at most 60 seconds. A window of
   60 rows of 23 minutes is exactly one 23-hour session; lifting that limit is a small
   change, with the question of what a row means on a shortened session to settle first.
10. **What the withdrawn design left behind** was removed the same day
    ([build log](build-log.md#the-withdrawn-design-removed-november-23-2026)): the label
    stages and their tables, the benchmark of reversal models, and the candidate replay.
11. **The final holdout is two months.** About 45 trade dates cannot confirm anything on
    their own. The five untouched years are the real test, and paper trading after them.

What was right and stays: rows counted by index, per-contract computation, one engine with
fills at the book, normalized features, specs written before runs, and intervals from
resampled trade dates.

## Decisions

The decisions in force, with the numbers they were given. Numbers missing from the list
were withdrawn or replaced: 2 to 5, 10, and 17 (models in the middle and their targets), 18
and 34 (replaced by 35), 19 (replaced by 36).

1. **Keep the codebase.** Stages, tiers, row counting, per-contract computation, and one
   engine are the multi-pass design the process describes.
6. **Evaluation after costs is the yardstick.** A policy counts only against staying flat,
   paired on the same decisions with a 95% interval from resampled trade dates, on neither
   product alone a loss, and still positive under the latency and extra-tick stress.
7. **Sparse layers store events and decision rows, not every second.**
8. **A timeframe is a parameter.** Adding one adds stages and rebuilds nothing else.
9. **More history is the largest single lever.**
11. **The middle timeframe is `10m@10s`.** A step must divide a minute, or rows would mix
    the seconds before a close with those after the reopen.
12. **GC and SI are the proof of concept.** Everything is built for any number of products
    and pairs. Disk space is not a design constraint.
13. **Five more years of GC and SI** will be downloaded. They are untouched, so they test
    what 2026 suggested: the first thing that reads their outcomes is the
    [decision model's spec](yardstick-spec.md) with its settings unchanged, on a frozen
    evaluation period added to `periods.check_period` before the run. Afterwards they are
    development data, walked forward by year. September 1, 2026 onward stays the final
    holdout, and paper trading is the test after it.
14. **Intraday first.** Positions are flat before each close.
15. **Scheduled news is an input:** a table of release times known in advance gives every
    row its time to the next release and since the last one. Results are also reported
    without the minutes around a release.
16. **The live contract is undecided** (full-size GC and SI, or the micros MGC and SIL).
    Results are reported at both costs. The micro books are not in the data, so the second
    is a stress, not a simulation.
20. **No trade count is aimed for.** A policy is never tuned toward a number of trades.
21. **It runs unattended, inside the session.** An entry is allowed only while its longest
    hold still fits before the forced exit.
22. **The purpose is to prove the method before any capital is committed.** Unusual ideas
    are welcome; each is still written down before it is run and recorded whatever it shows.
23. **No trade where the market cannot be trusted.** An entry is not eligible when the
    session's data is flagged, the book at the decision is missing, one-sided, or flagged,
    or the spread is too large a share of the stop distance. Such rows are left out of
    training, by eligibility at the decision row, and counted. The ATR that normalizes
    features is floored at the spread, as the swing threshold is.
24. **One set of stages for every timeframe.**
25. **Storage.** A product-year takes about 73 GB with every second stored. Six years of GC
    and SI fit easily on 4 TB; seven products do not, unless the one-second window,
    statistics, and volatility rows are stored only where something reads them (every
    ten-second row's end, every decision and event row). `bar_1s` stays complete, and the
    engine computes every second either way.
26. **The new machine's build is the starting point.** `~/fingerprint-new.txt` is the
    baseline for later rebuilds.
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
    the threshold (2 of 3 ATR: 67%; 2.5 of 3: 83%). This is the stored `progress`.
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

**Open, to be tested and not decided:** moving the stop to the entry price once price has
moved a set number of ATRs in favour ([named in the spec](yardstick-spec.md#named-now-run-later)).

## How results are judged on six years

Frozen November 20, 2026, before the older years arrive, so that no split is chosen after
seeing a result.

- **Three periods.** *Untouched development*: November 2020 to October 2025, the years
  nobody has looked at. *Exposed development*: November 2025 to August 2026, the year every
  design choice so far was made on. *Final holdout*: September 1, 2026 onward, evaluated
  once, with paper trading after it.
- **A claim is made on the untouched years.** The exposed year may suggest a hypothesis; it
  cannot confirm one. A result is reported for each period apart, never pooled.
- **Walk-forward by quarter.** A model that scores a quarter is fitted on all earlier
  sessions, less a purge as long as the label's horizon and one session of embargo. The
  first scored quarter needs at least one year of training. Scaling, feature choice,
  calibration, and thresholds are fitted on the same training sessions.
- **What is reported**, for every policy: net R and drawdown in one portfolio under the
  daily limit, at base and stressed execution and at full-size and micro costs; the result
  per trade date with a 95% interval from resampled trade dates; all of it by year, by
  product, and for buys and sells apart; and the number of independent trade dates.
- **A policy counts** when its result is above zero on the untouched years with its
  interval, in at least four of the five years taken alone, for both products and both
  sides, and still above zero under stressed execution. One good year, product, or side
  is a lead, not a result.
- **Every variant is counted.** Each run is recorded with its spec before it starts
  (`research.*` tables); the count of variants tried on a period is reported beside any
  result chosen from them.

## Build order

Rewritten November 23, 2026. Each item names the step of the process it advances.

**Done.** (1) The after-cost replay of fast candidates. (2) Sparse storage of the fast swing
rows. (3) The timeframe as a parameter. (4) The middle timeframe `10m@10s`. (5) One set of
stages for every timeframe. (6) The replay of the middle timeframe's candidates. What each
built and found is in the [build log](build-log.md).

7. **The engine makes position decisions** (step 6). A strategy returns buy, sell, or
   nothing at each decision row, and the engine moves the position one step
   ([decision 35](#decisions)): it opens, leaves alone, or closes at the market and cancels
   the position's orders. Entries are market orders or limit orders that last seconds
   ([decision 28](#decisions)), with the back-of-queue fill model beside the strict one. The
   stop is sized by the timeframe the strategy names, the position by the risk percentage,
   and the day ends at the daily limit ([decision 36](#decisions)). Moving the stop to the
   entry price is an option of the bracket, off by default. Whole sessions and one second at
   a time must still give identical results (`research verify`). It is checked with a
   rule-based strategy; no model is needed yet.
8. **The first decision model** (step 6; [spec](yardstick-spec.md)). Part A: the decision
   dataset, the label, a walk-forward forecast on the features that exist, and the table of
   what is predictable at 1, 5, 15, and 60 minutes from each kind of input. Part B: the
   policy in the engine, in one portfolio after costs. It will probably show no skill and
   place few trades. From here on, an input is judged by one question: does the model
   forecast better with it than without it, on the same rows?
9. **Structure of price** (step 4). A scale at 3 ATR on every timeframe (roughly 140
   confirmed highs a year a product on the slow timeframe and 900 on the middle one, scaled
   from the counts at 2 ATR), and one structure code per scale. It is the first input the
   decision model judges.
10. **Base changes, in one rebuild** (step 1). A rolling net-flow series that does not reset
    at the session open; the ATR normalizer floored at the spread; the `source.py` change in
    the [to-do list](todo.md#housekeeping).
11. **The second pass: swings and structure of RSI and of net flow** (step 5), on every
    timeframe, with the swing code that price uses and a threshold in each series' own
    units, frozen in a spec first. Then the agreement codes against price.
12. **Six years of GC and SI**, when the files are here. A build is a few hours, so it does
    not wait for the items after it; they rebuild what they change.
13. **The book between trades** (`book_1s`, step 1), judged at the one-minute horizon and by
    the quality of entries, and **the scheduled-news table**.
14. **ES**, as the first product that does not move with the metals, with one-second values
    stored where they are read.
15. **More inputs, each judged by the decision model:** a session-long timeframe, structure
    across timeframes in one code, the [pair stage](pair-design.md), indicators of
    indicators last. And the variants the spec names.
16. **The final evaluation** of the decision model on the holdout, once. Then paper trading
    on the live feed, and live trading after it.

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
completed minute boundaries, against deciding at every ten-second row, in one portfolio
with the same limits.

## After the build order

- **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the same
  engine; record each day and replay it as a backtest to confirm identical decisions.
- **Live trading**: a broker execution adapter with order reconciliation, risk limits,
  pause and resume, manual overrides, and a log of automated and human decisions.

What is finished is listed in the [to-do list](todo.md#done) and recorded in the
[build log](build-log.md).
