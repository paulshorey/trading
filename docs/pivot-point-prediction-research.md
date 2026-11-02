# Early swing prediction: research and experiment design

Reviewed 2026-11-02 against primary research, current package metadata, and this
repository's engine. **Proposal, not an implemented strategy or evidence of an edge.**
Here, pivot means a swing high/low, not daily floor-trader pivot levels.

## Recommendation

Keep the draft's main direction: **causal swing candidates, a regularized logistic
baseline, then one gradient-boosted tree model, evaluated through the existing
engine.** Predict a specified future outcome from information available now. Treat
earliness, missed opportunities, execution costs, and uncertainty as joint objectives.

The research supports refining this document rather than replacing it with a
competing architecture. It does **not** establish that early swings in GC/SI are
predictable enough to trade. Several original claims need correction:

| Original assumption                                                               | Finding and correction                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future-confirmed pivot used as a label necessarily leaks                        | Future outcomes are legitimate supervised targets. Leakage occurs when future confirmation enters inputs, candidate selection, preprocessing, or overlapping train/test labels. A centered pivot label can be valid; deploying its retrospective detector as a current signal cannot. |
| Reversal-versus-crossing classification directly validates early swing prediction | The closest ES study trades reactions on a return to an established level. Fresh-extreme prediction and level retests need separate experiments.                                                                                                                                      |
| Existing ML rows already implement the proposed pivot barriers                    | They simulate brackets anchored to the **entry fill**, not the extreme. Reuse them for executable trade outcomes; add a separate labeler if extreme-anchored outcomes are needed.                                                                                                     |
| No barrier hit by the horizon always means censored                               | A fully observed horizon with neither hit is an observed **timeout** for a finite-horizon target. Missing follow-up is unknown. Survival analysis can instead treat administrative expiry as right-censoring, but that is a different estimand.                                       |
| A pandas-based library necessarily violates the row rules                         | The issue is its indexing, causality, and state semantics, not its container type. Any adapter must preserve `slot_ordinal` and same-phase periods.                                                                                                                                   |

## What the evidence actually supports

**Closest futures precedent.** Sokolovsky and Arnaboldi use ES contracts from
2017–2019, extract established extrema, and classify reversal versus crossing when
price approaches them again. They test CatBoost and sequential contract splits.
Their revised paper reports only partial statistical support for the pattern and
does not support the proposed two-stage feature extraction improvement. Its
backtest omits bid/ask spreads. This motivates a falsifiable experiment; it is not
evidence of a transferable GC/SI edge. Pin the version: the original draft's title
belongs to v3; [v4 reframes the study around component evaluation](https://arxiv.org/html/2009.09993v4).

**Earlier recognition is a real research question.** Directional-change methods
separate an extreme from the later threshold crossing that confirms it.
[Tsang, Ma, and Chinthalapati (2024)](https://onlinelibrary.wiley.com/doi/full/10.1002/isaf.1552)
explicitly study recognizing that change before confirmation, using FX data.
This supports the formulation, not its profitability under this project's futures
data and execution assumptions. No rule or library can guarantee a future-defined
extreme at its occurrence; a model can estimate its probability.

**L1 information can be useful, within limits.**
[Gould and Bonart](https://arxiv.org/abs/1512.03492) find queue imbalance predictive
of the next mid-price move in Nasdaq stocks using logistic regression. That is a
different market, horizon, and observation process. Also, the order-flow imbalance
of [Cont, Kukanov, and Stoikov](https://arxiv.org/abs/1011.6402) includes limit-order
and cancellation events. TBBO supplies trades with the pre-trade best bid/ask,
not all book updates ([Databento schema](https://databento.com/docs/schemas/tbbo)).
Trade delta, sampled displayed imbalance, and complete-book OFI are different inputs.

**Early classification offers methods, not trading validation.**
[TEASER](https://link.springer.com/article/10.1007/s10618-020-00690-z) learns when a
partial series is sufficiently informative to classify. Its benchmarks establish
an accuracy/earliness trade-off, not an after-cost trading advantage. Borrow that
question before adding its machinery.

## Define the decision before choosing the algorithm

Keep three questions separate:

1. **Fresh extreme:** given a provisional high/low now, will a specified reversal
   happen before invalidation within the next few minutes?
2. **Level retest:** given a previously confirmed level and an approach to it now,
   will price reject or cross it? This is closer to the ES precedent.
3. **Trade selection:** given an allowed long/short signal now, will the engine's
   would-be trade be profitable after costs?

Start with fresh-extreme candidates and question 3 as the primary economic target.
Use question 1 as a diagnostic. Do not call a classifier of price geometry a
profitable-trade model. A secondary model filtering a rule's preassigned side is
meta-labeling; a model choosing the side itself is not that same setup
([López de Prado's definitions](https://www.quantresearch.org/Innovations.htm)).

Preserve the product design: `1h@1m` can **disqualify** a direction; `1m@1s` times
entries. A predicted high does not authorize a short when the bias forbids it. Test
whether pivot features improve allowed pullback entries or veto weak ones before
proposing a change to the strategy shape.

### Causal candidate specification

For the first experiment, use a **close-based directional-change swing proxy** on
each phase's completed candles. It is a reproducible baseline, not a claim to locate
the highest/lowest trade. Wick-based swings are a later variant requiring explicit
intrabar ordering from trades; OHLC alone cannot order a high and low.

- Maintain 60 independent phase states per window. At ordinal `o`, advance phase
  `o % 60` using its preceding observation at `o - 60`. Never run a conventional
  ZigZag/fractal over consecutive overlapping rolling candles. A two-right-candle
  confirmation on `1m@1s` needs 120 scheduled-open seconds, not two seconds. See
  [the project's phase rules](sliding-windows/README.md#indicators-run-on-one-phase-at-a-time).
- In an upward leg, retain its running close maximum `E` and the ATR `A > 0`
  available when that reference extreme is set; mirror for downward legs. Freeze
  `A` for that reference so thresholds do not drift merely because ATR changes.
- A strict new extreme creates a new reference version and resets its stage flags;
  ties retain the first ordinal. Emit each retracement stage once per reference.
  Candidate records are immutable even if a later observation invalidates them.
- Specify a fixed confirmation threshold to end a leg and reverse the state. Set
  bootstrap, minimum prior-leg size, and reset rules before generating examples;
  initialize only from past data. Do not seed with the first future-confirmed pivot.
- Start with stages `{0, 0.25, 0.5}` ATR and a `1.0` ATR confirmation-rule control.
  Stage 0 emits at every eligible new reference extreme and tests the opportunities
  excluded by waiting for a retracement. These are experiment settings, not fitted
  or established optimal values. Store actual retracement, which can overshoot a stage.

Keep `episode_id`, reference version, phase, extreme ordinal, candidate ordinal,
`decision_ns`, stage, and feature/data versions. IDs and raw reference prices are
audit metadata, not model inputs. Repeated stages share an episode; its ID must be
assigned causally, not from the final hindsight ZigZag. All phase outputs feed one
portfolio, with an explicit duplicate/cooldown policy.

A fast detector on **base one-second rows** could be a separate hypothesis. It
must be named and compared as such; it does not redefine a minute indicator's
previous period as the previous second. Detecting a rolling-window high that merely
ages out is also different from observing a new market reversal.

### Two outcome definitions, stored separately

**A. Executable trade outcome — primary.** Feed the candidate's allowed side into
[`iter_candidate_outcomes`](../lib/strategy-core/src/strategy_core/labels.py).
Use the existing simulator's next-observed pre-trade book, latency, entry-anchored
ATR bracket, commissions, forced exits, and actual fill ordering. Its bracket uses
the decision row's fast ATR, which can differ from the frozen reference ATR below.
Train an initial take/pass model on `net_pnl > 0` for resolved, filled trades;
preserve continuous net return/R multiple for evaluation. Time exits can win or
lose. Track unfilled, incomplete, and excluded candidates separately rather than
silently removing them.

This reuses execution, not a finished pivot-training pipeline. The current
[`Strategy.signals`](../lib/strategy-core/src/strategy_core/strategies.py) contract
is row-wise, so causal detector state belongs upstream in the shared feature/state
pipeline. Pivot features are not implemented. The engine's feature pipeline and
the stored-row builder also expose different feature sets today; their adapter and
parity need verification before training on stored metrics and replaying predictions.

**B. Extreme-anchored first passage — diagnostic, new labeler required.** For a
candidate high with reference `E`, frozen `A`, and decision price `P`, define:

```text
d = (E - P) / A
reversal barrier:     E - R*A
invalidation barrier: E + C*A
future scan: strictly after the candidate decision, on the same contract
```

Mirror the signs for a low. The diagnostic asks which barrier is first reached
within `H` scheduled-open slots. Freeze `R`, `C`, `H`, the reference, and their
versions at the decision. Record the resolution time and when it becomes available.
Process future trades with explicit timestamp/order rules; do not infer first-hit
order from a second's OHLC when both barriers fall inside it.

Require the candidate to lie inside the barriers and the reference event to remain
unresolved. If `d >= R`, the reversal target has already been reached; this cannot
be counted as successful prediction. For example, `R=1.5`, `C=0.25`, and `d=0.5`
leave **1.0 ATR** to the reversal barrier and **0.75 ATR** to invalidation before
costs. The original 1.5 ATR move is not the remaining trade reward. Gap jumps over
the target before a candidate is actionable are missed opportunities, not wins.

Keep `reversal`, `invalidation`, and fully observed `timeout` as separate outcomes.
Missing coverage or truncated follow-up is `unknown`, with the last observed time.
Do not drop timeouts and then present `P(reversal | one barrier hit)` as an
unconditional success probability. For the first diagnostic, require a full horizon
before the scheduled session end; keep excluded counts. Execution labels retain
the engine's time/session exits, which need not coincide with diagnostic expiry.

## Features and information limits

All features must declare [`Unit`](../lib/strategy-core/src/strategy_core/features.py)
and pass price- and size-scale invariance. Compute each contract's history
independently; pool examples across contracts, without contract IDs or price levels,
as decided in the [handoff](project/handoff.md#training-across-contracts-decided-november-2-2026).

| Feature family       | Concrete candidates                                                                                                                        | Guardrail                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swing geometry       | Retracement/ATR; prior-leg amplitude/ATR; elapsed scheduled slots expressed as open-market seconds; leg speed in ATR per fixed slot count  | Keep phase periods distinct from stream steps; raw ordinals and prices stay metadata.                                                                            |
| Flow versus movement | Sided delta / sided volume over the leg; change between non-overlapping leg segments; price response/ATR alongside aggressive-volume share | Raw CVD differences are not normalized. Divergence and “absorption” are hypotheses, not proof of hidden liquidity. Unknown-side volume needs a coverage feature. |
| Participation        | Log(volume / prior same-phase baseline); trade-count ratio; known-side fraction; normalized trade-size distribution                        | No raw sizes/counts as model inputs; never add the same volume across overlapping rolling candles.                                                               |
| Sampled book         | Spread in bps or ATR; bid/(bid+ask) displayed size; normalized weighted-midpoint displacement                                              | No raw L1 sizes. Carry `trade_age_s`, `book_age_s`, `depth_age_s`, validity, and coverage. No cancellations, queue position, or replenishment claims.            |
| Context              | Latest available `1h@1m` bias; ATR/price; sessions since roll; session-progress ratio                                                      | As-of join by availability. No outcomes, final session statistics, or future roll decisions.                                                                     |

Validate TBBO before deriving these. Distinguish scheduled quiet slots from missing
coverage. Stop/reset affected detector state after an information gap and require
explicit reinitialization; a quiet slot provides no new price/flow observation.
Warm-up rows are not training examples. Labels and positions never cross contracts
or sessions; phase histories may span scheduled closures under the calendar rules.

## Algorithms and libraries

| Option                                          | Decision                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small in-house directional-change state machine | First candidate generator: easier to enforce phase, availability, gap, checkpoint, and immutable-emission rules. A minimum-size leg and hysteresis are controls, not demonstrated edge.                                                                                                                                                                           |
| scikit-learn regularized logistic regression    | First learned model. Use training-only imputation/scaling and an empirical event-rate baseline. Start without class reweighting; any resampling changes the probability-calibration problem.                                                                                                                                                                      |
| LightGBM                                        | First nonlinear comparison, with a small fixed search budget. CatBoost or XGBoost are alternatives if a measured problem warrants them; the literature does not establish a winner here.                                                                                                                                                                          |
| Online CUSUM / FOCuS / BOCPD                    | Later feature ablation on normalized returns or flow. [FOCuS](https://jmlr.org/papers/v24/21-1230.html) detects mean changes; [BOCPD](https://arxiv.org/abs/0710.3742) estimates time since a change. A change may signal acceleration or volatility, not reversal. Neither output is automatically `P(pivot)`.                                                   |
| aeon TEASER / MiniRocket                        | Later sequence benchmark. [aeon's early-classification interface](https://www.aeon-toolkit.org/en/stable/examples/classification/early_classification.html) supports partial observations. Align episodes from a causal start and preserve missingness; do not crop them retrospectively around successful pivots. Compare the same information budget and folds. |
| Offline peak / ZigZag / change-point tools      | Useful for diagnostics or explicitly future-defined labels. [Stock Indicators warns that its final ZigZag leg repaints](https://python.stockindicators.dev/indicators/ZigZag/). Any prefix-based live adaptation requires its own causal-emission contract and tests.                                                                                             |
| DeepLOB / sequence nets / price forecasters     | Defer. [DeepLOB](https://arxiv.org/abs/1808.03668) models structured book sequences unavailable in full from TBBO. An L1 sequence model or path forecaster is possible, but needs a specific hypothesis and the same cost-aware baselines. Architecture alone does not solve labels or execution.                                                                 |

Package check on 2026-11-02: PyPI metadata lists scikit-learn **1.9.1**, LightGBM
**4.7.0**, CatBoost **1.2.10**, and XGBoost **3.4.1**, with CPython 3.13 or generic
Python 3 macOS ARM wheels. The draft's version claims check out. Wheel availability
is not a successful import/runtime check; LightGBM also documents its macOS OpenMP
requirements ([installation guide](https://lightgbm.readthedocs.io/en/stable/Installation-Guide.html)).
Sources: [scikit-learn](https://pypi.org/pypi/scikit-learn/json),
[LightGBM](https://pypi.org/pypi/lightgbm/json),
[CatBoost](https://pypi.org/pypi/catboost/json),
[XGBoost](https://pypi.org/pypi/xgboost/json).
None of these ML packages was installed or added to the repository for this review.

## Evaluation that can reject the idea

1. **Use calendar-time walk-forward blocks across all products/contracts.** An
   episode and its stages must not straddle fitting, calibration, or test sets.
   Purge training examples whose outcome is not available before the next block;
   retain full label intervals, including timeouts/unknown markers. Existing
   unfilled/censored marker rows lack a complete interval and need explicit endpoint
   metadata before splitting. Timestamp fields used for splitting are metadata.
2. **Handle dependence, not just ordering.** Adjacent phases can represent the
   same underlying move. Keep related stages together, use episode weighting as an
   ablation, and estimate uncertainty with contiguous session blocks rather than
   independent-row error bars. A sample-count `TimeSeriesSplit(gap=...)` does not
   implement variable-duration event purging; its equal-spacing assumption is also
   unsuitable for irregular candidate events ([official API](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)).
3. **Fit, then calibrate, then evaluate in time order.** Purge each boundary. Fit
   preprocessing and hyperparameters on earlier data; fit a calibrator on disjoint
   later development data, preserving its natural prevalence. Supply chronological
   splits explicitly: default `CalibratedClassifierCV` folds are not a financial
   validation policy ([calibration guide](https://scikit-learn.org/stable/modules/calibration.html)).
   Evaluate log loss/Brier score plus reliability plots; the scores mix calibration
   and discrimination and do not measure calibration alone.
4. **Make the gap policy explicit.** In strictly forward evaluation, purge labels
   at the training boundary and leave a predeclared temporal separation. A post-test
   embargo matters when a resampling scheme admits subsequent training observations;
   it does not replace purging. Legitimate test features can use already-known
   historical inputs; shared trailing history is not automatically future leakage.
5. **Select policy on development folds only.** Treat stages, detector thresholds,
   barriers, features, model settings, and take/pass cutoffs as one search budget.
   A final holdout is opened once after freezing the entire policy. Log unsuccessful
   trials: clean splits alone do not remove selection bias
   ([Bailey et al., backtest overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)).

Report three levels of results:

| Level                     | Required comparison                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate coverage        | Events and independent session blocks; missing/unfilled/unknown rates; successful reference swings missed by the generator; stage-0 versus retracement coverage. Candidate-conditional recall is not recall of all market pivots.                                                                              |
| Prediction and timeliness | PR-AUC against prevalence, precision/recall at fixed alert coverage, log loss, reliability; delay from the candidate's reference extreme and price distance/ATR. For hindsight pivot recall, predefine one-to-one event matching and tolerance; include failed and duplicate alerts, not only matched winners. |
| Trading policy            | Net expectancy/R, turnover, drawdown, exposure, and block uncertainty versus the unfiltered rule and no-trade control. Replay one portfolio; do not sum independent would-be trades. Break down GC/SI, side, phase, stage, session regime, and observation age.                                                |

Plot the precision/coverage/delay/cost frontier rather than picking the fastest
stage by accuracy. Choose the **earliest policy with credible net improvement on
development folds**, then test it once on newer data; retain “no supported edge”
as an acceptable result. A 0.5 probability threshold is not generally economic:
under a simplified two-outcome payoff, the break-even probability is
`(loss + cost) / (gain + loss)`. Timeouts, varying fills, and tail losses require
the actual conditional payoff distribution and portfolio replay.

Stress latency, stale-book eligibility, and an extra tick of adverse slippage on
each side. The [engine's TBBO limits](project/engine.md#data-limits-tbbo-only)
make sub-tick edge claims untestable here. Distinguish current simulator behavior
from the more conservative last-known/next-observed-book safeguard proposed there.

## Additional hypotheses, in priority order

These are proposed experiments, not sourced findings about GC/SI:

1. **Does the candidate rule already explain the apparent signal?** Compare an
   empirical stage/side event-rate baseline, rule-only entries, logistic regression,
   and GBDT on identical candidates. Add a simple eligible-row control to quantify
   what the pivot filter excludes. Microstructure must beat geometry-only features.
2. **Fresh extremes versus retests.** Train separate cohorts initially. Retests can
   use causal level age, prior completed touches, approach speed, and normalized
   distance. Do not label both tasks “early pivot prediction” and pool their scores.
3. **Exhaustion versus continuation.** Test whether unusually strong aggressive
   flow with weak normalized price response predicts rejection, continuation, or
   neither. Include the continuation alternative and spread/age controls; the
   visually appealing “absorption” explanation can be wrong.
4. **Act, wait, or skip.** Replay a fixed policy that observes successive stages and
   acts at most once per event. Compare with a single-stage policy before learning
   a stopping rule. Later, discrete-time competing-risk hazards could estimate both
   reversal and invalidation probabilities by horizon, retaining timeouts and
   incomplete follow-up ([competing-risks concepts](https://scikit-survival.readthedocs.io/en/stable/user_guide/competing-risks.html)).
   A competing invalidation is not independent censoring.
5. **Where does performance survive?** Ablate bias, book/flow, and phase effects;
   inspect liquidity/age and roll-age strata. Train pooled across contracts as
   planned; report GC/SI separately and use a later held-out-product comparison for
   transfer. One year is a feasibility sample, not proof across market cycles.

## First implementation milestone

1. Freeze the close-based detector's state transitions, confirmation threshold,
   bootstrap, reset rules, horizon, and duplicate policy. Establish data coverage
   and warm-up needs with the [ingestion plan](project/handoff.md#next-steps).
2. Add normalized candidate features and immutable event metadata in `strategy-core`.
   Verify prefix invariance, whole-session/one-second parity, checkpoint restart,
   phase/closure arithmetic, gaps, ties, new extremes, and scale invariance. Test
   stage overshoot, a target already reached, ambiguous intrabar paths, and expiry.
3. Generate executable labels with the existing simulator; add complete interval
   metadata. Add diagnostic extreme-barrier labels only if they answer a distinct
   analysis question. Keep both definitions and their versions visible in reports.
4. Run the rule/event-rate/logistic comparisons before installing a GBDT. Use a
   small predeclared development search and one final newest-data holdout. Publish
   coverage, calibrated prediction quality, delay, and stressed one-portfolio P&L,
   including failures to improve. Do not advance to paper trading on classification
   accuracy alone.
