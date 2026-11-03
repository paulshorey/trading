# Early pivot (swing high/low) prediction: research notes

Researched 2026-11-02. Question: which Python algorithm or ML library should predict high/low
pivot points as early as possible from price/volume series, within this project's
constraints (TBBO-only data, `1m@1s` / `1h@1m` rolling rows, normalized features, purged
chronological splits, gradient-boosted trees with a logistic baseline on the roadmap).

## Recommendation

Do not train a model to say "this bar is the pivot" directly. A pivot is only defined
after later bars confirm it, so a pivot label taken at the extremum leaks the future.
No library removes the confirmation lag. What can be learned is how *probable* it is that a
**provisional** extreme will hold, and that probability can be estimated earlier than a
rule-based confirmation would fire. Structure it as two stages:

1. **Causal candidate generator (rule, no ML).** A non-repainting swing detector emits a
   candidate row each time a provisional extreme forms. Examples: the price retraces
   *r* ATR from the running high/low (ATR ZigZag), or *k* right-side rows fail to exceed it
   (fractal). Emit candidates at several retrace stages, such as 0.25, 0.5, and 1.0 ATR,
   so the classifier can act early with less evidence or later with more.
2. **Classifier on the candidate rows (ML).** Use **LightGBM** (or CatBoost) on normalized
   features, with **logistic regression** as the baseline, as `docs/project/roadmap.md`
   already plans. The label is **reversal vs. crossing**. A reversal means price moves ≥ R ATR
   away from the extreme before it exceeds the extreme by ≥ C ATR. A crossing means
   the extreme breaks first. If neither happens within the horizon, the row is censored.
   This is triple-barrier labeling around the candidate's level, and it is the setup
   Sokolovsky & Arnaboldi used on ES futures tick data.

This approach is **meta-labeling**. The candidate rule is the primary model that picks
the side, and the GBDT decides whether to take the trade. It fits the existing pipeline:
`strategy_core.labels.iter_candidate_outcomes` already turns each signal into the
outcome of a simulated would-be trade, with `decision_ns` and `exit_ns` kept for purged
splits. A pivot candidate is just another signal source, so it needs no new label
machinery. Only the candidate rule and pivot-specific features are new.

"As early as possible" then becomes an explicit operating-point choice. For each
retrace stage, report:

- the precision/recall of "holds", plus the **detection delay** in rows (`slot_ordinal`
  distance from the true extreme to the decision);
- the **lateness cost** in ATR (distance from the extreme to the decision price);
- the net P&L after costs of trading at that stage.

Pick the earliest stage whose after-cost results survive purged walk-forward evaluation.

## Options compared

| Approach | Role here | Why |
| --- | --- | --- |
| ATR ZigZag / fractal pivots, written in-house in `strategy-core` | **Candidate generator + training-label definition** | Needs only numpy. It must run on `slot_ordinal` rows like every other indicator, so a pandas-index library would break the sliding-window rules. Non-repainting variants emit a swing *k* rows (fractal) or one retrace (ZigZag) after the extreme. That lag is unavoidable ([market-structure-engine](https://github.com/kayasolomon/market-structure-engine), [Wickra ZigZag](https://docs.wickra.org/Indicators/Indicator-ZigZag), [ta4j Highs and Lows](https://github.com/ta4j/ta4j-wiki/blob/master/Highs-and-Lows.md)). |
| **LightGBM 4.7.0** / CatBoost 1.2.10 / XGBoost 3.4.1 | **Primary classifier** | Strong on engineered tabular features. Fast, with monotonic constraints and SHAP. All three ship Python 3.13 wheels (PyPI, checked 2026-11-02). Sokolovsky & Arnaboldi chose CatBoost for robustness to overfitting and stable tuning ([ES study](https://www.researchgate.net/publication/344334849_Machine_Learning_Classification_of_Price_Extrema_Based_on_Market_Microstructure_Features_A_Case_Study_of_SP500_E-mini_Futures)). |
| scikit-learn `LogisticRegression` + `CalibratedClassifierCV` | **Baseline + probability calibration** | Probabilities set the stage threshold, so calibrate them inside each training window. |
| Online change-point statistics: `changepoint-online` 1.2.1 (Focus, exact CUSUM in O(log n)), BOCPD | **Features, not the predictor** | Run-length posterior / CUSUM statistic on signed volume or returns show momentum exhaustion causally ([changepoint-online](https://pypi.org/project/changepoint-online), [BOCPD on order flow](https://www.tandfonline.com/doi/full/10.1080/14697688.2024.2337300), [gridcp, 2026](https://arxiv.org/abs/2608.18695)). `ruptures` is batch-only, so use it for research labels, never for live decisions. |
| aeon 1.6.0: TEASER early classifier, MiniRocket | **Optional experiment** | Early time-series classification (eTSC) formalizes the accuracy-vs-earliness trade-off ([aeon guide](https://www.aeon-toolkit.org/en/stable/examples/classification/early_classification.html), [TEASER](https://link.springer.com/article/10.1007/s10618-020-00690-z)). Worth a comparison on raw normalized windows once the GBDT baseline exists. Its harmonic-mean metric is a useful reporting idea even without the library. |
| DeepLOB / CNN-LSTM order-book models | **Not now** | They need multi-level depth snapshots, which TBBO does not provide (book seen only at trades, L1). Benchmarks suggest better inputs matter more than deeper nets, and accuracy does not reliably become after-cost profit ([Wang 2025](https://arxiv.org/abs/2506.05764), [LOBFrame](https://arxiv.org/abs/2403.09267), [DeepLOB reproduction](https://github.com/chirath-st/lob-deep-learning-trading)). |
| `scipy.signal.find_peaks`, `npzigzag`, `stock-indicators` ZigZag/Pivots | **Offline analysis only** | They look forward or repaint the last leg ([stock-indicators repaint warning](https://python.stockindicators.dev/indicators/ZigZag/)). Fine for charts and labels, never as features. |
| Price forecasters (ARIMA, TimesFM-style foundation models) | **Not for this task** | They regress the price path instead of classifying an event. The turning-point papers that use them are daily-bar studies with weak out-of-sample evidence. |

## Labeling and evaluation rules (leakage)

- A candidate's label resolves when a barrier is hit, so its interval is
  `[decision_ns, exit_ns]`. Purge training rows that overlap a test fold, and embargo
  after it ([AFML ch. 7 implementations](https://github.com/martex-dev/purged-cv),
  [CPCV](https://github.com/landtml/purgedcv)). Shuffled k-fold badly overstates results on
  overlapping labels (one replication: naive KFold AUC 0.561 vs. 0.518 purged,
  [finance-ml-evaluation](https://github.com/hosseinTabasi/finance-ml-evaluation)).
- Never feed a confirmed-pivot feature to a row before its confirmation row. Record each
  pivot's *extreme* ordinal and *confirmation* ordinal separately, as the non-repainting
  libraries above do.
- Candidates within one swing are strongly correlated (stages 0.25/0.5/1.0 of the same
  extreme). Group them by swing for splits and sample weighting.
- Sample events, not every row (a CUSUM filter or the candidate rule itself), so the
  classes are not swamped by "no pivot" rows ([AFML notes](https://reasonabledeviations.com/notes/adv_fin_ml)).
- Tune the barrier sizes R/C on training data only. Picking the best of many barrier
  configurations on test data makes them part of the hyperparameter search
  ([triple-barrier pitfalls](https://www.quantt.co.uk/resources/triple-barrier-method)).

## Candidate features (all normalized, TBBO-derivable)

Distance from the provisional extreme in ATR. Rows since the extreme (in phase-aware
rows). Retrace depth vs. the prior leg (ratio). Leg length and speed in ATR per row. CVD
change over the leg vs. the price change (divergence). Aggressor imbalance near the
extreme (absorption: heavy one-sided volume without new extremes). Spread and displayed
L1 size at trades. Volume relative to a trailing average (log ratio). Online CUSUM /
BOCPD run-length statistics. `1h@1m` bias state. The roadmap already lists swing points
and divergences as pending metrics, so this work can share them.

## Evidence quality and open questions

- **Sourced:** non-repainting detection always lags by its confirmation rule. Purged CV is
  needed for overlapping labels. GBDTs are the common, competitive choice on engineered
  microstructure features. eTSC methods explicitly trade accuracy against earliness.
- **Caution:** the most relevant prior study (Sokolovsky & Arnaboldi, US futures,
  extremum reversal vs. crossing) found its pattern **only partially supported**, with
  insignificant effect sizes for reversal targets of 7/11/15 ticks
  ([arXiv:2009.09993](https://arxiv.org/abs/2009.09993); also
  [arXiv:2103.12419](https://arxiv.org/abs/2103.12419) on volume-profile targets).
  Expect a modest edge that depends on the candidate filter and costs.
- **Inference, not sourced:** emitting candidates at several retrace stages and choosing
  the earliest profitable stage is my synthesis of meta-labeling and eTSC. Test it
  against a single-stage design.
- **Open:** which instrument and horizon carry the signal (GC vs. SI; `1m@1s` swings vs.
  `1h@1m`). Whether pivot candidates should replace or gate the existing strategy
  signals. Whether TEASER/MiniRocket adds anything over a GBDT on the same windows.

## Suggested first experiment

1. Add a causal ATR-ZigZag candidate rule to `strategy-core` (per-phase, `slot_ordinal`
   rows), with a scale-invariance test.
2. Generate candidates at retrace stages {0.25, 0.5, 1.0} ATR and outcome rows through
   `iter_candidate_outcomes`.
3. Fit logistic regression, then LightGBM, with purged walk-forward splits grouped by swing.
   Report precision/recall, detection delay, lateness cost, and after-cost P&L per stage.
4. Keep the final holdout untouched until one configuration is chosen.
