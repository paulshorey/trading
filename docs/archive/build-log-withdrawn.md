# Build log: the withdrawn reversal design

Historical. This is the record of the trained reversal-probability design that Paul withdrew
on November 23, 2026: the label stages, the detector benchmark, the reversal models, the
context-input and displacement experiments, and the replay of the candidates. Swings are
now computed by rule only, and no model predicts a reversal. The sections below are moved
intact from [the build log](../project/build-log.md); links in them to current documents
may point to headings that have since changed. Their specification is
[pivot-label-spec.md](pivot-label-spec.md) and the replay record is [replay.md](replay.md).

## The withdrawn design removed (November 23, 2026)

Paul withdrew the trained reversal model ([decision 29](roadmap.md#decisions)) and asked for
everything that served it to be removed. The last commit that has it is `df5a907`.

**Removed**

- The label stages (`stage_pivot_label.py`, `pivot_labels.py`: eighteen stages) and their
  tests. Migration `0010_remove_pivot_labels` drops `market.pivot_label_1s`, `_10s`, `_1m`,
  their views, and their registry rows.
- `benchmark.py` (the swing detectors against hindsight swings, and the reversal models) and
  `replay.py` (the candidate replay), with `research benchmark` and `research replay`. Their
  results stay recorded: [labels and benchmark](#pr-f-results-labels-and-benchmark), and the
  [record of the replays](../archive/replay.md). Their spec is
  [archived](../archive/pivot-label-spec.md).
- From the documents: the roadmap was cut to the plan in force, and the model-stage rules of
  the feature pipeline to one paragraph.

**Kept on purpose**

- `Simulator.rest` and `labels.attempt_limit` (a limit entry resting at a price): build-order
  item 7 needs them in the engine.
- `periods.py`: the development period, the test months, and the check that refuses the
  holdout, which every experiment must call.
- `swings.released`, which only the label stages called beside the swing stages: `swings.py`
  is part of every swing stage's identity, so it is not edited for tidiness.

**What changed in storage**

- The fast swing scales no longer keep a row at each label's decision row
  (`pipeline.STORED_ROWS` is `events+step_ends_10s:v4`), so the three `pivot_1s` stages were
  `stale` and were rebuilt: `research ingest run GC SI --rebuild --workers 8`, run 2, 5.5
  minutes, writing only `pivot_1s` and `pivot_event`. `pivot_1s` holds 25,699,173 rows
  (31,095,900 before); events are unchanged at 2,787,648. `ingest plan GC SI` reports all 12
  contracts `current`.
- Tests: strategy-core 132, backtest-runner 45 (the removed tests were those of the removed
  code); `ruff` passes.
- Nothing else changed: the 324 fingerprints of every table but `pivot_1s` equal the
  baseline's. The baseline was taken again (`~/fingerprint-new.txt`, 360 lines; the one
  before is `~/fingerprint-before-label-removal.txt`).


## Replay of the middle timeframe's candidates (November 23, 2026)

Build-order item 6: step 4's candidates judged by step 6's measure. The spec was committed
before any code read an outcome, and the result is in
[replay.md](../archive/replay.md#results-for-the-middle-timeframe-november-23-2026): no group passed.

**What was built**

- `replay.py` takes its settings from a `Spec`: the timeframe of the candidates, the label
  variants, the brackets, the entry orders, the cost models, and whether the trusted-market
  eligibility ([decision 23](roadmap.md#decisions)) and the daily loss cap
  ([decision 19](roadmap.md#decisions)) apply. `fast` is the replay of
  November 19 with nothing changed; `mid` is new (`--timeframe mid`). Another timeframe is
  another `Spec`.
- `Simulator.rest` and `labels.attempt_limit` (`strategy-core`): an entry as a limit order
  resting at a price until an expiry. It fills on arrival when the book is already at or
  through its price, else at its price when a trade prints through it. The engine's
  strategies still send market entries only; this is for would-be trades.
- `portfolio` applies the daily loss cap and counts the orders it refused and the sessions
  in which it bound. Results are also given at micro costs, for buys and sells apart, and as
  one portfolio in each half of the period for policies that fit nothing.
- `benchmark.py` has the middle stream (`STREAMS["mid"]`), so `research benchmark models`
  accepts the `mid_*` labels. No middle benchmark was run, and no detector task is defined
  for the middle scales.

**Checks**

- The fast replay rerun with the new code reproduces the tables of November 19 exactly
  (see below), so the refactor changed nothing it should not.
- Tests: strategy-core 158, backtest-runner 68; `ruff` passes. `execution.py` and `labels.py`
  are in no stage's identity: `ingest plan GC SI` still reports every contract `current`.

## PR F results (labels and benchmark)

Built and measured November 16–17. The parameters were frozen in
[pivot-label-spec.md](../archive/pivot-label-spec.md) before any label was computed. Evidence:
`~/ingest-gc-si-labels.*`.

**In plain words.** The swing detector confirms a high only after price has fallen the full
threshold from it. A label takes the same high earlier, when price has fallen a quarter or a
half of the way, and records what happened next: the reversal completed, or price went back
through the high. The benchmark then asks two questions: is the detector a good way to find
turning points, and can a model tell early which candidates will complete?

**Labels stored.** Twelve label variants (six scales × two stages, 25% and 50% of the
threshold) for GC and SI: 5,029,757 rows in `market.pivot_label_1s` and 197,721 in
`market.pivot_label_1m`, 1.3 GB with indexes, built in 3.5 minutes (`add`, 8 workers, 858
contract-sessions). Checks on the stored rows, all sessions
(`psql -d trading -f ~/ingest-gc-si-labels.validation.sql`):

- Every confirmed high or low of the detector (1,323,967 across the scales) is either a row
  resolved before decision or the extreme of an earlier candidate: 0 missing, 0 counted twice.
- Every reversal whose extreme was not broken first is the detector's own confirmation, trade
  for trade: 2,201,401 checked, 0 unmatched.
- Every label settles inside its own session; no key is duplicated; no bound is violated.
- Share of candidates that reverse: 40–49% at the 25% stage and 60–63% at the 50% stage
  for the 0.5 and 1 ATR scales; lower at 2 ATR (26–34% and 45–51%), where many time out.

**A. Detectors against hindsight turning points**
(`uv run research benchmark detectors GC SI`; development period 2026-01-02 to 08-31, 171
sessions per product, GC and SI pooled). A reference turning point is the highest (lowest) row
within 300 seconds, or 240 minutes, either side, with a move of at least 1 or 2 ATRs into and
out of it. Delay is in rows after the turning point; false alarms are per open hour.

| Task (reference move) | Detector | Coverage | Median delay | 90% delay | False alarms/h | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| Seconds, 1 ATR | **Swings 1 ATR** | 97% | 48 s | 136 s | 16.1 | 0.33 |
| | Swings 0.5 ATR | 97% | 16 s | 65 s | 56.4 | 0.12 |
| | Swings 2 ATR | 58% | 126 s | 246 s | 2.6 | 0.64 |
| | Extrema, 120 rows each side | 100% | 120 s | 120 s | 12.8 | 0.38 |
| | Slope sign, 300 rows | 96% | 166 s | 239 s | 5.0 | 0.60 |
| | Slope sign, 60 rows | 94% | 37 s | 51 s | 53.1 | 0.12 |
| | CUSUM | 3% | 5 s | 14 s | 6.1 | 0.04 |
| Seconds, 2 ATR | **Swings 2 ATR** | 95% | 124 s | 245 s | 3.2 | 0.56 |
| | Slope sign, 300 rows | 97% | 162 s | 227 s | 8.5 | 0.33 |
| | Extrema, 120 rows each side | 100% | 120 s | 120 s | 16.5 | 0.21 |
| Minutes, 1 ATR | **Swings 1 ATR** | 100% | 38 min | 122 min | 0.29 | 0.37 |
| | Extrema, 60 rows each side | 100% | 60 min | 60 min | 0.50 | 0.25 |
| | Slope sign, 120 rows | 97% | 66 min | 96 min | 0.36 | 0.31 |
| Minutes, 2 ATR | **Swings 2 ATR** | 99% | 96 min | 211 min | 0.05 | 0.48 |
| | Slope sign, 120 rows | 96% | 67 min | 94 min | 0.48 | 0.09 |

Reading: the stored swings are the best of the four on the trade between delay and false
alarms whenever the scale matches the move being looked for. At a like number of false alarms
they are known in under half the time of fixed extrema (48 s against 120 s), and at 2 ATR they
raise a third of the slope detector's false alarms with a shorter median delay. Fixed extrema
never miss but always wait their full window. The location error is 0 rows at the median and
the 90th percentile for swings, extrema, and slope: when they fire, they name the right row.
CUSUM as frozen finds 3–7% (its claimed row is a median 45–84 rows from the turning point); it
was not tuned. The full table per product and kind is in the command's JSON.

**B. Can a model tell early which candidates complete?**
(`uv run research benchmark models GC SI`; four test months, May to August 2026, each scored
by models trained only on earlier sessions; 138–147 stored features of the decision row.)
Candidates that were provisional higher lows or lower highs; "random walk" is the chance of
reaching the reversal barrier first from where price stands, with nothing fitted.

| Label | Rows scored | Reversal rate | AUC: random walk | AUC: logistic | AUC: boosted | Log-loss gain, boosted over random walk (95%) | Boosted over logistic (95%) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fast_atr_0p5_q25` | 227,097 | 0.505 | 0.618 | 0.618 | 0.618 | +0.016 (0.014, 0.018) | +0.0005 (0.0000, 0.0009) |
| `fast_atr_0p5_q50` | 150,047 | 0.632 | 0.604 | 0.604 | 0.605 | +0.038 (0.034, 0.041) | +0.0012 (0.0005, 0.0021) |
| `fast_atr_1_q25` | 108,697 | 0.471 | 0.597 | 0.594 | 0.588 | +0.002 (0.001, 0.003) | −0.0020 (−0.0027, −0.0014) |
| `fast_atr_1_q50` | 68,982 | 0.630 | 0.590 | 0.588 | 0.582 | +0.010 (0.008, 0.013) | −0.0023 (−0.0033, −0.0012) |
| `fast_atr_2_q25` | 40,708 | 0.334 | 0.586 | 0.595 | 0.583 | +0.025 (0.022, 0.029) | −0.0073 (−0.0089, −0.0059) |
| `fast_atr_2_q50` | 24,296 | 0.519 | 0.582 | 0.583 | 0.566 | +0.028 (0.024, 0.033) | −0.0124 (−0.0149, −0.0097) |
| `slow_atr_0p5_q25` | 10,526 | 0.434 | 0.606 | 0.578 | 0.559 | −0.049 (−0.056, −0.041) | −0.030 (−0.037, −0.023) |
| `slow_atr_0p5_q50` | 5,969 | 0.603 | 0.627 | 0.591 | 0.572 | −0.045 (−0.053, −0.036) | −0.019 (−0.028, −0.010) |
| `slow_atr_1_q25` | 3,202 | 0.396 | 0.567 | 0.530 | 0.534 | −0.052 (−0.068, −0.038) | +0.016 (−0.009, 0.045) |
| `slow_atr_1_q50` | 821 (4 of 8 folds) | 0.560 | 0.597 | 0.498 | 0.497 | −0.065 (−0.090, −0.042) | +0.026 (−0.005, 0.057) |
| `slow_atr_2_q25`, `_q50` | none | | | | | fewer than 500 training rows of a class in every fold | |

Reading, which is the finding of this PR:

1. **The models do not rank candidates better than the position of price alone.** AUC
   (0.5 is a coin, 1 is perfect) is about 0.60 for the random-walk number, which uses only how
   far price has already reversed, and about 0.60 for both models with every stored feature.
   The models' log-loss gain on the fast scales is real but small, and it is mostly calibration: the
   random-walk formula's probabilities are off in level, which a model corrects. On
   `fast_atr_1` the gain over simply predicting the average rate is 0.009–0.017.
2. **The boosted model is not better than logistic regression.** Equal within 0.002 on the
   two largest samples and worse elsewhere, as the samples shrink.
3. **The slow scales have too few candidates** (800 to 10,000 scored): both models are worse
   than the random-walk number there, and the 2 ATR slow scale could not be fitted at all.
4. All candidates, not only provisional ones, give the same picture (in the JSON).

Excluded and counted, per label (in the JSON): session ends (118–310), unknown outcomes (0),
rows with an `*_atr` input above 50 in absolute value (0–13), rows with another NULL input
(1–5,462), and three or four features NULL by design (`break_up_age_s`, `break_down_age_s`,
`sweep_delta_ratio`, `reversal_delta_ratio`). The extreme-ATR problem is rare on front
sessions, as expected. This pivot-model comparison ends August 31.

## Context input results (November 17, 2026)

`research benchmark context GC SI` asks whether inputs from outside a candidate's own row
help the reversal models. The sets, the population, and the success rule were written into
the [spec](../archive/pivot-label-spec.md#context-inputs-added-november-17-2026-before-any-run) before
any run. Evidence: `~/context-gc-si.a.json` and `~/context-gc-si.b.json` (and `.log`).

**In plain words.** A candidate is a high that price has started to fall from. Part B gave
the models only that second's own candle, volatility, and swing state. Here they also see
the larger and smaller swings, the last hour, and what the other metal is doing. If the
wider picture mattered, the models should rank candidates better. They do not.

Each set contains the one before it, and every set is fitted and scored on the same rows
(provisional candidates of the six fast labels, walk-forward folds May to August 2026):

| Label              | Scored rows | Boosted AUC: `base` | `scales` | `hour` | `pair` | Log-loss gain of `pair` over `base` (95%) |
| ------------------ | ----------: | ------------------: | -------: | -----: | -----: | ----------------------------------------- |
| `fast_atr_0p5_q25` |     219,394 |               0.617 |    0.617 |  0.617 |  0.618 | +0.0000 (−0.0003 to +0.0003)              |
| `fast_atr_0p5_q50` |     145,348 |               0.604 |    0.603 |  0.604 |  0.605 | +0.0004 (−0.0001 to +0.0009)              |
| `fast_atr_1_q25`   |     107,345 |               0.587 |    0.585 |  0.585 |  0.587 | −0.0001 (−0.0008 to +0.0007)              |
| `fast_atr_1_q50`   |      68,201 |               0.581 |    0.578 |  0.576 |  0.578 | −0.0008 (−0.0019 to +0.0004)              |
| `fast_atr_2_q25`   |      39,752 |               0.584 |    0.581 |  0.578 |  0.580 | −0.0016 (−0.0038 to +0.0005)              |
| `fast_atr_2_q50`   |      24,037 |               0.569 |    0.564 |  0.562 |  0.565 | −0.0021 (−0.0054 to +0.0011)              |

1. **The rule is not met.** On the two primary labels (`fast_atr_1_*`) no set gives the
   boosted model a log-loss gain with an interval above zero, and AUC falls by up to 0.005
   where the rule asked for a rise of 0.02. `scales` and `hour` are zero or negative on every
   label.
2. **Logistic regression gets worse with every added set,** on every label (gain of `pair`
   −0.0014 to −0.018, every interval below zero): the added inputs are noise to it.
3. **One small positive:** the partner product's inputs help the boosted model for SI on the
   two 0.5 ATR labels (+0.0006 and +0.0010, intervals just above zero, AUC up 0.002 to
   0.003). GC does not gain from SI. Too small to act on, and not on a primary label.
4. The random-walk number still matches or beats the boosted model on every label (AUC 0.58
   to 0.62).

Rows excluded and features dropped for NULLs are counted per label in the JSON (25 to 83
features dropped). The inputs
are not tuned after the result, as the spec says. This context comparison ends August 31.

**What this means.** Everything stored today describes trades and the path of price. Seen
from one second, from the hour, across swing sizes, or across the pair, it does not tell
which early reversals complete. Structure signals computed from the same swings (PR E's
sweeps, breaks, and reclaims are already among the `base` inputs) are unlikely to change
that, so a `signal_*` stage is not built. The untested information is the order book.

**Withdrawn November 19, 2026.** The last two sentences went further than the experiment:
it tested the swing rows as they are, not divergences, indicators of indicators, or pivots
of RSI and CVD, which did not exist. Structure and divergence are in the
[build order](roadmap.md#build-order)
([limits of this result](roadmap.md#what-the-results-so-far-do-and-do-not-show)).

## Displacement baseline (November 18, 2026)

`uv run research benchmark models GC SI --labels fast_atr_1_q25 fast_atr_1_q50`
reproduced the earlier row counts and full-model log losses. On provisional higher
lows and lower highs, fitting logistic regression to the distance price had already
reversed from the candidate extreme produced the following walk-forward log losses.
Lower is better. GC and SI share 87 scored trade dates across May–August.

| Candidate threshold | Scored rows | Displacement only | Logistic, 141 features | Boosted, 141 features |
| --- | ---: | ---: | ---: | ---: |
| 25% of the reversal threshold | 108,697 | 0.67475 | 0.67602 | 0.67804 |
| 50% of the reversal threshold | 68,982 | 0.64570 | 0.64755 | 0.64983 |

The ordering also holds within each product. At the 25% stage, the 95% trade-date
bootstrap interval for the boosted model's excess loss over displacement was
0.00266–0.00395. At 50% it was 0.00318–0.00500. At the 25% stage, 63,213 one-input
forecasts fell in the 40–50% band. Their mean forecast was 44.02% and 44.10% actually
reached the reversal barrier. This measures calibration for that event and population.

Use displacement as the comparator for the next forecast. A future test of incremental
book or indicator value should include that same displacement in both arms. For
profitability, use the separate [portfolio replay](roadmap.md#how-a-policy-is-evaluated).
The [audit specification](../archive/pivot-label-spec.md#probability-audit-november-18-2026)
records the development-data exposure and resampling rule. Local JSON reports are in
`data/runs/research/2026-11-18-displacement/`.

## PR F: labels and the benchmark

**Done (this PR).** `strategy_core/pivot_labels.py` holds the label kernel and
`stage_pivot_label.py` wraps it as twelve stages, one per scale and stage
(`pivot_label_1s:fast_atr_1_q25`, …), written to `market.pivot_label_1s` and
`market.pivot_label_1m` (migration `0007_pivot_labels`).
`backtest_runner/benchmark.py` is the benchmark; nothing it computes is stored.

What a later layer should know:

- **Labels are never inputs.** Label stages have `LABEL = True`; `pipeline.check_graph`
  refuses a stage that reads one, and the engine's features come from `FEATURE_STAGES`, which
  leaves them out. No label column has a unit, so none can be registered as a feature.
- **A label row is keyed to its decision row** (`slot_ordinal` and `end_ns` are the
  candidate's), and always lies inside that row's session. `available_ns` is the later time
  both outcomes were known: join features at the decision row, never at `available_ns`. A session can therefore be replaced alone, and one purged
  session covers every overlap in a split.
- **Outcome 0, "resolved before decision"**, is a confirmed pivot that never had a candidate
  at a row close. It is an observation, not a target; with it, every confirmed pivot is
  accounted for.
- **A new label definition is a new variant** (a new name, `add` in the plan), never an edit.
  Changing `pivot_labels.py` or `stage_pivot_label.py` rebuilds only the label tables (1.3 GB,
  minutes). They still list `swings.py` and the shared modules, so the rule for those is
  unchanged.
- **The benchmark refuses dates outside January 2 to August 31, 2026.** The holdout is for the
  final evaluation of a chosen model, once.

Decisions made in F (derived, reported in the PR): two tables by row resolution rather than
one; labels as stages on tier 9 so the planner, checkpoints, and rebuilds needed nothing new;
the horizon is 300 rows fast and 240 rows slow, with the survival deadline equal to it;
scikit-learn joins the dependencies (`HistGradientBoostingClassifier` is the boosted model);
the random-walk baseline ignores the horizon; a model needs 500 training rows of each class.
