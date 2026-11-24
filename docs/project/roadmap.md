# Platform roadmap

Goal: a machine-learning model that makes the trading decisions, in backtests and then
live, on one engine. Its inputs are layers of pre-processed signals on several timeframes;
the central one is the probability, on a faster and a slower timeframe, that price has
recently reversed and is now continuing ([goal and process](../../AGENTS.md#goal)).

This page is the map: what is computed, in what order, and how far it has come. Details
are in the [feature pipeline](feature-pipeline.md) (rules every stored value follows), the
[plan for stages and swing structure](plan-1h-and-pivots.md), the
[pivot/structure contract](pivot-structure-design.md), the [pair design](pair-design.md),
and the [handoff](handoff.md) (current state and how to continue).

## Two ideas everything rests on

1. **Sliding windows.** A candle covers a higher timeframe but is recomputed at every step
   of a lower one: `1m@1s` is the last 60 one-second rows, every second; `1h@1m` is the last
   60 one-minute rows, every minute. Windows count rows of scheduled trading time, never
   clock time ([sliding windows](../sliding-windows/README.md)).
2. **Passes.** History is processed in passes, like floors of a building: each pass reads
   only the passes below it, and a pass is finished for a moment in time before anything
   above reads it. A value never uses information from after its own row.

Indicators that advance by one candle period read the previous window of the same phase.
The swing detector uses the sequence of released trades so it can tell which barrier was
hit first inside a candle. Fast and slow swing scales use their respective completed
ATR and publish state at second and minute closes. A second-level decision can read the
latest completed minute, including its age.

## How the analysis is structured

The six steps say what is computed and in what order. This section says what each part is
for, so that every task can name the question it answers.

| Role | The question it answers | What it holds | Steps |
| --- | --- | --- | --- |
| **State** | What is the market doing now? | Base rows, windows, indicators and indicators of indicators, volatility, the book, net flow, time to scheduled news, on every timeframe | 1 to 3 |
| **Events** | Is there something to decide now? | Swing candidates and confirmations, breaches and reclaims, divergences, agreement across timeframes. Sparse: a few per hour | 4 (pivots) and 5 |
| **Forecasts** | What will probably happen? | Models with one label each: turn, continue, direction, and the size of the coming move. Stored out of fold | 4 (models) |
| **Decisions** | What to do? | Take or skip, side, size, the entry order, exits. One portfolio, after costs | 6 |

Beside all four stands **evaluation**: labels, splits by time, the replay, and the record of
every variant tried. It is built before the things it judges.

### The trade the system looks for

Three timeframes, each with one job:

- **Slow (`1h@1m`)** sets direction and regime. Its ATR sizes the stop and the target, so the
  move traded is large against the spread. A trade lasts minutes to a few hours and is flat
  before the session closes (Paul, November 20: intraday first, overnight later).
- **Middle (`10m@10s`)** is where decisions happen. An event on it creates a decision row
  and names a side.
- **Fast (`1m@1s`)** times the entry and chooses the order: a market order, or a limit
  order resting at the level, counted as filled only when a trade goes through its price.

An event family is a hypothesis with a side. Each is replayed the same way, alone and
together, and none is known to pay:

1. **A pullback that holds** (the goal's central signal): the slow timeframe has turned up
   and is continuing; the middle one pulls back and makes a higher low; buy. Mirror for a sell.
2. **A failed break:** a middle swing level is breached and then reclaimed; trade back inside.
3. **Flow divergence:** price makes a new extreme and net flow does not; fade it.
4. **RSI divergence:** the same against RSI.
5. **The partner lags:** one metal has turned and the other has not; trade the laggard.

**The decision model is asked a narrow question.** At an event row the side is given, and
the model learns whether to take the trade, and how large, from what attempting it earned
after costs (the replay's [value of attempting](#after-cost-replay)). Choosing a direction
from nothing is the hardest question there is: the return of one block says nothing about the
next at the five horizons measured, and only that linear check was made
([measured](#review-of-november-20-2026)). "Is this setup worth taking now" has plain
baselines (take all, take none) and is the question the goal asks. The *direction* target
at any row stays as a forecast, and as the check that the events are not hiding an edge.

**Size is easier to forecast than direction.** How far price will move in the next window
follows the recent range, the time of day, and scheduled news closely. A policy that trades
only when the expected move is large against the cost needs a smaller edge in direction. The
size of the coming move is therefore a forecast of its own.

## The process and where it stands

Reviewed November 20, 2026 against the six steps in [AGENTS.md](../../AGENTS.md#the-process-required-order).
A **step** is a part of the process; a **tier** is a dependency level in the code
([feature pipeline](feature-pipeline.md#tiers-calculations-in-dependency-order)); a **stage**
is one stored table with its own version. Pages written before November 19 say "layers":
layer 0 is step 1, layer 1 is steps 2 and 3, layer 2 is the pivots of step 4, layer 3 its
models, layer 4 is step 5, and layer 5 is step 6.

| Step | Stages | State | What is missing |
| --- | --- | --- | --- |
| 1. Base rows | `bar_1s`, `bar_10s`, `bar_1m`; planned `book_1s` | Built from trades | The book between trades: the data reaches the engine, no stage reads it |
| 2. Sliding windows | `candle_1m_1s`, `candle_10m_10s`, `candle_1h_1m` | Built on three timeframes, with row counting and per-phase indicators; a timeframe is a parameter | A slower window for holding overnight, when that is wanted ([decision 14](#decisions-of-november-20-2026)) |
| 3. Indicators, then indicators of indicators | `candle_*`, `stats_*`, `vol_*` | Indicators and volatility on price are built | Nothing is computed on an indicator: no RSI of RSI, no EMA of RSI, no trend of CVD |
| 4. Reversal and continuation probabilities | `pivot_1s`, `pivot_10s`, `pivot_1m`, `pivot_event`, `pivot_label_*`; planned `pivot_rsi_*`, `pivot_flow_*`, `model_*` | Swings, labels and a benchmark exist for price | No model is stored; only "will this early reversal complete" has a label; no swings of RSI or CVD |
| 5. Structure and divergence | In the swing rows today; planned `signal_*` | Higher and lower highs and lows, trend, breaches | No divergence of any kind; cross-timeframe agreement was tested only as rules on the slow swings, and [none paid](replay.md#agreement-results-november-19-2026) |
| 6. Decision model | `labels.py`, `research replay`; planned `ml.*` | An engine with fills at the book, would-be trade rows, a losing rule-based baseline, and the [after-cost replay](replay.md) that compares policies in one portfolio | No trained decision model; no policy beats staying flat |

The foundation (steps 1 and 2, the stage graph, the engine, the checks that stored rows equal
live ones) is sound and stays. The work is in steps 3 to 6.

Base rows and indicator stages hold one row per scheduled slot and contract. Swing events,
labels, and model outputs are sparse: stored at events and decision rows
([decision 7](#design-decisions-november-19-2026)).

**Pairs.** Steps 1 to 5 are computed for each product alone. Pair stages then read two
products that move together at the same row (`GC` with `SI`, `ES` with `NQ`): relative
strength, spread and ratio moves, lead and lag, and each partner's swing, model, and
structure state ([pair design](pair-design.md)). The final model reads both.

Structure is computed twice: once from the deterministic swings, before any model, and
again with the model's probabilities ([decision 2](#design-decisions-november-19-2026)).

### Predictions that later steps read

Withdrawn on November 23, 2026 ([decision 29](#decisions-of-november-23-2026)): no model sits
in the middle of the pipeline. The text below is kept as the record of the earlier design.

The swing detector confirms a swing only after price has reversed by the full threshold, which is
late. A model of step 4 would estimate, from the current candidate, three probabilities that sum to
one: the reversal barrier is reached first, the invalidation barrier is reached first, or
neither is reached within the horizon ([targets](#design-decisions-november-19-2026)).
A candidate whose horizon does not fit in its session, or whose follow-up has no data
coverage, is not a fourth class: it is left out and counted
([decision 3](#design-decisions-november-19-2026)). The confirmed swing retains its actual confirmation time. A later structure
model could use this forecast alongside the previous confirmed highs and lows.

A model's output is only a valid input for a later step if the model could not have seen
the future of the row it scores. The rule (proposed November 15, 2026; details in the
[feature pipeline](feature-pipeline.md#model-stages)):

- A model stage is trained **walk-forward**. Its stored prediction for a session comes
  from a model fitted only on sessions that ended earlier, with a gap at least as long as
  the label horizon. The first sessions of the history have no prediction (NULL).
- Each stored prediction records the model that produced it. A retrained model adds a new
  version; nothing is overwritten in place.
- The second structure pass and the decision model train only on rows that have these out-of-sample
  predictions, so they learn from predictions of the quality they will get live.

The first structure pass builds on the deterministic swings and
their provisional (not yet confirmed) relations, as the
[contract](pivot-structure-design.md#provisional-higher-lows-and-lower-highs-are-causal-candidate-features)
specifies. The model's probability then joins as one more input, and the benchmark decides
whether it improves on the rule.

## What the results so far do and do not show

The benchmark ([results](build-log.md#pr-f-results-labels-and-benchmark)) found that models on
the stored features tell which early reversals complete no better than the distance price
has already moved. That result is real, and narrow:

- It tested one question (will a candidate reach its confirmation threshold) on the fast
  scales, where the threshold is about 5 basis points for GC. The slow scales had too few
  candidates in one year to fit.
- Its inputs were the 138 to 147 stored features of the decision row: steps 1 to 3 for
  price and the swing structure of step 5 (higher and lower highs and lows, breaches). The
  inputs the process names as the important ones, divergences and indicators of indicators,
  did not exist, and the book was not read.
- It says nothing about continuation, which has no label yet.

So it does not show that reversals cannot be predicted. It shows that the stored price and
swing features add nothing to displacement for a 5 basis point barrier. The conclusion drawn
on November 17, that structure signals were not worth building, is withdrawn.

**Costs decide which timeframe can pay.** Crossing the spread costs 15% (GC) to 23% (SI) of
a typical `1m@1s` true range (`vol_1s.spread_atr`). A bracket sized on that range gives away
about a fifth of its risk on entry, before commission, so a small edge there cannot pay. On
`1h@1m` the same spread is a few percent of the range. (The [review](#review-of-november-20-2026)
measures the spread against the median close-to-close move, which is smaller than the
average true range, so its shares are larger: 36% for GC at one minute.) The fast timeframe therefore times an
entry, and the slower one sets the bracket and the holding time.

## Review of November 20, 2026

A second review, asked for by Paul, of the design and of its chances. It checked the claims
of this page against the code, the database, and the stored rows (`pnpm lint` and `pnpm test`
pass on `main`; `ingest plan GC SI` reports every contract current; the database is 110 GB).

**What holds.** Rows counted by index, per-phase indicators, per-contract computation, one
engine with fills at the book, labels that can never be inputs, specs frozen before a run,
and intervals resampled by trade date are each correct and are kept. The six-step process is
a sound way to build training data, and the stage graph is the multi-pass mechanism it needs.

**What the sliding window is.** It removes the arbitrary start of a candle and updates
every step. It is a better view of the same one-second rows, not new information, so it is
not an edge on its own. The [control](#after-cost-replay) that measures what the faster
clock earns is still not built.

**Costs choose the timeframe.** Measured on the continuous minute rows, January 2 to August
31, 2026 (non-overlapping blocks inside a session; the spread is the mean at trades):

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
linear check only), so there is no plain momentum or reversal to collect: an edge has to come from conditions, which is what
steps 3 to 5 build.

**One year cannot judge the hourly scale.** Results are only as many as their independent
trade dates. The four test months hold 87, and a mean per attempt is known to ±$140 to
±$300 against a cost of about $80 ([replay](replay.md#agreement-results-november-19-2026)).
An hourly policy that takes one block in ten has about 390 trades in eight months. At
fifteen minutes the same policy has four times as many, and the cost is still a tenth of
the move. The middle timeframe is where an edge is both affordable and measurable with the
data held today; the fast one cannot pay and the slow one cannot be measured yet.

**Information before transforms.** RSI of RSI and EMA of RSI are new views of the price
path. The book between trades, net flow (CVD), the partner product, and the time of day are
different information. Both are in the process; where the order is free, different
information comes first, and price against flow before price against RSI.

**What a model in the middle adds.** A boosted model that reads the same inputs gains
nothing from a probability computed from those inputs, except what the extra label taught
it. So a model stage is worth storing when the decision model is better with its
out-of-fold probability than without it, on the same rows. Every stacked level also spends
history, because its readers train only on out-of-fold rows: one year supports one level.

**Code.** Each timeframe was a copy (changed the same day, build-order item 3): `stage_vol_1s.py` and `stage_vol_1m.py` differed in
about 200 of 400 lines, the candle and swing stages are separate modules too, and every
table and migration is per timeframe. Every stage of steps 3 to 5 would be written two or three
times. Making the timeframe a parameter first is the one structural change this review asks
for. It is a refactor of stage modules, checked by rebuilding and comparing stored rows; no
rule, table design, or engine behavior changes.

**What changed in the plan.** The [build order](#build-order) below, which Paul approved
the same day with the [decisions of November 20](#decisions-of-november-20-2026).

## Review of November 23, 2026

Asked for by Paul after the trained reversal model was withdrawn: what else in the code or
the plan should not be there, and what is missing. Checked against the code and the rebuilt
database. The foundation named in the [review of November 20](#review-of-november-20-2026)
still holds. What follows is what does not, most important first.

1. **The engine cannot make the decision the goal describes.** A strategy returns an entry
   signal per row. The engine ignores signals while a position is open, enters with a market
   order, and exits only by the bracket (`engine.py`, `strategies.py`). Going flat on a
   decision, a limit entry that lasts seconds, and a bracket sized by the slow timeframe do
   not exist there; the limit entry exists only in the candidate replay. This is the largest
   gap between the code and the goal ([item 8](#build-order)).
2. **Nothing has asked whether the inputs predict anything.** Every experiment so far judged
   a rule that enters at a swing candidate. None fitted a model from the 637 features to
   what price did next, at any horizon. That costs days, not weeks, and it tells where to
   look ([the horizon map](yardstick-spec.md#part-a-the-forecast)).
3. **The bracket, the contract, and the daily cap do not fit together.** The median hourly
   ATR from January to August was $20.50 an ounce for GC and $0.76 for SI: a stop of one ATR
   risks about $2,050 on a GC contract and $3,800 on SI ($205 and $760 on the micros). So
   under the $3,000 cap one GC loss nearly ends the day and an SI trade is usually refused
   outright, and under the $300 micro cap the same holds. That, not the candidates, set
   the product mix of the [middle replay](replay.md#results-for-the-middle-timeframe-november-23-2026).
   One of the three has to give: a cap stated in R (three losing trades a day, say), a
   position sized by its risk in micro contracts, or a bracket sized by the middle
   timeframe. Until Paul decides, results are read in R first, with dollars beside them.
4. **GC and SI are closer to one market than to two.** They move together, so the second
   adds fewer independent days than its row count suggests. An unrelated product (ES) would
   add more evidence than SI did, and the model is pooled with no product identity, so it
   benefits directly. It is worth bringing ES back before the last items of the build order.
5. **Most of the storage is the timeframe that cannot pay.** The one-second tables are 135
   of the database's 151 GB (`candle_1m_1s` alone is 61). In two weeks of March, 63% of GC
   seconds and 83% of SI seconds had no trade, against 8% and 32% of ten-second rows. The
   fast timeframe times an entry; nothing needs its features at every second in storage.
   With 4 TB this is not urgent, but [decision 25's remedy](#decisions-of-november-20-2026)
   (store one-second values where they are read) should come before more products.
6. **Many features are the same price path seen again.** Of the 119 middle-timeframe
   features, 44 have a twin with a rank correlation above 0.9, and 39 combinations carry
   90% of their variation (GC, March and April). Stochastics, CCI, Aroon, Bollinger,
   Donchian, MACD, and three EMAs all restate where price is in its recent range. The
   candle stage also stores body and wick ratios, which the project's own principle says
   are not signals. A tree model tolerates this; the cost is that an input cannot be judged
   column by column. Inputs are judged by group, and new work goes to different
   information, not more transforms.
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
   `book_1s` is judged at the one-minute horizon and by the quality of entries, and is not
   expected to change a three-hour forecast.
9. **"Several days of trend" is not in the inputs.** The slow RSI spans 14 hours and its
   EMA(200) about nine sessions. `Timeframe` allows steps of at most 60 seconds. A window of
   60 rows of 23 minutes is exactly one 23-hour session; lifting that limit is a small
   change, with the question of what a row means on a shortened session to settle first.
10. **What the withdrawn design left behind.** Eighteen label stages, the benchmark of
    reversal models (`benchmark.py`, 977 lines), and the candidate replay (952 lines) serve
    a kind of decision the plan no longer makes. They stay until the decision model's own
    evaluation runs in the engine, then they are removed, with decision 13's named checks.
11. **The documents are heavier than the code they describe needs.** `docs/project` holds
    6,200 lines; this page carries three layers of superseded decisions. Once this plan is
    approved it is cut to the current plan, with the history left to the build log.
12. **The final holdout is two months.** About 45 trade dates cannot confirm anything on
    their own. The five untouched years are the real test, and paper trading after them.

What was right and stays: rows counted by index, per-contract computation, one engine with
fills at the book, normalized features, specs written before runs, and intervals from
resampled trade dates.

## Design decisions (November 19, 2026)

1. **Keep the codebase.** Stages, tiers, row counting, per-contract computation and one
   engine are the multi-pass design the process describes. Nothing below needs a rewrite.
2. **Deterministic structure first, then models, then structure again.** Divergences and
   higher-low sequences need only confirmed and provisional pivots, so they are computed
   before any model and are inputs to it (tier 3). A model's stored probabilities (tier 4)
   then feed a second structure pass and the decision model (tier 5 and up). This is how a
   model sits in the middle of the pipeline. Step 5 of the process therefore has two passes,
   one before the models of step 4 and one after them.
3. **Three targets per series and scale,** each a label variant of its own:
   - *turn*: the candidate extreme holds and price moves the full threshold away (stored today);
   - *continue*: after a confirmed pivot, the new leg extends by a further threshold before
     price returns to the pivot;
   - *direction*: from the current price, with barriers at equal distance above and below:
     the upper one is reached first, the lower one is reached first, or neither is reached
     within the horizon. For a random walk the first two are equally likely, so skill is
     visible without a displacement baseline.

   Each variant states its horizon in rows and keeps timeouts, session ends and unknowns as
   outcomes of their own, as the [turn label does](pivot-label-spec.md); none scans past a
   session end or reads rows without data coverage. A timeout is a class the model
   predicts. A session end is not, and it is removed by eligibility, never by outcome: a
   row is eligible only if its whole horizon fits before the session's last row, whatever
   happened after it. Dropping only the rows that ended at the close would keep the
   near-close rows that hit a barrier and bias the timeout rate. (The first benchmark
   dropped them by outcome, 118 to 310 rows per label; new targets do not.) A row whose
   follow-up has no data coverage is left out as unknown. Both are counted beside every
   result, and neither is filed under timeout.
4. **A model is trained and scored only where its target is defined.** *Turn* is defined at
   a candidate's decision row, *continue* at a pivot's confirmation row, and *direction* at
   any row. *Direction* is scored at every row; because adjacent rows share 59 of 60
   members, it trains on rows drawn about one window apart. *Turn* and *continue* train on
   every candidate or pivot, and a later row carries the latest such probability with its
   age, as it carries the latest completed minute. All are walk-forward with a purge
   ([model stages](feature-pipeline.md#model-stages)).
5. **A model stage is stored only if it beats the simplest model fitted on the same
   training fold**: displacement alone for *turn* and *continue*, and the fold's class
   frequencies for *direction*. Both predict every outcome class, timeouts included, so
   neither can gain from how unresolved rows are treated. The measure is out-of-fold log
   loss on the same rows, pooled over the products, with a 95% trade-date bootstrap
   interval of the difference above zero. The scale and label are named before the run.
6. **After-cost portfolio replay is the yardstick, not the first model.** The replay of
   would-be bracket trades for every candidate, compared in one portfolio against staying
   flat, taking every candidate, and the [displacement rule](#after-cost-replay), is built
   once and reused to judge each new layer ([replay rules](#after-cost-replay)). A learned policy counts as better
   only if its net dollars beat both rules, each difference paired on the same candidates
   with a 95% trade-date bootstrap interval above zero (whole dates are resampled, because
   outcomes overlap and the one-position replay is path-dependent), on neither product
   alone does it lose, and it stays positive under the latency and extra-tick stress.
7. **Sparse layers store events and decision rows, not every second.** Swing state was
   stored for all 70 million seconds per scale (64 GB for GC and SI), and almost none of it was
   read. Swings, structure, and model outputs are recomputed
   by the engine in minutes; store their events and the feature rows at decision and sample
   rows. Paul agreed on November 19 to drop the dense `pivot_1s` rows.
8. **Timeframes become a parameter, and a middle one is added.** Between a 5 basis point
   swing and a 40 basis point one there is nothing. A window such as `10m@10s` has a tenth of
   the `1m@1s` rows, moves that are large against the spread, and many more swings than the
   hourly one. It is `10m@10s` ([decision 11](#decisions-of-november-20-2026)).
9. **More history is the largest single lever.** One year gives about 2,000 confirmed hourly highs
   per product at 1 ATR and two months of holdout. Models that feed other models need
   several years, and the slow scales cannot be fitted without them. Five more years of GC
   and SI are coming ([decision 13](#decisions-of-november-20-2026)).

## Decisions of November 20, 2026

Paul's, after the review. The numbers continue the list above.

10. **The revised build order is approved**, with the structure in
    [how the analysis is structured](#how-the-analysis-is-structured).
11. **The middle timeframe is `10m@10s`.** The midpoint between a one-second and a
    one-minute step is 7.75 seconds. An 8-second step does not divide a minute: over six
    years of the GC and SI calendar, 549 of 1,553 sessions would open and close inside a
    row, which would then mix the seconds before a close with those after the reopen.
    Steps of 6 and 10 seconds never do, are equally near the midpoint (6 × 10 = 60), and
    nest in minute rows. Ten has the lower cost share.
12. **GC and SI are the proof of concept.** The files of PL, ES, YM, and RTY were removed
    from this machine on November 20; they and NQ return after Paul moves to a larger
    one. Everything is built for any number of products and pairs, and GC with SI
    exercises both. Disk space is not a design constraint.
13. **Five more years of GC and SI** will be downloaded after the move. Until then work
    continues on the one year held. Two rules for the new years:
    - *They are untouched, so they test what 2026 suggested.* Before anything else reads
      them, rerun `research replay` and `research benchmark` with their settings unchanged
      and record the result. Both read stored rows, so the years are ingested first, and
      both now refuse dates before 2026-01-02 (`benchmark.check_period`) and score
      walk-forward test blocks only in 2026 (`TEST_MONTHS` with the year 2026 written into
      `replay.py`, and an assert tying the last block to `DEV_END`). So a frozen evaluation
      period for the new years is added to that check before the run, and its test-block
      dates (months, year, and the end the assert checks) become a frozen setting too; none
      is changed after the run. Running them on the 2026 dates would test nothing new.
      Named in advance: taking every fast candidate at the slow bracket loses about
      one spread; entering against the `slow_atr_1` trend is worse than entering with it;
      displacement alone matches the full models on the turn label.
    - *Build them once.* Every change to base rows lands before they are ingested
      ([build order](#build-order), item 9).

    Afterwards they are development data, walked forward by year. September 1, 2026 onward
    stays the final holdout, and paper trading is the test after it.
14. **Intraday first.** Positions are flat before each close. Holding overnight, with a
    slower timeframe, comes after the intraday system is proven.
15. **Scheduled news is an input.** A table of release times known in advance (inflation,
    employment, central bank decisions) gives every row its time to the next release and
    since the last one. It is the one input that is not derived from MBP-1; results are
    also reported without the minutes around a release.
16. **The live contract is undecided** (full-size GC and SI, or the micros MGC and SIL).
    Every policy result is reported at full-size costs and again at micro costs, where
    commission is a larger share. The micro books are not in the data, so the second is a
    stress, not a simulation.
17. **A fourth target, *size***, joins the three of decision 3: the range of the next window
    against the current ATR. Its simplest model is the current ATR and the time of day
    ([why](#the-trade-the-system-looks-for)).
18. **The decision model takes or skips a trade that an event proposes**; it does not choose
    a direction at every row. Its target is the value of attempting the trade after costs.
19. **A daily loss cap:** $3,000 a session on the full-size contracts and $300 on the
    micros. An entry is taken only if its stop, added to the session's losses so far, stays
    inside the cap, and no entry follows once the cap is reached. Every portfolio replay
    applies it and reports how often it bound.
20. **No trade count is aimed for.** The system takes the setups that stand out against the
    rest of the history, whether that is none in a month or ten in a day. A policy is never
    tuned toward a number of trades.
21. **It runs unattended, inside the session.** Entries are allowed from the session's open
    until three hours before its close, and every position is flat at the close. This is the
    replay's eligibility rule already (the longest hold must fit).
22. **The purpose is to prove the method before any capital is committed.** Unusual ideas
    are welcome; each is still written down before it is run and recorded whatever it shows.
23. **No trade where the market cannot be trusted** (Paul left the rule to judgment). An
    entry is not eligible when the session's data is flagged, the book at the decision is
    missing, one-sided or flagged, or the spread is too large a share of the bracket's ATR
    (the limit is frozen in each spec). Such rows are left out of training, by eligibility
    at the decision row, and counted. The ATR that normalizes features is floored at the
    spread, as the swing threshold already is, so a market that has stopped moving cannot
    produce unbounded values; this changes stored values and lands before the six-year build.

24. **One set of stages for every timeframe** (Paul, November 20). `1m@1s` is built by the
    classes that build `10m@10s` and `1h@1m`; only the one-second rows themselves are made
    differently, from the trades. Nothing is kept twice for the sake of an option: the fast
    swings read the spread where the other scales do.
25. **The new machine has 4 TB** (Paul, November 20). Estimated from this year's sizes, a
    product-year takes about 73 GB of rows stored for every second (146 GB for GC and SI),
    two thirds of it the one-second window, statistics, and volatility tables:

    | Six years of | Files | Rows, every second | Rows, one-second values where read |
    | --- | ---: | ---: | ---: |
    | GC and SI | 0.16 TB | 0.9 TB | 0.4 TB |
    | GC, SI, ES, NQ | 0.75 TB | 1.8 TB | 0.8 TB |
    | All seven products | 0.9 TB | 3.1 TB | 1.4 TB |

    So every second is stored for GC and SI, and ES with NQ still fit beside them. Seven
    products, with their files and room to rebuild, do not. When that is wanted there are two remedies, neither built now: keep the
    download files on an external drive (they are read start to finish, only during a
    build), and store the one-second window, statistics, and volatility rows only where
    something reads them (every ten-second row's end, every decision and event row), as the
    fast swings are. `bar_1s` would stay complete, and the engine computes every second
    either way: storage is a saved copy for research, never what a backtest or a live
    session reads. The database itself belongs on the internal drive: a drive that
    disconnects under a running PostgreSQL can damage its tables.

## Decisions of November 23, 2026

Paul's, after the rebuild on the new machine and the middle replay.

26. **The new machine's build is the starting point.** Nothing is compared with the first
    machine's database any more; `~/fingerprint-new.txt` is the baseline for later rebuilds.
27. **Costs confirmed.** Micro commission is $1.25 a contract a side (the broker will be
    TradeStation), and an entry is ineligible when the spread is more than a quarter of the
    stop distance.
28. **Limit entries are preferred, and they are short.** Market entries pay too much spread.
    A limit entry lasts a few seconds, not the 2,400 s of the first middle replay. An order
    that short cannot rest at the candidate's extreme, which is away from the market at the
    decision, so its price is set from the book at the decision. The price rule and the
    wait are frozen in a spec before the next replay.

29. **No model predicts a reversal** (Paul, November 23). It is not possible to say with
    useful confidence that the current move is a reversal or a continuation, and a trained
    model in the middle of every timeframe is too much complexity for what it could add. The
    evidence here agrees: middle candidates at a quarter and at half of a 0.5 or 1 ATR
    threshold reversed 42% to 46% and 59% to 62% of the time, where a random walk with the
    same barriers gives 40% and 60% (fewer at 2 ATR, where many run out of time), and no
    model beat the distance already moved
    ([benchmark](build-log.md#pr-f-results-labels-and-benchmark)). Decisions 2 to 5 and 17,
    the model stages, the four targets, and the second structure pass on probabilities are
    withdrawn. There is one trained model, the decision model.
30. **Swings are an ATR zigzag at about 3 ATR**, confirmed when price has moved the
    threshold away from the extreme and never changed afterwards. The existing scales (0.5,
    1, and 2 ATR) stay, since they are built and cost nothing to keep; the model reads all of
    them.
31. **The confidence of an unconfirmed swing is arithmetic, not a model:** the pullback so
    far divided by the threshold (2 of 3 ATR: 67%; 2.5 of 3: 83%). This is the stored
    `progress`.
32. **Structure is a code computed from confirmed swings and the current price:** higher or
    lower highs and lows, and whether the current price has broken the last confirmed low
    or high. The decision model learns what each state is worth, with the other evidence.
33. **Two passes.** The first computes everything on price and flow. The second computes
    the same swings and structure on derived series (RSI, net flow, later others) and
    whether they agree with price. A disagreement is evidence against a trade, not a signal
    to take one; the decision model weighs it.

34. **The decision is a position: long, short, or flat** (Paul, November 23). Flat with no
    position does nothing. Flat with a position closes it and cancels its bracket orders.
    This replaces decision 18 (take or skip a trade that an event proposes).

## How results are judged on six years

Frozen November 20, 2026, before the older years arrive, so that no split is chosen after
seeing a result. It applies to every model and policy from the yardstick on.

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
- **What is reported**, for every policy: net dollars and drawdown in one portfolio under
  the daily loss cap, at base and stressed execution and at full-size and micro costs; the
  value of attempting with a 95% interval from resampled trade dates; all of it by year, by
  product, and for buys and sells apart; and the number of independent trade dates.
- **A policy counts** when its value of attempting is above zero on the untouched years with
  its interval, in at least four of the five years taken alone, for both products and both
  sides, and still above zero under stressed execution. One good year, product, or side
  is a lead, not a result.
- **Every variant is counted.** Each run is recorded with its spec before it starts
  (`research.*` tables, when [runs are stored](todo.md#also-open)); the count of variants
  tried on a period is reported beside any result chosen from them.

## Build order

Approved November 20, 2026, and revised the same day for the new machine. Items 1 to 6 are
done. Items 7 to 9 change base rows, so they come before the long history is ingested.

1. **After-cost replay** on the stored fast candidates: done November 19 (`research replay`,
   [settings and results](replay.md)). Taking every candidate loses about one spread at
   either bracket, and the displacement rule stays flat.
2. **Storage change** (decision 7): done November 19 (PR #89).
3. **Timeframe as a parameter** (decision 8): done November 20
   ([what was built](build-log.md#timeframe-as-a-parameter-november-20-2026)).
4. **The middle timeframe `10m@10s`**: done November 20
   ([what was built](build-log.md#the-middle-timeframe-10m10s-november-20-2026)).
5. **One set of stages for every timeframe** (decision 24): done November 20
   ([what was built](build-log.md#one-set-of-stages-for-every-timeframe-november-20-2026)).
   A stage of steps 3 to 5 is written once, against a timeframe's frame of in-memory values.
6. **Replay the middle timeframe's candidates**: done November 23
   (`research replay GC SI --timeframe mid`,
   [spec](replay.md#the-middle-timeframes-candidates-spec-frozen-november-23-2026-before-its-run)
   and [results](replay.md#results-for-the-middle-timeframe-november-23-2026)). Taken at the
   market a middle candidate loses about one spread; a limit resting at its extreme gets a
   better price and still loses; no agreement rule passed. The one pattern that repeated is
   that entering against the `slow_atr_1` trend is worse than entering with it, so the
   slow trend is an input the decision model must have, and the daily loss cap's effect on
   the product mix is a question for item 8.
**Proposed on November 23, 2026, after the [review](#review-of-november-23-2026); Paul has
not approved it yet.** The list before it had trained models in the middle of the pipeline
and is in the git history.

7. **The yardstick, part A: the forecast and the horizon map**
   ([spec](yardstick-spec.md)). The decision dataset, the label (what a long with a
   symmetric bracket earns, in R), a walk-forward model on the features that exist, and
   the table of what is predictable at 1, 5, 15, and 60 minutes from each kind of input.
   No engine change is needed. It will probably show no skill at the bracket's horizon.
   From here on, an input is judged by one question: does the model forecast better with
   it than without it, on the same rows?
8. **The engine makes position decisions.** A strategy names a position at each decision
   row (decision 34): the engine enters, leaves a position alone, or closes it and cancels
   its orders. Entries are market orders or limit orders that last seconds (decision 28),
   with the back-of-queue fill model beside the strict one. The bracket is sized by the
   timeframe the strategy names. A strategy can read a stored forecast, and the same
   forecast computed live must equal it (`research verify`). Then **part B** of the
   yardstick: the policy in one portfolio after costs, which replaces the candidate replay.
9. **Structure of price, as decided.** Mostly built: the swing stages are an ATR zigzag whose
   confirmed swings never change, with `progress`, `trend`, the class of the last high and
   low, and the age of each break. To add: a scale at 3 ATR on every timeframe (roughly 140
   confirmed highs a year a product on the slow timeframe and 900 on the middle one, scaled
   from the counts at 2 ATR), and one structure code per scale. It is the first input the yardstick
   judges.
10. **Base changes, in one rebuild.** A rolling net-flow series that does not reset at the
    session open; the ATR normalizer floored at the spread (decision 23); the `source.py`
    change in the [to-do list](todo.md#housekeeping).
11. **The second pass: swings and structure of RSI and of net flow**, on every timeframe,
    with the swing code that price uses and a threshold in each series' own units, frozen
    in a spec first. Then the agreement codes against price.
12. **Six years of GC and SI**, when the files are here, judged as
    [above](#how-results-are-judged-on-six-years). A build is a few hours, so it does not
    wait for the items after it; they rebuild what they change.
13. **The book between trades** (`book_1s`), judged at the one-minute horizon and by the
    quality of entries ([review, point 8](#review-of-november-23-2026)), and **the
    scheduled-news table** (decision 15).
14. **ES**, as the first product that does not move with the metals, with one-second values
    stored where they are read (decision 25).
15. **More inputs, each judged by the yardstick:** a session-long timeframe, structure
    across timeframes in one code, the [pair stage](pair-design.md), indicators of
    indicators last. And the variants the spec names: mirrored training rows, and labels
    from the best path in hindsight.
16. **The final evaluation** of the decision model on the holdout, once. Then paper trading
    on the live feed, and live trading after it.

### After-cost replay

Freeze the candidate at its first eligible decision close, with its extreme, side, and
latest completed slower-timeframe row. Freeze the bracket, costs, sizing, and eligibility
before reading outcomes.

- Replay a would-be entry for every candidate, including ones a policy skips, with the
  engine's arrival-time book and bracket exits. Hypothetical trades stay out of the
  portfolio ledger.
- The training outcome is R after fills and before commission: profit in ticks divided by
  the entry-to-stop distance (`r_multiple` in `execution.py`). Commission is a known dollar
  amount, subtracted after converting R to dollars; folding it into R would make its size
  depend on each candidate's risk.
- Two values are kept apart for every candidate, with a state that says which case it is:
  - the **trade result** (R, dollars): NULL unless a trade closed at prices the book showed.
    Win rate, average R, and every other trade statistic read only this;
  - the **value of attempting** the entry, the take-or-skip training target and what the
    portfolio comparison adds up: the trade result when a trade closed, zero when it is
    known that no trade happened, and NULL when the outcome is unknown. Unknown covers an
    entry that met no usable book, follow-up cut off by the end of the data, and an exit
    priced without a book.

  The simulator cancels a market entry in two cases (`Simulator.fill`), which `labels.py`
  reports together as `unfilled` today and the replay must separate. It arrived at or after
  the forced exit before the close: known, no trade (eligibility should exclude such
  candidates in the first place). Or it met no usable book (absent, one-sided, or flagged):
  unknown (`entry_no_book`), excluded from training and from the comparison. A limit entry
  the market never reached is a known non-trade. Report the count of each state beside
  every result, so zeros can never hide how many entries did not trade.
- An exit priced without a book (`no_book`) used a fallback price, not an executable one.
  The two uses of the replay treat it differently, because only one of them depends on
  the path:
  - as a training example it stands alone, so both of its values are NULL and it is left out;
  - in the portfolio replay the position was held and blocked other entries, so the trade
    stays in the ledger at the fallback price, flagged. Net dollars and drawdown are each
    reported twice, with the count and the dollars of the flagged trades beside them: at
    the fallback price, and with every flagged exit charged, on top of its fallback result,
    one further stop distance of its own bracket. A policy beats a rule only if it does so
    under both; no total leaves a held trade out.
- Fit on earlier folds only, purging training outcomes whose decision-to-exit interval
  overlaps the scored block; choose thresholds on the same training history.
- **The displacement rule** is a policy with one input. For each scored block, fit the
  value of attempting on displacement alone (a linear fit, one coefficient and an
  intercept) on the purged training folds, and take a candidate when its predicted value
  is above zero. Nothing is chosen by hand, and its side is the candidate's own.
- Replay each policy with the same capital, position limit, and cooldown. Report net
  dollars, drawdown, fills, and opportunities skipped while occupied, by month and product,
  and again with longer order latency and one more tick of adverse execution.

Log every variant, including unsuccessful ones, before examining the reserved period.
Repeated selection on the same history can make an ordinary strategy appear profitable.
[Bailey et al., *The Probability of Backtest Overfitting*](https://escholarship.org/uc/item/4w1110bb)

One control tests the value of the sliding clock itself. Run the same policy on completed
minute boundaries and again on every eligible second, with one portfolio and the same
risk limits. Report how many extra entries the faster clock enabled and what they earned
after costs. Adjacent one-minute windows share 59 seconds, so counting the extra rows alone
cannot establish that earlier action helped.

For the book inputs, freeze a short list of normalized inputs and their lookbacks before
extracting them. Gould and Bonart found queue imbalance predicted the next mid-price move
for ten Nasdaq stocks; whether that lasts through retail order arrival and a futures trade
held for minutes is an empirical question. [Gould and Bonart](https://arxiv.org/abs/1512.03492)

## After the build order

- **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the same
  engine; record each day and replay it as a backtest to confirm identical decisions.
- **Live trading**: a broker execution adapter with order reconciliation, risk limits,
  pause and resume, manual overrides, and a log of automated and human decisions.

What is finished is listed in the [to-do list](todo.md#done) and recorded in the
[build log](build-log.md).
