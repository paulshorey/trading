# Confirming pivots as early as possible: research update and implementation plan

Researched November 5, 2026 with the Parallel search API: four search batches (24 research
angles) and 33 full-text extractions ([provenance](2026-11-05-provenance.json)). This
extends the [reviewed findings of November 3](2026-11-03-reviewed-findings.md) and the
PR D–F plan ([plan, section 3](../../project/plan-1h-and-pivots.md#3-pivot-and-structure-design),
[pivot/structure contract](../../project/pivot-structure-design.md)). It changes no recorded
decision. Nothing here is implemented, and no detector or model has been measured on GC or SI.

The question: how to recognize a pivot high or low as soon as possible after it happens,
which method is the fastest and most reliable, whether a new AI model such as Google's
TimesFM helps, and how to combine methods. Compute and budget are not constraints.

## The answer in brief

1. **The earliest exact confirmation is the directional-change crossing itself**, at the
   scale that defines the pivot. Before the crossing, only a probability is possible. At the
   extreme, a reversal and a continuation share the same past, so no method can certify it
   on that row ([reviewed findings](2026-11-03-reviewed-findings.md)).
2. **That probability has a known baseline.** If price were a driftless random walk, a
   provisional high with price now a fraction `x` of the threshold below it would be
   confirmed before a new high with probability exactly `x`. When price sits at its
   largest reversal so far, `x` equals the contract's `progress`. A model is worth only its
   calibrated improvement over this baseline
   ([section 2](#2-two-random-walk-baselines-every-model-must-beat)). The earlier research
   proposed models without stating this baseline.
3. **The second baseline is the overshoot law.** For a random walk, the run beyond a
   confirmation before the next reversal is exponentially distributed with mean equal to the
   threshold. FX tick data fit it closely. Measuring it on GC and SI by scale and time of day,
   against the same detector replayed on random paths, shows where swings deviate from
   random on average. It is a sanity check before any ML; conditional departures can exist
   even where the average matches.
4. **Time-series foundation models are not the tool for this.** Independent 2025–2026
   studies on financial data find little or no gain over random-walk baselines. Pivot
   confirmation is a path event ("which barrier first"), which per-step quantile forecasts
   (TimesFM, Chronos-2) cannot express without extra assumptions. TimesFM 3.0's weights are
   licensed for non-commercial, non-production use. Foundation models stay as later
   challengers under a fixed protocol ([section 4](#4-foundation-models-current-state-and-verdict)).
5. **Combine methods in one calibrated model, not by voting.** The detector states at six
   scales, structure, local slope, a CUSUM statistic, order flow, and a leg-length hazard
   become inputs to one probability model. That model starts from the random-walk baseline
   (as an offset) and learns only the departure from it. A stopping rule turns the
   probability into an alarm at a chosen false-alarm rate.
6. **Smaller scales give the fastest exact evidence for larger ones.** A fast-scale
   confirmed low inside a slow-scale provisional higher low is the earliest exact event
   bearing on the slow pivot. The model learns how much it moves the slow-scale probability.
7. **Speed against reliability is a frontier, not a choice of algorithm.** Every method
   trades delay against false alarms. Measure the frontier, then choose a point on it.

## What this adds to the earlier research

The [November 2 proposal](../../pivot-point-prediction-research.md) remains history; the
November 3 review already corrected its leakage claim, trade-label reuse, timeout handling,
and profit gate. Its two-stage idea (causal candidates, then a classifier at several
retrace stages) survives in the contract and PR F. This update adds:

| Topic                      | Position on November 2–3                          | New evidence                                                                                                  | Change proposed                                       |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Baseline for probabilities | Logistic regression vs. one GBDT                  | Gambler's-ruin and drifted first-passage formulas; overshoot law                                              | Add the null and skill against it to PR F             |
| Foundation models          | "Not for this task"; no finance evaluations cited | Five independent 2025–2026 finance evaluations; proof that marginals cannot give path probabilities; licenses | Keep out of PRs D–F; fixed challenger protocol later  |
| When to alarm              | TEASER as a later experiment                      | Early classification in open time series (ECOTS); quickest detection; business-cycle dating                   | Stopping rule with a target false-alarm rate          |
| Combining                  | Keep outputs separate; not votes                  | Offset/boosting from a baseline; turning-point forecast combination                                           | One calibrated model plus one stopping rule           |
| Directional-change ML      | Tsang nowcasting                                  | Overshoot-distribution nowcasting; overshoot-existence classifiers                                            | Leg-extension hazard feature                          |
| Tabular models             | LightGBM                                          | TabPFN-2.5 strong up to 50k rows; calibration caveat; non-commercial weights                                  | Research-only challenger                              |
| Metrics                    | Event precision/recall, delay, calibration        | High ROC AUC with low average precision on rare extrema; base-rate traps                                      | Report prevalence, average precision, skill over null |

## 1. What "as soon as possible" can mean

Keep the contract's three times: the extreme's trade, the confirming trade, and the row at
which the output is available. Fix the pivot definition by scale: a candidate low `L` with
frozen threshold `θ` (log-bps), confirmed when price trades `θ` above it.

- **Exact recognition** happens at the first crossing. For this definition nothing can be
  earlier, and DC already achieves it on the trade path (PR D).
- **Early recognition** means a probability, published every row while the candidate is
  open: `P(confirm before invalidation | information now)`. It is useful as early as its
  calibration is good enough for the consumer.
- **Reliability** therefore means two measurable things: calibrated probabilities, and a
  controlled rate of false alarms per open hour for any alarm built on them.

A smaller threshold confirms sooner but defines a smaller pivot. It answers a different
question, not the same question faster. That is why the contract keeps six fixed scales.

## 2. Two random-walk baselines every model must beat

### 2.1 Probability of confirmation (gambler's ruin)

Measure distances in units of the candidate's frozen `θ`, as in the
[PR F label](../../project/plan-1h-and-pivots.md#35-labels-and-benchmark-pr-f): `R` is the
reversal barrier and `C` the invalidation buffer beyond the extreme `E`. The first-passage
formula needs where price is now, so let `x` be the reversal from `E` of the last trade
price at the decision row's close, ÷ `θ`. This is not the label's `progress` (`q`), which is
the _largest_ reversal since `E` and is what makes a candidate eligible at a stage. `q`
can overshoot its stage (eligible at 0.25 but already 0.40), and price can fall back
within the row (`q = 0.4` with `x = 0.1`), so `x ≤ q`. From the current price the reversal
barrier is `u = R − x` away and the invalidation barrier `d = x + C` away. For a driftless
continuous random walk, the probability of reaching the reversal barrier first is
([standard result](https://www.edgekit.pro/probstats/random-walks-and-brownian-motion)):

    P_null = d / (u + d) = (x + C) / (R + C)

- With `C = 0` and `R = 1`, `P_null = x`, which equals the contract's progress when price
  sits at its largest reversal.
- With `R = 1`, `C = 0.25` and no horizon: `x = 0.25` gives 0.40, `x = 0.5` gives 0.60,
  `x = 0.75` gives 0.80. Reversal is not a rare class, so raw accuracy says nothing.

This is the probability of _eventually_ reaching one barrier first. The PR F label adds a
horizon of `K` scheduled-open rows, with a timeout outcome when the whole horizon is
observed, so the baseline used for scoring must include it. Let `s` be the per-row
standard deviation in `θ` units, from the volatility tier as of the decision row. For
continuously monitored Brownian motion, the three outcome probabilities (reversal,
invalidation, timeout) depend on `u`, `d`, and `s·√K` only, and have a series solution. On a
discrete path they depend on `K` and `s` separately (one step of `s = 1` is not 100 steps of
`s = 0.1`), so a simulated baseline must take both. Call this `P_null,K`; the formula above
is its limit as `K` grows.

PR F keeps **session end** as its own outcome: the session closed before the horizon was
fully observed. Whether a candidate's `K` rows fit before the scheduled close is known at
the decision, so split candidates by it without changing any label. Candidates whose
horizon fits are scored on reversal, invalidation, and timeout against `P_null,K`. The rest
form a separate group whose third outcome is session end, scored against the null over
their known, shorter horizon and reported separately. Unknown outcomes (missing data) are
censored: exclude them from scores and report their count.

With drift `μ` per row in the reversal direction and variance `σ²` per row, let
`κ = 2μθ/σ²` (dimensionless). The first-passage probability becomes
([derivation](https://quantvault.org/problem-416-first-passage-probabilities-and-optimal-barriers-for-brownia.html)):

    P_drift = (1 − exp(κ·d)) / (exp(−κ·u) − exp(κ·d))      → d / (u + d) as κ → 0

Caveats, all measurable: trades are discrete and jump across barriers; bid/ask bounce
mimics mean reversion at the smallest scales (the 2-spread floor exists for this); and `μ`
is exactly what nobody knows. `P_drift` with a causal slope estimate is a feature, while
`P_null,K` is the baseline.

Optimal-stopping results say the same thing from the other side. For geometric Brownian
motion, the rule that sells closest to the ultimate maximum is set by the drift: sell at
once, hold to the horizon, or, for intermediate drift, sell when the ratio of the running
maximum to the price crosses a time-dependent boundary
([du Toit and Peskir, 2009](https://personalpages.manchester.ac.uk/staff/Goran.Peskir/stock.pdf)).
That last rule is a directional change with a time-varying threshold. Timing gains come
from knowing the drift, so any early-confirmation edge must come from conditional
departures from the random walk.

### 2.2 How far a confirmed swing runs (overshoot law)

For Brownian motion, the maximum reached before the first drawdown of size `θ` is
exponentially distributed ([Lehoczky, 1977](https://projecteuclid.org/journals/annals-of-probability/volume-5/issue-4/Formulas-for-Stopped-Diffusion-Processes-with-Stopping-Times-Based-on/10.1214/aop/1176995770.full)).
In directional-change terms, after a confirmation the leg runs on by an exponential amount
before the next `θ` reversal. Its mean is `θ` with no drift, and `θ·(e^κ − 1)/κ` with drift,
where `κ = 2μθ/σ²` now takes `μ` in the leg's direction. Glattfelder, Dupuis, and Olsen found this "overshoot
scaling law" across 13 FX rates: the mean overshoot grows almost exactly in proportion to
the threshold (fitted exponent about 1.04, coefficient about 1.06)
([scaling laws](https://arxiv.org/html/0809.1040); [exponential form](https://qffe2018.sciencesconf.org/197191/Agent_Based_Model_in_Intrinsic_Time_9_.pdf)).
Tsang's directional-change nowcasting uses the empirical distribution of whole trends to
call a reversal before confirmation. On EUR/USD ticks, half the trends ended before their
total move from the previous extreme reached 1.61 `θ`: the confirming `θ` plus a median
overshoot of 0.61 `θ`, where an exponential with mean `θ` gives 0.69 `θ`
([Tsang, 2024](https://onlinelibrary.wiley.com/doi/full/10.1002/isaf.1552)).

The diagnostic for GC and SI needs only PR D's stored rows and events: the ratio `ρ` = mean
overshoot ÷ `θ` and its survival curve, by product, scale, and session segment. It also
needs the empirical `P(confirm before a new extreme | x)` against `x`, where `x` is a row
close's displacement (section 2.1); each candidate keeps one frozen `θ` until it is
replaced, so that comparison is direct.

The overshoot comparison is not. The exponential law assumes one fixed threshold, but PR D
refreshes `θ` whenever a strict new extreme replaces the candidate, so a leg can pass
through several thresholds before it ends. Comparing it with `exp(−l/θ)` for one event's
`θ` can show departures even on a Brownian path. Use two references instead: a replay of
the same detector with `θ` held fixed per leg, and the exact adaptive detector replayed on
null paths, such as the session's real returns with randomized signs. That keeps the
volatility path while removing drift and autocorrelation. Measure departures against the
replay, not against the formula.

My reading of the outcomes (inference, to be tested):

- `ρ < 1` against the null replay: swings end sooner than random, so provisional pivots
  hold more often and early alarms pay.
- `ρ > 1`: swings trend, so early reversal calls fail more often.
- Deviations that shrink as `θ` grows relative to the spread are probably microstructure,
  not swing behavior.
- A match with the null is a marginal result only. Regimes or feature strata with opposite
  departures can average out, while structure, time of day, or flow still separates them.
  A flat diagnostic is a sanity check, not a reason to skip the conditional model.

Run these diagnostics only on blocks before the untouched holdout (September–October 2026),
since their results guide scale and model choices. Run them on the holdout only after the
configuration is locked.

## 3. Deciding when to raise the alarm

Early classification separates the estimate from the decision to act on it. In open,
unbounded streams the problem is called early classification in open time series (ECOTS):
a classifier gives a probability at each step, and a trigger chooses between acting now and
waiting, minimizing misclassification cost plus delay cost
([Achenchabe et al., 2023](https://proceedings.mlr.press/v189/achenchabe23a.html); survey
and library: [arXiv:2406.18332](https://arxiv.org/abs/2406.18332)). Quickest-detection
theory gives optimal triggers under a specified model
([user's guide](https://royalsocietypublishing.org/rsta/article/375/2100/20160298/115457/Detecting-changes-in-real-time-data-a-user-s-guide)).

Other fields solve the same problem the same way. A Bayesian sequential stopping rule dated
the last five US recessions with no false alarms, peaks on average 4 months and troughs 10
months sooner than the NBER announcements
([Monitoring recessions](https://pmc.ncbi.nlm.nih.gov/articles/PMC7944410)). That is monthly
data with five episodes, so it shows the mechanism, not a transferable speed. Radar tracking
detects target maneuvers with multiple-model filters and likelihood-ratio tests and states the
same delay-versus-false-alarm trade-off ([survey](https://arxiv.org/pdf/1503.07828)). A
practitioner simulation of hidden-Markov regime filtering makes the frontier concrete. A
0.3 posterior threshold detected regime changes in about 1.5 bars with about 20% false
positives; a 0.5 threshold took about 3 bars with about 6%
([Math and Markets, 2026](https://mathandmarkets.com/p/regime-detection-part-2-the-latency);
an illustration, not evidence for futures).

**Proposed rule.** Publish the calibrated probability on every row while a candidate is open;
this needs the per-row model of [PR G1b](#pr-g1b-per-row-probability). Raise an alarm at the
first row close where `P ≥ b(scale, stage)`. Choose `b` by replaying the complete alarm
process (first alarms, overlapping candidates, timeouts) on training blocks for a target
false-alarm rate per open hour, and report the whole frontier. With only the snapshot model
of PR G1, alarms can fire only at the stage crossings.

Adaptive conformal inference is not a substitute. It controls the long-run miscoverage of
online prediction sets once outcomes arrive
([Gibbs and Candès, 2024](https://jmlr.org/papers/v25/22-1218.html)), not first-alarm false
positives per open hour for overlapping candidates with delayed outcomes. Until an online
method with a matching target is found, recalibrate `b` on new blocks and monitor the
realized false-alarm rate.

## 4. Foundation models: current state and verdict

| Model                                                                                    | Released | Output                                                    | Weights license                                                                | Note                                                                            |
| ---------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [TimesFM 3.0](https://github.com/google-research/timesfm/blob/master/README.md) (Google) | Aug 2026 | 9 per-step quantiles; multivariate, covariates            | Non-commercial, non-production; commercial use only through Google Cloud       | Ranked first among foundation models on fev-bench, TIME, GIFT-Eval (its README) |
| TimesFM 2.5                                                                              | Sep 2025 | Univariate quantiles, covariates via XReg                 | Apache-2.0                                                                     |                                                                                 |
| [Chronos-2](https://huggingface.co/amazon/chronos-2) (Amazon)                            | Oct 2025 | 21 per-step quantiles; multivariate, covariates; 120M     | Apache-2.0                                                                     |                                                                                 |
| [Toto 2.0](https://www.datadoghq.com/blog/ai/toto-2) (Datadog)                           | May 2026 | Sampled trajectories                                      | Open weights (check the model card)                                            | 4M–2.5B parameters                                                              |
| Kronos                                                                                   | 2025     | Generative model of OHLCV candles                         | Open weights (license not checked)                                             | Finance-specific                                                                |
| [TradeFM](https://arxiv.org/html/2602.23784) (J.P. Morgan)                               | Feb 2026 | Generative trade-flow model, scale-invariant tokens, 524M | Paper                                                                          | Trained on more than 9,000 equities                                             |
| [TabPFN-2.5](https://arxiv.org/abs/2511.08667) (Prior Labs)                              | Nov 2025 | In-context tabular classifier                             | [Non-commercial, non-production](https://huggingface.co/Prior-Labs/tabpfn_2_5) | Up to 50k rows, 2k features                                                     |

**Evidence on financial data**, all independent of the model makers:

- Daily excess returns, global markets: off-the-shelf models were poor zero-shot and after
  fine-tuning; models pre-trained from scratch on financial data gave substantial gains
  ([Rahimikia, Ni, and Wang, 2025](https://wp.lancs.ac.uk/fofi2026/files/2026/03/FoFI-2026-020-Eghbal-Rahimikia.pdf)).
- Five US equities, TimesFM-2.5, Moirai-2.0, Chronos-2, TimeGPT, and trained-from-scratch
  networks: foundation models won 8 of 10 task rankings, but gains over the random walk
  were "small and sparse", significant in 2 of 10 tasks
  ([arXiv:2606.27100](https://arxiv.org/abs/2606.27100); abstract).
- A LoRA-tuned TimesFM's apparent 80% directional accuracy was the always-up base rate;
  measured honestly it had no directional skill
  ([arXiv:2607.12248](https://arxiv.org/abs/2607.12248v2)).
- Real-time daily macro and financial series since June 2025: foundation models beat
  benchmarks only in a few settings, and fine-tuning was worse than zero-shot
  ([Bank of England conference slides, 2026](https://www.bankofengland.co.uk/-/media/boe/files/events/2026/y-stucki-slides.pdf); search excerpts).
- Kronos forecasting next-day volatility for about 5,000 Chinese stocks: zero-shot error
  2.4–2.6 times that of a HAR-RV model; fine-tuning made it worse
  ([Finance Research Letters, 2026](https://www.sciencedirect.com/science/article/abs/pii/S1544612326011347); highlights and abstract).
- Not foundation models, but the same lesson: candle-based models of crypto extrema reached
  ROC AUC 0.87–0.90 yet average precision 0.12–0.13 at 2–3% prevalence, and their trading
  policies lost money ([arXiv:2607.19453](https://arxiv.org/abs/2607.19453)).

**Why the mismatch is structural:**

1. **Pivot confirmation is a path event.** "Which barrier first" depends on the joint path.
   TimesFM and Chronos-2 output per-step marginal quantiles, and marginals cannot determine
   first-passage probabilities without an added dependence model
   ([Perez-Diaz et al., 2025](https://arxiv.org/html/2510.19345v1)). Copula samplers
   ([Amazon, 2025](https://arxiv.org/html/2510.02224v1)) and trajectory models
   ([PathFM, 2026](https://arxiv.org/html/2610.22358)) add dependence; Toto samples paths.
2. **A realistic market model predicts the null.** TradeFM's rollouts reproduce the absence
   of return autocorrelation, as a good generative market model should. Such a model will
   assign first-passage probabilities near the random-walk values of section 2 (my
   inference). The edge lies in conditional departures, which a discriminative model aimed at
   the event finds more directly.
3. **Contamination.** Our data run from November 2025 to October 2026. Models released in
   that span may have seen public gold and silver prices from the test period during
   pre-training. Zero-shot results are out-of-sample only after a model's training cutoff.
4. **Embeddings for classification.** A 2026 benchmark on 33 UCR/UEA datasets ranked the best
   pre-trained model (MOMENT) about two ranks below MiniRocket; ROCKET features fed to
   TabPFN shared first place with HIVE-COTE 2 ([AIMultiple](https://aimultiple.com/time-series-classification);
   independent, not peer reviewed).

**Verdict:** confirm pivots with the deterministic detector and a calibrated tabular model.
Test foundation models later as challengers ([phase G2](#pr-g2-sequence-and-foundation-model-challengers)).
If a deep sequence model helps at all, the evidence favors pre-training on our own
multi-product trade data over generic models.

## 5. Methods and their roles

Rows already assessed in the [reviewed findings](2026-11-03-reviewed-findings.md) keep their
roles there; this table adds the new ones and places all of them in the plan.

| Method                                                                        | Earliest output                             | Role                                                                                                                                                                                                           | Where                 |
| ----------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Multi-scale directional change, frozen `θ`                                    | Exact confirmation of its own definition    | Event definition and state                                                                                                                                                                                     | PR D                  |
| Random-walk nulls (section 2)                                                 | Probability with nothing fitted             | Baseline and model offset                                                                                                                                                                                      | PR F0                 |
| Leg-extension hazard (empirical overshoot survival, as in Tsang's nowcasting) | Chance the running leg ends soon            | Feature                                                                                                                                                                                                        | PR F0 fit, PR G1 use  |
| Local-linear Kalman trend or rolling slope                                    | Estimated trend turn with uncertainty       | Evidence feature; benchmark detector                                                                                                                                                                           | PR F                  |
| Low-lag filters (Ehlers SuperSmoother); direct filter approach                | Smoothed turn with tunable timeliness       | Cheap baseline. Wildi and McElroy's accuracy–timeliness–smoothness trilemma explains why no filter avoids the trade-off ([IJF, 2019](https://www.sciencedirect.com/science/article/abs/pii/S0169207019300573)) | Optional in PR F      |
| CUSUM / FOCuS / GLR                                                           | Sequential evidence statistic               | One challenger; a zero-reference CUSUM equals a drawup                                                                                                                                                         | PR F                  |
| Fixed left/right extrema                                                      | Finite-window extreme                       | Delay benchmark only                                                                                                                                                                                           | PR F                  |
| Overshoot-existence classifier                                                | Whether a confirmed leg extends             | Related target; reported profitable on 10-minute FX, with thresholds chosen per dataset ([Adegboye and Kampouridis, 2021](https://www.sciencedirect.com/science/article/abs/pii/S0957417421000865))            | Optional PR G1 target |
| Logistic regression and LightGBM with the null as offset                      | Calibrated `P(confirm)` before the crossing | Probability layer                                                                                                                                                                                              | PR G1                 |
| TabPFN-2.5                                                                    | Same, fitted in context                     | Research-only challenger (license)                                                                                                                                                                             | PR G1                 |
| Hidden-Markov filtering, BOCPD                                                | Regime posterior                            | Later challengers                                                                                                                                                                                              | Later                 |
| MiniRocket / MultiRocket on normalized windows                                | Sequence-shape evidence                     | Sequence challenger                                                                                                                                                                                            | PR G2                 |
| Toto 2.0 trajectories                                                         | Monte Carlo first passage                   | Foundation-model challenger                                                                                                                                                                                    | PR G2                 |

## 6. Recommended architecture: one probability, one stopping rule

```
released trades
  L1  directional change at six scales (PR D): candidate, progress q, frozen θ, events
  L2  evidence per row (PR D/E, plus F0/G1 additions): structure, provisional HL/LH, breaches
      and reclaims, leg ratios, flow ratios, slope ÷ uncertainty, CUSUM, leg-extension
      hazard, cross-scale state, time-of-day volatility ratio
  L3  calibrated probability per open candidate and scale, from the close's displacement x:
        logit P = logit P_null,K(x, R, C, s, K) + f(L2 features)
  L4  alarm at the first row close with P ≥ b(scale, stage), b set by replaying the whole
      alarm process for a target false-alarm rate per open hour; recalibrated on new blocks
```

- **Offset, not a free fit.** `f` learns only departures from the random walk. With no
  signal, the model returns the null instead of fitting noise. For a three-outcome target
  (reversal, invalidation, timeout), the log null probability of each outcome is that
  class's offset. statsmodels GLMs take an `offset`. LightGBM takes an `init_score`, but only
  as training metadata: it is not saved in the booster or added by `predict()`. Give
  validation sets their own `init_score`, and at prediction add the row's offset to the raw
  score (`predict(..., raw_score=True)`) before the sigmoid or softmax. Test that stored and
  live predictions equal `sigmoid(offset + f)`.
- **Monotone constraints only on binary targets.** LightGBM's monotone constraints act on
  each class's raw score before the softmax, so they do not make a multiclass probability
  monotone ([upstream issue](https://github.com/lightgbm-org/LightGBM/issues/3912)). To
  constrain the reversal probability to rise with `x`, fit it as a binary target (reversal
  vs. not, offset by the null's reversal probability). Fit the three-outcome model without
  constraints and check monotonicity on held-out data.
- **One model, not votes.** The detectors share price data: a CUSUM resembles a drawup, and
  adjacent `1m@1s` candles share 59 of 60 seconds. Their agreement is not independent
  evidence. A fitted model weighs correlated inputs. Business-cycle work likewise combines
  turning-point models at the probability level, weighting them by past performance, and
  finds that each model's skill changes across phases of the cycle
  ([Billio et al., 2012](https://www.norges-bank.no/globalassets/upload/english/publications/working-papers/2012/wp_2012_04.pdf?v=09032017122151)).
- **Cross-scale evidence.** The slow-scale model sees fast-scale events as inputs: fast
  confirmations in the slow candidate's reversal direction since its extreme, fast trend, and
  provisional relations. These exact, early events are the natural precursors of a slow
  confirmation.
- **Snapshots first, then every row.** Start with PR F's snapshots at stages
  `q ∈ {0.25, 0.5}`: few rows, simple grouping, and a check that any edge exists. Publishing
  a probability on every row, and alarming at any row close, needs a per-row model: every
  row while `0 < q < 1`, with the same target and null from that row's close price and
  remaining horizon, fitted on
  candidate-row data grouped by candidate for splits and weighted so each candidate counts
  once. A snapshot probability carried between stages would be stale, so until the per-row
  model exists, the probability and alarm are defined only at the stage crossings.
- **Walk-forward predictions only.** Stored probabilities used as features downstream must
  come from models fitted on earlier blocks, labeled with the model and fold that produced
  them. In-sample predictions never become features.

Candidate inputs beyond the contract, all normalized and causal:

- `p_null`, and `p_drift` from the causal slope estimate (ratios).
- Leg-extension hazard: the current leg's run past its own confirmation, in `θ`, mapped
  through the overshoot survival curve fitted on training blocks for that scale and session
  segment.
- Slope ÷ standard error from the local-linear filter; the CUSUM statistic in `θ` units.
- Time-of-day volatility ratio: current ATR ÷ the stored time-of-day normal (the volatility
  tier has it).
- Distance to the session's high-volume prices, in ATR. This rests on the volume-level
  hypothesis behind support and resistance
  ([De Angelis and Peskir, 2016](https://personalpages.manchester.ac.uk/staff/goran.peskir/levels.pdf));
  it is theory, not evidence.

Order-flow inputs stay ablations, as the reviewed findings require. Recent evidence on trade
imbalance is mixed. Unconditional order imbalance no longer forecasts US equity returns
([Oxford, 2024](https://ora.ox.ac.uk/objects/uuid:b48ef174-c853-44b4-9ccf-04c200e300a4/files/rbk128c164)).
Filtering order flow did not consistently sharpen its link to short-horizon returns in
index futures ([arXiv:2507.22712](https://arxiv.org/abs/2507.22712)).

## 7. Evaluation additions to the PR F benchmark

- **Skill over the null:** Brier skill score `1 − Brier/Brier(P_null,K)` and the log-loss
  gain, over the three outcomes (reversal, invalidation, timeout), with the null from the
  decision close's displacement `x` and the horizon (section 2.1). Score candidates cut
  short by the session end as their own group. Exclude unknown outcomes and report how many.
  Add intervals from session-block resampling and reliability diagrams.
- **Base rates:** prevalence per stage, and average precision next to ROC AUC.
- **The overshoot diagnostic** of section 2.2, against null replays of the detector, on
  pre-holdout blocks only, before any model is fitted.
- **The frontier:** delay in open rows, false alarms per open hour, and lateness (the share
  of `θ` consumed at the alarm), compared at matched false-alarm rates.
- **Placebo:** inputs shifted in time, or permuted within sessions, must show no skill. It
  catches leakage cheaply.
- **Search budget:** about 250 sessions per product-year form the independent blocks. Fix
  how many configurations are compared before looking at test blocks.
- **Pre-trained models:** evaluate only on blocks after the model's training cutoff, and
  record the cutoff.

## 8. Implementation plan

The order of the [plan](../../project/plan-1h-and-pivots.md#6-decisions) stays: D
(structure), E (structure signals), F (labels and benchmark). This adds a small F0 and a
G track after F. Training follows the
[training-across-contracts decision](../../project/handoff.md#training-across-contracts-decided-november-2-2026):
one pooled model, examples within one contract, chronological tests.

### PR D: unchanged

Implement the contract. Later steps need only what it already stores: events with the
reference prices, the frozen `θ`, and ordinals; dense `progress` per row; and, for `x`, the
candidate's reference price with the row's last trade price.

### PR F0: random-walk nulls and the overshoot diagnostic

- `lib/strategy-core/src/strategy_core/pivot_null.py`: vectorized numpy functions in `θ`
  units, so scale-invariant by construction:
  - `first_passage_prob(u, d, kappa=0.0)`: `P_drift` with no horizon, with a series
    expansion near `κ = 0`;
  - `first_passage_probs_k(u, d, s, k, monitoring="continuous")`: the three outcome
    probabilities of `P_null,K`. Continuous monitoring uses the Brownian series, which
    depends only on `s·√k`; discrete monitoring simulates `k` steps of standard deviation
    `s` with a fixed seed;
  - `overshoot_mean(kappa)`: `(e^κ − 1)/κ`, equal to 1 at `κ = 0`.
- Tests: the `κ → 0` and `K → ∞` limits; the symmetry `P(u, d, κ) = 1 − P(d, u, −κ)`;
  agreement with a seeded Monte Carlo of a fine-step Gaussian walk; the three outcome
  probabilities summing to 1; discrete results converging to the continuous ones as `k`
  grows at fixed `s·√k`, and differing for small `k`; vector and scalar inputs.
- A diagnostic command in `apps/backtest-runner` over `market.pivot_event` and the dense
  pivot stages, restricted to blocks before the holdout. It reports `ρ` and overshoot
  survival against the fixed-`θ` replay and the null replay of the adaptive detector
  (section 2.2), and the empirical `P(confirm before a new extreme | x)` against `x`, by
  product, scale, and session segment, with session-block intervals. Output: JSON plus a
  markdown summary; charts later in research-web.
- Exit: a table of marginal departures from the null by scale and segment, as a sanity
  check. It does not decide whether G1 runs: a flat marginal result can hide conditional
  departures.

### PR F: labels and detector benchmark, as planned, plus

- The decision close's displacement `x` (from its last trade price) recorded on every label
  row next to its progress `q`, and `P_null,K` computed from `x`, the label's `R` and `C`,
  and the horizon, with `s` from the volatility tier as of the decision row: `K` rows when
  they fit before the scheduled session close, otherwise the rows left, in the separate
  session-end group (section 2.1). Labels and their outcome classes are unchanged. The null
  is computed, not stored.
- The slope detector: a local-linear Kalman recursion in numba, checked against statsmodels'
  local-linear model on fixtures; one CUSUM; SuperSmoother if cheap.
- The section 7 metrics next to those already specified.

### PR G1: calibrated probability layer

- Rows: PR F candidate snapshots joined to tier 2–3 features as of their decision row
  (`available_at <= decision_at`).
- Models, in order: `P_null,K` (nothing fitted); logistic regression with the null as
  offset; LightGBM with the null as `init_score` on training and validation sets and added
  back to the raw score at prediction (section 6), with a monotone constraint on `x` only
  in the binary reversal model;
  TabPFN-2.5 on subsamples of at most 50k rows, for research only.
- Splits: chronological calendar blocks across GC and SI, grouped by candidate and episode,
  purged by label intervals, with an embargo; the newest two months (September–October 2026) untouched until one configuration is chosen.
- Calibration on a later, disjoint training block; stopping-rule thresholds from section 3,
  which at this step fire only at stage crossings; walk-forward predictions stored as a
  stage (for example `pivot_prob_1s` and `pivot_prob_1m`) with model and fold IDs,
  available at row close.
- Exit: a log-loss gain over `P_null,K`, significant under session-block resampling for at
  least one scale on both GC and SI and stable across time blocks. Otherwise report the
  negative result and keep `P_null,K` and the deterministic fields as the indicator.

### PR G1b: per-row probability

Required before publishing a probability on every row or alarming at any row close. The
same models on per-row candidate data (section 6), each row scored from its own close
price and remaining horizon, followed by the stopping-rule thresholds refitted on the per-row process. If
G1 found no edge, the per-row output is `P_null,K` itself, which needs no fitted model.

### PR G2: sequence and foundation-model challengers

Only after G1 has a measured baseline. Every challenger uses the same candidates, splits,
and metrics:

- MiniRocket or MultiRocket features (aeon) on the last N normalized rows, then logistic
  regression: does raw sequence shape add anything to the engineered features?
- Toto 2.0 zero-shot: per candidate, a few hundred sampled paths of normalized returns over
  the label horizon, then the Monte Carlo first-passage probability, compared with `P_null`
  and G1. Optionally, Chronos-2 with a copula sampler. Holdout blocks after each model's
  training cutoff only.
- Go on to pre-training a model on our own seven products' trade data (scale-invariant tokens,
  as in TradeFM) only if a sequence challenger beats G1 significantly. Compute permitting, it
  is the one deep-learning route the evidence supports.

### Later: live integration

After G1b, the probability and alarm become engine features, recomputed at each row close
with a pinned model version, including its offset step. The engine's whole-session and
incremental runs must agree, as for every stage.

## 9. Risks and open questions

- **Microstructure at small scales.** Bid/ask bounce can make the fastest scale look
  mean-reverting. Check `ρ` against `θ` ÷ spread before trusting a small-scale edge.
- **One year of data.** About 250 sessions per product limit how much can be compared and
  how well regime changes can be seen. Pooling products helps only if behavior is shared,
  which the diagnostic tests.
- **Correlated candidates.** Stages of one candidate and neighboring scales are dependent;
  effective sample sizes are smaller than row counts.
- **Licenses.** TimesFM 3.0 and TabPFN-2.5 weights may not be used in production.
  TimesFM 2.5 and Chronos-2 are Apache-2.0; Prior Labs documents an Apache-based license with
  attribution for earlier TabPFN weights. Check before any live use.
- **Open:** whether a confirmed-pivot alarm should have one threshold per scale, or a
  threshold that also depends on progress and age (optimal-stopping boundaries generally
  do). G1 can test both.

## Sources and access

Main sources are linked inline. Their claims rest on different levels of access:

- **Full text read:** Rahimikia, Ni, and Wang (2025); arXiv:2607.12248; arXiv:2607.19453;
  Perez-Diaz et al. (2025); the copula-sampling and PathFM papers; Toto 2.0; TradeFM; the
  recession detection paper; ECOTS; the agent-based overshoot-law paper; Tsang (2024);
  Adegboye and Kampouridis (2021); De Angelis and Peskir; Billio et al. (2012); the TimesFM
  README and the Chronos-2 model card; the AIMultiple benchmark and the Math and Markets
  post.
- **Abstract only:** arXiv:2606.27100 (TSFMs on five equities); the early-classification
  survey (arXiv:2406.18332); TabPFN-2.5 (arXiv:2511.08667); Wildi and McElroy (2019); and
  the Annals of Operations Research high-frequency turning-point paper
  ([2025](https://link.springer.com/article/10.1007/s10479-025-06542-7); it claims rapid,
  low-error detection, unverified here).
- **Search excerpts only:** the Kronos volatility study (Finance Research Letters, 2026); the
  Bank of England slides; du Toit and Peskir (2009); Lehoczky (1977); Glattfelder et al.;
  Gibbs and Candès (2024); the order-imbalance studies; the Datadog Toto 2.0 blog and the
  TabPFN-2.5 license page; and the two first-passage derivation pages, whose formulas were
  checked by simulation instead.

The [provenance file](2026-11-05-provenance.json) lists every search, extracted URL, and
access limit.
