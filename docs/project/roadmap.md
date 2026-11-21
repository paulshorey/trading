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
      ([build order](#build-order), item 5).

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

## Build order

Approved November 20, 2026. Items 1 to 4 are done. Every step of the process is built, in
its order. Items 3 to 5 change base rows, so they come before the long history is ingested.

1. **After-cost replay** on the stored fast candidates: done November 19 (`research replay`,
   [settings and results](replay.md)). Taking every candidate loses about one spread at
   either bracket, and the displacement rule stays flat.
2. **Storage change** (decision 7): done November 19 (PR #89).
3. **Timeframe as a parameter** (decision 8): done November 20
   ([what was built](build-log.md#timeframe-as-a-parameter-november-20-2026)). One stage class
   per kind (step rows, window, window statistics, volatility, swings) is built for a
   timeframe `W@S`: a window of 60 rows of step `S`, whose step rows are merged exactly from
   `bar_1s`. `1h@1m` is its first instance and its stored rows did not change. `1m@1s`, whose
   rows come from the trades, keeps its own stage modules on the same calculations. A stage
   of steps 3 to 5 is written once, against a timeframe's frame of in-memory values.
4. **The middle timeframe `10m@10s`**: done November 20
   ([what was built](build-log.md#the-middle-timeframe-10m10s-november-20-2026)). One more instance: its base rows, window, indicators,
   volatility, swings, and labels for GC and SI.
5. **Complete the state before the long build.**
   - *The book between trades* (`book_1s`, merged to every step): queue imbalance,
     order-flow imbalance, spread over time, depletion and refill. Step 1 is not finished
     without it, and it is the only information in the files that nothing reads.
   - *A rolling net-flow series* that does not reset at the session open (not
     `session_cvd`) and is NULL while its window holds rows without data coverage.
   - *The scheduled-news table* and its two elapsed-time features (decision 15).
   - *The ATR normalizer in thin markets* and the `source.py` change in the
     [to-do list](todo.md#housekeeping), which also rebuild every row.
6. **Six years of GC and SI**, when the files arrive: the named checks on the untouched
   years first, then the build (decision 13). Items 7 and later start on the one year held
   and are rerun on six.
7. **The yardstick decision model.** Extend `research replay` from the fast candidates to
   the middle timeframe's, with the slow bracket, a market entry and a resting-limit entry,
   and the micro-cost stress (decision 16). Then train take-or-skip on the value of
   attempting, walk-forward and purged, on the features that exist. Store no model. It will
   probably not beat staying flat. Its purpose is that every later input is judged by one
   question: is the decision model better after costs with it than without it, on the same
   rows?
8. **The event families, through steps 3 to 5.** Each adds its indicators of indicators,
   its swings, and its structure, and is then replayed alone and inside the yardstick:
   - *the failed break*, from the breaches and reclaims the swing stages already emit;
   - *flow*: RSI, EMA and slope of net flow per phase, its swings with thresholds above the
     measured row-to-row noise, price against flow divergence (`signal_*`);
   - *RSI*: RSI and EMA of the RSI series, RSI swings, price against RSI divergence;
   - *sequences and agreement*: higher-low and lower-high runs, and the pullback that holds
     across the three timeframes;
   - *the partner*: the [pair stage](pair-design.md) for GC with SI.
9. **The four targets and their benchmark** (decisions 3 to 5): turn, continue, direction,
   and the size of the coming move, whose simplest model is the current ATR and the time
   of day. First for price, then for flow and RSI.
10. **Stored model stages** for the targets that passed decision 5 and that improve the
    yardstick model, then the second structure pass on their probabilities. A model that
    reads another model is stored only on the six-year history.
11. **More products** on the larger machine: ES with NQ, YM, RTY, PL.
12. **The decision model**, on out-of-fold inputs only, evaluated once on the holdout. Then
    paper trading on the live feed, and live trading after it.

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
