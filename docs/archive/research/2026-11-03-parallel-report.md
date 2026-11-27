> Supporting provider-generated research, preserved from the completed Parallel task on November 3, 2026. Use the [reviewed findings](2026-11-03-reviewed-findings.md) for the engineering recommendation and the [handoff](../../project/pivot-detection-handoff.md) for the next task. The report is not evidence of measured GC/SI performance. Source provenance is in [research provenance](2026-11-03-provenance.json); access limitations are in [source-access notes](2026-11-03-source-access.md).

# Causal Futures Pivots Without Repainting or False Certainty

## Executive Summary

**Research date: 2026-11-03.** This report distinguishes **sourced findings**, **engineering recommendations**, and **unvalidated hypotheses**. It recommends indicators, not entries, exits, or profitability optimization.

- **Three Complementary Outputs**: Use multi-scale directional change for observed excursion, a signed-drift detector for trend evidence, and calibrated logistic/GBDT probabilities for unresolved candidates -> keep their meanings separate.
- **No Permanent Confirmation**: A finite price history cannot establish an unrestricted future maximum -> confirm a defined reversal, not that the high can never break.
- **Freeze The Barrier**: Volatility-normalized thresholds can shrink without price reversing -> freeze the scale while the candidate extreme remains unchanged.
- **Respect TBBO Limits**: TBBO supplies each trade with its immediately preceding BBO, not continuous book events -> distinguish trade delta from full order-flow imbalance. [8]
- **Nowcasting Is Not Foresight**: Tsang's 2024 method operates after a candidate extreme but before directional-change confirmation -> benchmark it as a nowcast, not pre-extreme prediction. [11]
- **Revised Evidence Matters**: Sokolovsky/Arnaboldi's latest listed revision is **v4, June 18, 2022**, and its proposed two-step extraction lacks supported improvement in the reported comparison -> do not inherit earlier profitability headlines. [5][23]
- **Benchmark Indicators Directly**: Compare event precision, coverage, false alarms, timing, and calibration at common operating points -> no P&L gate is needed.

## 1. Define A Temporary Event Before Choosing Its Detector

**Engineering recommendation.** Separate four claims:

| Output                 | Meaning                                                               | What it does not establish                |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Event definition       | A specified finite-path geometry and outcome                          | An algorithm's accuracy                   |
| Observed confirmation  | A reversal barrier has actually been crossed                          | Permanent survival of the extreme         |
| Conditional nowcast    | Probability an existing candidate completes/survives                  | That the candidate is already confirmed   |
| Pre-extreme prediction | A future extreme and reversal are forecast before that extreme occurs | The same task as candidate classification |

This separation prevents a fast candidate detector from being advertised as an equally fast certainty detector.

**Why certainty is impossible.** Two price paths can share every observation through now, then diverge: one never exceeds today's high; the other does immediately. No causal calculation distinguishes those continuations without assumptions. Conversely, "price fell R from this high" remains true if price later makes another high. Append a later breach; do not erase the earlier threshold event.

**Proposed label contract.** Use log price `x`, one contract and one explicit observation stream. For a high, define retrospective candidate plateaus using adjacent genuine observations: price rises into a maximal equal-price run and next moves lower. Record both plateau endpoints; use its **last genuine trade** as canonical extreme time `q`. Require:

- Incoming move: `x_q - min(x_u: q-W <= u < q) >= A`.
- Reversal: `T_R = first u > q with x_u <= x_q-R`.
- Invalidation: `T_I = first u > q with x_u > x_q+B`.
- Deadline: `q+H`, measured in scheduled-open rows, with wall time also recorded.

Freeze `A,R,B,W,H` and any normalization scale for that candidate. Specify `A,R>0`, `B>=0`, equality rules, and exact price-source semantics. `B=0` targets an exact high; `B>0` targets a **pivot zone**, allowing small overshoots, and must be named accordingly. Lows reverse the inequalities.

Label **completion** when `T_R < T_I` and `T_R <= q+H`; **invalidation** when the upper barrier wins; **timeout** when neither wins on a completely observed horizon; **unknown** when missing data prevent ordering or full observation. Separately label **survival**: whether the high/zone remains unbroken through the deadline, even after completion. These are different targets.

For example, a high can complete its specified reversal and subsequently invalidate its survival label. Neither outcome requires changing the recorded completion. Hindsight plateau labels are legitimate training outcomes, not live knowledge.

At forecast time `s`, check the entire observed path since `q`: a barrier already crossed cannot be forecast as still pending. Use only candidates still at risk; include time remaining to the deadline. Pre-extreme prediction needs a separate target, such as an extreme within a fixed lead window followed by completion within `H`.

Store `extreme_time`, `estimated_extreme_time`, `estimate_asof`, `first_confirmation_time`, and `available_at` separately. An inferred changepoint can precede its detection; its estimate is available only when emitted. **Decision: make this contract versioned and independent of detector internals.**

## 2. Make Multi-Scale Directional Change The Geometric Baseline

**Sourced finding.** Directional change (DC) distinguishes an extreme from its later threshold confirmation. Tsang's formulation normalizes retracement from the running extreme by the DC threshold; confirmation occurs when that retracement reaches the threshold. [11] Original author paper: https://onlinelibrary.wiley.com/doi/full/10.1002/isaf.1552

**Engineering recommendation.** Implement drawdown/drawup hysteresis, equivalently an explicitly specified online ZigZag. For an upward leg, maintain running high `e` and its time `q`; confirm a high when `e-x >= d`. Switch to searching for a low, symmetrically. The unconfirmed endpoint is provisional; confirmed endpoints and their emission records are immutable.

```text
on ordered price observation x:
    if seeking_high and x > e:
        e, q = x, observation_time
        d = max(floor_bps, c * lagged_volatility_scale)
    elif seeking_high and e - x >= d:
        append confirmed_high(q, e, d, available_at)
        switch_to_seeking_low(x)
    # symmetric low logic; fixed-bps mode uses constant d
```

Use `x=10,000*log(price)` for approximately bps-valued excursions, or an explicitly documented arithmetic-bps convention. Test **fixed-bps** and **causally normalized** thresholds. For volatility normalization, use lagged return dispersion or ATR from the correct independent candle phase; do not feed overlapping rolling candles into a conventional period ATR as independent bars.

Freeze `d` at leg initiation, or re-freeze only on a **strict new extreme** using the lagged scale. Never update it merely because time passes or volatility falls. Otherwise a motionless price can cross a shrinking barrier. The two freezing policies have different adaptation behavior; log which one applies. Equal-price ties do not refresh the scale.

Run several independently specified scales; emit scale identifiers rather than claiming one universal pivot. Fine scales resolve small turns but produce more events; coarse scales require larger observed retracements. That is a definitional tradeoff, not evidence of superior accuracy.

**Fixed-delay comparator.** A `k_left/k_right` extremum requires a peak relative to the specified left and right neighborhoods. It cannot be confirmed until the right neighborhood arrives. Delay is fixed in eligible observations, not necessarily wall-clock time. Plateaus require an explicit representative and a right-side exit rule; an unfinished plateau remains unresolved.

SciPy defines peaks through neighboring samples, returns the middle of flat peaks, and warns about NaNs. Its prominence algorithm searches both left and right; limiting `wlen` changes the measured prominence. Thus full-series prominence is not available at the original peak time. [12] [25] Documentation: https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html

A bounded-right-window implementation is causal **after that window closes**, with bounded-window prominence, not global prominence. Wavelet ridges, topological persistence, and scale-space agreement are useful retrospective or delayed reference constructions; they do not remove right-boundary dependence. Classical scale-space "causality" is also not synonymous with online availability; Lindeberg separately discusses time-causal constructions. [16]

**Decision:** use DC for adaptive-time excursion confirmation and local extrema for a transparent fixed-delay control, not as interchangeable definitions.

## 3. Add Signed-Drift Evidence, Not Generic Change Alarms

| Method                   | Mechanism and output                               | Causal timing / main failure                                  | Fit and evidence                 |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| DC / hysteresis          | Observed excursion from running extreme            | Waits for reversal magnitude; threshold-dependent             | First geometric baseline         |
| Left/right extrema       | Neighborhood ordering and bounded prominence       | Explicit right-window delay; plateau sensitivity              | Essential comparator             |
| CUSUM / GLR / FOCuS      | Evidence of changed return mean                    | Can detect weaker drift, not necessarily sign reversal        | Preferred second detector family |
| BOCPD / AR-BOCPD         | Posterior over run length and regimes              | Likelihood/hazard sensitivity; change need not be directional | Model-dependent challenger       |
| Local-linear filter      | Posterior level and slope                          | Noise/lag tradeoff; slope crossing can chatter                | Interpretable drift alternative  |
| Logistic / GBDT          | Conditional completion/survival probabilities      | Requires stable labels and calibration                        | Preferred third output layer     |
| TEASER / sequence models | Prefix classification or learned sequence features | Episode onset, data and transfer risks                        | Deferred challenger              |
| Retrospective methods    | Whole-path segmentation or multiscale extrema      | Future dependence unless explicitly delayed                   | Labels and diagnostics           |

These rankings concern **fit to this task**, not demonstrated GC/SI accuracy. Maintain different outputs rather than forcing every method to emit a supposedly identical pivot.

**Sourced finding.** FOCuS efficiently computes a generalized likelihood-ratio statistic for Gaussian mean changes, with known variance in its stated model; it supports known or unknown pre-change means. Functional pruning is computational machinery, not proof of universal statistical superiority. [10] Paper: http://jmlr.org/papers/volume24/21-1230/21-1230.pdf

**Proposed signed detector.** On lag-standardized returns `z_t`, accumulate downward evidence:

`C_t^- = max(0, C_(t-1)^- - z_t - kappa)`.

Require evidence that incoming drift was positive and subsequent drift is negative, with minimum directional magnitudes. A change from strongly positive to weakly positive is deceleration, not reversal; a variance jump or volume-distribution shift is not a high. Record estimated change time separately from alarm time.

Quickest-detection optimality is conditional. Classical formulations specify distributions, false-alarm constraints and delay criteria; CUSUM's Lorden optimality does not mean earliest accurate detection under arbitrary financial dynamics. Non-iid extensions exist, but require their own conditions. [21] Autocorrelation, volatility clustering, outliers and seasonal activity therefore require empirical threshold calibration, not borrowed iid guarantees.

BOCPD estimates run length under a hazard and within-segment likelihood. AR/GP extensions explicitly address temporal dependence absent from the basic iid segment model. [20] They may help distinguish correlated drift from noise, but a changepoint posterior still needs signed pre/post-drift interpretation.

A causal local-linear model supplies another interpretation:

`x_t = level_t + error_t`

`level_t = level_(t-1) + slope_(t-1)*Delta_t + noise_t`

`slope_t = slope_(t-1) + slope_noise_t`.

Use **filtered**, not full-sample smoothed, slope distributions; require persistent negative evidence after positive incoming slope. Statsmodels exposes Kalman filtering infrastructure. [3] **Unvalidated hypothesis:** AR-BOCPD or robust slope filtering may improve gradual-turn detection, while DC may be clearer for abrupt excursions. Test, rather than assume, that distinction.

## 4. Calibrate Candidate Risk Before Trying Larger Models

**Engineering recommendation.** Start with regularized logistic regression, then GBDT using the same candidate pool, horizon and features. Predict completion-before-invalidation, timeout, and survival separately; report the target and deadline with every probability. Include elapsed candidate age, incoming excursion, current drawdown, causal drift evidence and volatility regime before adding volume.

A discrete-time competing-risks model is useful when timing matters:

`h_j(u) = P(event type j at u | no earlier event, information at s)`

`F_j(H) = sum_u S(u-1)*h_j(u)`.

Completion and invalidation compete; timeout is the residual probability at the deadline. Invalidation is not innocuous censoring. Official scikit-survival documentation explains why treating a competing event as censored can bias cumulative incidence. [19] Unknown feed gaps are also not automatically independent censoring; report complete-case and gap-sensitivity results.

**Case study: Tsang's nowcast.** The 2024 Nowcast Constant Algorithm requires sufficient movement in the trend and partial retracement from its maximum. It aims to identify an extreme after it occurred but before DC confirmation; the paper calls the constant-parameter method a proof of concept. [11] Its mechanism is an earlier, conditional reversal call. Benchmark that against a lower-threshold DC alarm at matched false-alarm rates before attributing gains to a novel predictive mechanism.

**Case study: the revised extrema-classification paper.** The current listed arXiv 2009.09993 revision is titled _A Generic Methodology for the Statistically Uniform & Comparable Evaluation of Automated Trading Platform Components_. Its examples concern price levels and feature extraction; market-shift features are measured two ticks from a level. [5][23] That setup does not establish prediction of a fresh extreme before it occurs. Keep established-level approach/retest, bounce/penetration and fresh-extreme datasets distinct. The revised discussion reports no significant improvement for the tested two-step feature comparison, contradicting a simple "spectacular profitability proves predictive power" reading. [23] Full revision: https://arxiv.org/html/2009.09993v4

TEASER learns when a sequence prefix is sufficiently reliable to classify. [7] Adapting it requires a causal episode start and real decision to wait or emit, not episodes centered retrospectively on future extrema. Its official aeon implementation is available. [6]

**Hypotheses, not established advantages:** sequence encoders might capture nonlinear exhaustion; foundation-model embeddings might improve transfer across products. Chronos-2 is presented as a forecasting model, not evidence validating this pivot task. [26] Larger models belong after simple calibrated baselines, with pretraining contamination and event-target alignment examined explicitly.

## 5. Extract Honest Volume Features From Trade-Sampled L1

**Sourced boundary.** TBBO contains every trade and the BBO immediately before its effect; trade action is `T`, with side `B` for buyer aggression, `A` for seller aggression, and `N` unspecified. [8] Databento documents unspecified-side cases, undefined values and quality flags; event timestamps can retain source non-monotonicity. [9] Official schema: https://databento.com/docs/schemas/tbbo.md

**Engineering recommendation.** Exclude unknown aggression from signed volume, but retain total volume and publish signed-side coverage. Never silently turn `N` into sell, buy, or observed zero imbalance. Candidate features include:

| Feature                     | Scale-invariant construction                                   | Interpretation limit                                            |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Trade delta                 | `(buy_volume-sell_volume)/(buy_volume+sell_volume)`            | Executed aggression only; undefined without valid signed volume |
| Relative volume / intensity | Volume or trade count relative to lagged session-time baseline | Activity, not inherently direction                              |
| Sampled L1 imbalance        | `(bid_size-ask_size)/(bid_size+ask_size)` at trades            | Trade-conditioned sample, not time-average book state           |
| Spread / price response     | Spread in bps; price excursion relative to causal scale        | Endpoint price changes are not continuous midquote returns      |
| Exhaustion proxies          | Falling relative intensity or signed pressure near a candidate | Also consistent with inactivity                                 |
| Absorption proxies          | High aggression with little observed progress                  | Does not establish replenishment or hidden liquidity            |

Use trailing-only seasonal baselines and lagged normalization. Distinguish trade-weighted and volume-weighted quote samples; neither is time-weighted imbalance. Quote freshness after the latest trade is unknown without continuous quotes.

**Evidence and contradiction.** Cont, Kukanov and Stoikov study full order-book events, including limit orders and cancellations, and find order-flow imbalance more explanatory than trade volume in their equity setting. [2] Gould and Bonart find next-midprice directional information in queue imbalance, with materially different behavior across tick-size groups. [13] Neither establishes GC/SI temporary-pivot accuracy. Crucially, TBBO cannot reconstruct their full event flow: differences between successive trade-sampled queues mix trades, additions, cancellations and price-level changes.

A burst of buying with little price advance could reflect supply, but also sampling and contemporaneous dynamics. Even genuine absorption need not produce a downward reversal. **Decision:** treat these features as uncertain conditioning evidence and require price-only ablations, not an "absorption confirmed" label.

**Clock architecture.** Keep conventional candle indicators in their independent phase states. A separately named **base-second stream** consumes disjoint scheduled-open seconds; within each second, ordered trades can resolve DC/barrier crossings, published only at that second's release. Use base-second endpoints for drift/model features and identify the observation source in every output.

No-trade seconds carry age and zero activity, not a fresh price observation; missing seconds carry unknown data, not zero volume. Preserve timeout clocks but require genuine observations for geometric confirmation. OHLC alone cannot resolve intrabar barrier order; use ordered trades or mark ambiguity. Closures have no rows; record wall time separately and explicitly reset or suspend across closures/gaps. Never bridge contracts or roll discontinuities.

## 6. Run A Small Benchmark That Can Reject Added Complexity

**Engineering recommendation.** Use the same incremental engine for replay and live processing, the same ordering/release policy, and immutable append-only outputs. Late corrections become correction records, not rewritten historical availability. Log contract, stream/phase, scale, candidate ID, direction, all clocks, frozen thresholds, model version, probabilities and data-quality state.

The first experiment should compare DC, signed CUSUM/GLR and candidate logistic/GBDT models, retaining fixed-delay extrema as a control. Use a small preregistered grid of fixed-bps and normalized scales and fixed horizons, spanning GC/SI sessions, volatility conditions and delivery months. Select these from indicator-resolution requirements, not P&L. No benchmark scores are claimed here.

A decisive ablation sequence is **price only -> price plus volume/intensity -> plus valid aggression -> plus sampled L1**. Add complex regime or sequence models only if simpler methods leave a repeatable failure mode.

Match alarms to reference events **one-to-one**, separately by direction and scale, within preregistered time and price tolerances. Use deterministic matching that favors the earliest eligible alarm. Define bounded pre-extreme eligibility; report truly pre-extreme matches separately from post-extreme nowcasts. Duplicate alarms cannot create extra true positives: report them as duplicate burden, with raw and deduplicated precision. Unmatched reference events are misses.

Report event precision/recall, false alarms per valid scheduled-open hour and coverage of scheduled time, duplicates, missed reversals, and latency distributions in rows, wall time and adverse price distance from the extreme. Report observed-confirmation latency separately from estimated-extreme timing error. For probabilities report reliability plots, Brier score and log loss; proper scoring rules reward honest predictive distributions. [14]

Avoid circular truth: DC necessarily detects its own threshold crossings. That proves implementation consistency, not general pivot quality. Score against the independent incoming-move/deadline/invalidation/survival contract above, then repeat with bounded-window prominence labels and alternative reasonable definitions. Report sensitivity rather than selecting the friendliest label.

Split chronologically. Purge training outcomes extending into validation/test periods; group all versions of a candidate, overlapping horizons and scales into episodes. Fit normalization, feature selection, thresholds and calibration inside training folds; calibrate on later held-out data. Future outcomes are legitimate labels; future-centered features, completed-event selection and training on unresolved future labels are leakage. Scikit-learn's `TimeSeriesSplit(gap=...)` supplies a gap, not automatic episode-aware purging. [4]

Compare latency at common false-alarm budgets and precision/recall operating points, not each method's preferred threshold. Bootstrap whole sessions or dependent episode/session blocks, never individual overlapping rows. Include sparse trading, missing feeds, plateaus and overnight/session boundaries as explicit stress cases.

**Useful Python sources.** SciPy supports peak diagnostics; statsmodels supports filtering; scikit-learn supports logistic/GBDT and evaluation; aeon supplies TEASER; scikit-survival supplies competing-risk estimates. The documented Python `changepoint` package exposes `Bocpd` and `ArgpCpd`, with an explicitly listed **October 20, 2025** release. [24] This is availability evidence, not a quality endorsement. The cited FOCuS author repository is **R**, not Python. [22] `ruptures` explicitly targets offline segmentation. [18] Do not relabel those APIs as causal pivot detectors.

## Synthesis

The recommended three-part architecture separates **geometry**, **directional evidence**, and **conditional uncertainty**. DC answers how far price has reversed from an observed extreme; signed drift methods ask whether the return-generating tendency has changed direction; calibrated models ask whether an unresolved candidate will meet a finite outcome contract. Their mechanisms, outputs and failure modes are complementary, not interchangeable.

DC requires little distributional modeling but pays a price-distance delay. Fixed-right extrema pay an observation-count delay instead. Drift tests may recognize gradual changes earlier, but depend on noise modeling; BOCPD does not make a distribution change synonymous with reversal. FOCuS's Gaussian mean-change formulation and AR-BOCPD's dependence modeling expose that distinction. [10][20]

Retrospective `find_peaks`, wavelet/persistence constructions, centered smoothers, `ruptures`, and HMM smoothing belong in labels or diagnostics unless their right-hand dependence is explicitly delayed. Causal HMM filtering can provide regime features, but filtering a state is not predicting a pivot.

**Recommendation:** deploy multi-scale DC and one signed-drift detector first; add calibrated candidate probabilities as the third output. Keep fixed-delay extrema as a control. Volume and sampled L1 are plausible additions, not established improvements. Advance more complex models only after out-of-time event, latency and calibration evidence identifies where they help. The remaining uncertainty is empirical GC/SI performance under this exact event contract, not computational speed.

## References

1. _ADWIN - River_. https://riverml.xyz/latest/api/drift/ADWIN/
2. _Price Impact of Order Book Events | Journal of Financial Econometrics | Oxford Academic_. https://academic.oup.com/jfec/article/12/1/47/816163?login=false
3. _statsmodels.tsa.statespace.kalman_filter.KalmanFilter — statsmodels 0.15.0_. https://www.statsmodels.org/stable/generated/statsmodels.tsa.statespace.kalman_filter.KalmanFilter.html
4. _TimeSeriesSplit — scikit-learn 1.9.1 documentation_. https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
5. _A Generic Methodology for the Statistically Uniform & Comparable Evaluation of Automated Trading Platform Components_. https://arxiv.org/abs/2009.09993
6. _TEASER_. https://www.aeon-toolkit.org/en/stable/api_reference/auto_generated/aeon.classification.early_classification.TEASER.html
7. _TEASER: Early and Accurate Time Series Classification_. https://arxiv.org/pdf/1908.03405
8. _BBO on trade (TBBO)_. https://databento.com/docs/schemas/tbbo.md
9. _Common fields, enums, and types | Databento Docs_. https://databento.com/docs/conventions/common-fields-enums-types
10. _Fast Online Changepoint Detection via Functional Pruning CUSUM Statistics_. http://jmlr.org/papers/volume24/21-1230/21-1230.pdf
11. _Nowcasting directional change in high frequency FX markets_. https://eprints-gro.gold.ac.uk/id/eprint/37843/1/Intelligent%20Systems%20in%20Accounting%20%20Finance%20and%20Management%20-%202024%20-%20Tsang%20-%20Nowcasting%20directional%20change%20in%20high%20frequency.pdf
12. _find_peaks — SciPy v1.18.0 Manual_. https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.find_peaks.html
13. _Queue Imbalance as a One-Tick-Ahead Price Predictor in a Limit Order Book_. https://arxiv.org/pdf/1512.03492
14. _Strictly Proper Scoring Rules, Prediction, and Estimation_. https://www.stat.washington.edu/raftery/Research/PDF/Gneiting2007jasa.pdf
15. _Robust and Scalable Bayesian Online Changepoint Detection_. http://proceedings.mlr.press/v202/altamirano23a/altamirano23a.pdf
16. _Generalized axiomatic scale-space theory_. https://people.kth.se/~tony/papers/Lin13-AdvImgPhys.pdf
17. _Bayesian Online Changepoint Detection_. https://lips.cs.princeton.edu/pdfs/adams2007changepoint.pdf
18. _Welcome to ruptures - ruptures_. https://centre-borelli.github.io/ruptures-docs
19. _Analysis of Competing Risks #_. https://scikit-survival.readthedocs.io/en/stable/user_guide/competing-risks.html
20. _Gaussian Process Change Point Models_. https://mlg.eng.cam.ac.uk/pub/pdf/SaaTurRas10.pdf
21. _Quickest Change Detection_. https://arxiv.org/html/1210.5552
22. _GitHub - gtromano/FOCuS: Fast Online Changepoint Detection via Functional Pruning CUSUM statistics · GitHub_. https://github.com/gtromano/FOCuS
23. _A Generic Methodology for the Statistically Uniform & Comparable Evaluation of Automated Trading Platform Components_. https://arxiv.org/html/2009.09993v4
24. _changepoint · PyPI_. https://pypi.org/project/changepoint
25. _peak_prominences — SciPy v1.18.0 Manual_. https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.peak_prominences.html
26. _Chronos-2: From Univariate to Universal Forecasting_. https://arxiv.org/abs/2510.15821
