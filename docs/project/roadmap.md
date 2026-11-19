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
2. **Layers.** History is processed in passes, like floors of a building: each layer reads
   only the layers below it, and a layer is finished for a moment in time before anything
   above reads it. A value never uses information from after its own row.

Indicators that advance by one candle period read the previous window of the same phase.
The swing detector uses the sequence of released trades so it can tell which barrier was
hit first inside a candle. Fast and slow swing scales use their respective completed
ATR and publish state at second and minute closes. A second-level decision can read the
latest completed minute, including its age.

## The process and where it stands

Reviewed November 19, 2026 against the six steps in [AGENTS.md](../../AGENTS.md#the-process-required-order).

| Step | State | What is missing |
| --- | --- | --- |
| 1. Base rows | Built from trades (`bar_1s`, `bar_1m`) | The book between trades (`book_1s`): the data reaches the engine, no stage reads it |
| 2. Sliding windows | Built (`1m@1s`, `1h@1m`), with row counting and per-phase indicators | Each timeframe has its own stage modules; a third timeframe should be a parameter, not new code |
| 3. Indicators, then indicators of indicators | Indicators and volatility on price are built | Nothing is computed on an indicator: no RSI of RSI, no EMA of RSI, no trend of CVD |
| 4. Reversal and continuation probabilities | Swings, labels and a benchmark exist for price | No model is stored; only "will this early reversal complete" has a label; no swings of RSI or CVD |
| 5. Structure and divergence | Higher and lower highs and lows, trend, breaches (in the swing rows) | No divergence of any kind; no cross-timeframe agreement signal |
| 6. Decision model | An engine with fills at the book, would-be trade rows (`labels.py`), a losing rule-based baseline | No trained decision model; no policy comparison |

The foundation (steps 1 and 2, the stage graph, the engine, the checks that stored rows equal
live ones) is sound and stays. The work is in steps 3 to 6.

## The layers

Base rows and indicator stages use a scheduled grid per contract. Swing events and labels
are sparse. Prediction stages are proposed and will need a versioned model per forecast.

| Layer             | What it holds                                                                                                              | Examples                                                                                         | Stages                                                            | State                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------- |
| 0. Trades         | Exact per-second and per-minute statistics, updated with each trade                                                        | OHLCV by aggressor side, CVD and its extremes, sweeps, the price path, the book as trades saw it | `bar_1s`, `bar_1m`                                                | Done                                                |
| 0b. Book          | The same grid from every change to the best bid and ask                                                                    | Queue imbalance, order-flow imbalance, spread over time, depletion and refill                    | `book_1s`                                                         | Planned; the data is on disk and reaches the engine |
| 1. Indicators     | Rolling candles and what is computed from price and volume                                                                 | ATR family, RSI, EMA, MACD, ADX, realized volatility, session levels                             | `candle_1m_1s`, `candle_1h_1m`, `stats_1h_1m`, `vol_1s`, `vol_1m` | Done                                                |
| 2. Swings         | Turning points of the price path, sized by layer-1 volatility                                                              | Confirmed highs and lows at 0.5, 1, and 2 ATR; the open leg and its progress; breaches           | `pivot_1s`, `pivot_1m` (+ `pivot_event`); `pivot_rsi_*` planned   | Price implemented; RSI awaits disk and a research case              |
| 3. Reversal model | Probability of reaching the frozen reversal barrier within the candidate horizon | P(reversal) at the candidate decision row            | `pivot_label` (outcomes), then `model_reversal_*`                 | Labels and benchmark implemented; model deferred                         |
| 4. Structure      | Patterns across the latest reversals and the current one                                                                   | Higher lows, lower highs, breaks of structure, pullback quality, divergences                     | `signal_1s`, `signal_1m`                                          | Designed ([contract](pivot-structure-design.md))    |
| 5. Final model    | One model on every stored feature of layers 0–4, for one product and its partner                                           | Trade or no trade, direction, expected outcome after costs                                       | training pipeline, `ml.*` tables                                  | After layers 2–4                                    |

**Pairs.** Layers 0–4 are computed for each product alone. Pair stages then read two
products that move together at the same row (`GC` with `SI`, `ES` with `NQ`): relative
strength, spread and ratio moves, lead and lag, and each partner's layer-2 to layer-4
state ([pair design](pair-design.md)). The final model reads both.

Structure is computed twice: once from the deterministic swings, before any model, and
again with the model's probabilities ([decision 2](#design-decisions-november-19-2026)).

### Layers 3 and 4: predictions that later layers read

Layer 2 confirms a swing only after price has reversed by the full threshold, which is
late. Layer 3 would estimate, from the current candidate, three probabilities that sum to
one: the reversal barrier is reached first, the invalidation barrier is reached first, or
neither is reached within the horizon ([targets](#design-decisions-november-19-2026)).
Candidates whose outcome is a session end or unknown are not a fourth class: they are
left out of fitting and scoring, and counted. The confirmed swing retains its actual confirmation time. A later structure
model could use this forecast alongside the previous confirmed highs and lows.

A model's output is only a valid input for a later layer if the model could not have seen
the future of the row it scores. The rule (proposed November 15, 2026; details in the
[feature pipeline](feature-pipeline.md#model-stages)):

- A model stage is trained **walk-forward**. Its stored prediction for a session comes
  from a model fitted only on sessions that ended earlier, with a gap at least as long as
  the label horizon. The first sessions of the history have no prediction (NULL).
- Each stored prediction records the model that produced it. A retrained model adds a new
  version; nothing is overwritten in place.
- Layer 4 and the final model train only on rows that have these out-of-sample
  predictions, so they learn from predictions of the quality they will get live.

The proposed layer 4 can build on the deterministic layer-2 swings and
their provisional (not yet confirmed) relations, as the
[contract](pivot-structure-design.md#provisional-higher-lows-and-lower-highs-are-causal-candidate-features)
specifies. The model's probability then joins as one more input, and the benchmark decides
whether it improves on the rule.

## What the results so far do and do not show

The benchmark ([results](handoff.md#pr-f-results-labels-and-benchmark)) found that models on
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
`1h@1m` the same spread is a few percent of the range. The fast timeframe therefore times an
entry, and the slower one sets the bracket and the holding time.

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
   predicts. A session end or an unknown outcome is not: such a row is left out of fitting
   and scoring and counted beside every result, as the benchmark does today, and is never
   filed under timeout.
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
   stored for all 70 million seconds per scale (64 GB for GC and SI), which is why RSI swings,
   the book, and more products did not fit. Swings, structure, and model outputs are recomputed
   by the engine in minutes; store their events and the feature rows at decision and sample
   rows. Paul agreed on November 19 to drop the dense `pivot_1s` rows.
8. **Timeframes become a parameter, and a middle one is added.** Between a 5 basis point
   swing and a 40 basis point one there is nothing. A window such as `10m@10s` has a tenth of
   the `1m@1s` rows, moves that are large against the spread, and many more swings than the
   hourly one. Its exact size is chosen when it is built.
9. **More history is the largest single lever.** One year gives about 2,000 confirmed hourly highs
   per product at 1 ATR and two months of holdout. Models that feed other models need
   several years, and the slow scales cannot be fitted without them.

## Build order

1. **After-cost replay** on the stored fast candidates: gross and net R of take-all and the
   displacement rule, reported before any model with other inputs is fitted. `labels.py` already simulates
   would-be trades, but sizes the bracket with the `1m@1s` ATR and holds for at most three
   minutes (`strategies.Bracket`). The replay sizes the bracket with the ATR of the
   candidate's frozen slower-timeframe row and a holding time on that scale; the fast
   bracket is run beside it as a control.
2. **Storage change** (decision 7), which frees the disk for everything after it.
3. **Book inputs on the stored candidates.** Read the best bid and ask around each candidate
   from the DBN files, as a further input set of the benchmark; no table is needed. This
   comes early because it is cheap and it tells whether the permanent book stage (item 8)
   must exist before any model stage is stored.
4. **Indicators of indicators** (step 3): RSI and EMA of the RSI series, and RSI, EMA and
   slope of the window's net flow, per phase, as one new tier-1 stage per timeframe.
5. **Swings of RSI and of CVD** with the existing detector, which already measures additive
   series; thresholds above the measured row-to-row noise. CVD comes from a source that does
   not reset at the session open (a rolling net flow, not `session_cvd`), or the detector's
   state ends at each reset, so a reopen is never read as a move.
6. **Structure and divergence** (`signal_*`, tier 3): price against RSI pivots, price against
   flow pivots, higher-low and lower-high sequences, agreement across timeframes.
7. **The three targets and their benchmark** (decisions 3 to 5), first for price, then for
   RSI and CVD. Each new input set is tested through the benchmark and the replay.
8. **The book stage** (`book_1s`), if item 3 showed the book adds information, so that
   stored model stages are trained once with it.
9. **Stored model stages** for the targets and input sets that passed decision 5, then the
   second structure pass on their probabilities. On the one year held today, only the scales
   it can fit (decision 9) are stored; the slow scales, and any model that feeds another,
   wait for the history of item 10.
10. **More history** (decision 9), which unlocks the slow-scale and chained model stages
    deferred in item 9; then the middle timeframe (decision 8) and more products, as disk
    and budget allow.
11. **The decision model**, on out-of-fold inputs only, evaluated once on the holdout.

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

## Done

- uv-managed Python workspace with numpy, numba, Databento, and exchange calendars.
- One year of Databento MBP-1 for GC, SI, PL, ES, YM, and RTY, verified ([data](data.md)).
- DBN catalog with checksums, per-date contract resolution, volume-based front-month
  rolls, and per-session data-quality reports.
- Layers 0 and 1 as stages with their own versions, checkpoints, and derived warm-ups.
- Layer 2 for price: six swing scales, each a stage of its own, with their events.
- One engine for whole-session backtests and second-by-second rehearsals, verified
  identical; fills at the MBP-1 book the order meets, ATR brackets, one portfolio.
- Per-signal would-be-trade outcomes (ML rows) and a UI to inspect runs and trades.
- Local PostgreSQL 18 database `trading` with numbered migrations and a file registry.

## Next

1. Rebuild the stored rows from MBP-1 for GC and SI: done November 16
   ([results](handoff.md#rebuilt-from-mbp-1-november-16-2026)).
2. Swings of the price path (PR D): done November 16
   ([results](handoff.md#pr-d-results-swings)). Swings of RSI (`pivot_rsi_*`) reuse the same
   detector and wait for disk space ([handoff](handoff.md#open-questions)).
3. Outcome labels and the benchmark (PR F): done November 17
   ([results](handoff.md#pr-f-results-labels-and-benchmark)). The stored swings find turning
   points sooner than fixed extrema, slope sign, or CUSUM at a like false-alarm rate. Logistic
   regression and a boosted model on the stored features rank early candidates no better than
   the position of price alone (AUC about 0.60 for both), so no model is stored yet.
4. **Context inputs for the reversal model: tested November 17, no gain**
   ([results](handoff.md#context-input-results-november-17-2026)). Read with
   [its limits](#what-the-results-so-far-do-and-do-not-show).
5. **Steps 3 to 5 of the process**, in the [build order](#build-order): the after-cost
   replay, the storage change, book inputs on candidates, indicators of indicators, swings
   of RSI and CVD, structure and divergence, the targets and model stages, a middle timeframe.
6. **Decision model**: purged walk-forward training on pooled examples from front-contract
   sessions ([rules](handoff.md#training-across-contracts-decided-november-2-2026)); a
   final holdout of the newest data, evaluated once.
7. **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the
   same engine; record each day and replay it as a backtest to confirm identical decisions.
8. **Live trading**: a broker execution adapter with order reconciliation, risk limits,
   pause and resume, manual overrides, and a log of automated and human decisions.
