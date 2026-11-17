# Pivot labels and benchmark: frozen specification (PR F)

Frozen November 16, 2026, before any label was computed and before the benchmark read any
outcome. It fixes the open parameters of
[plan section 3.5](plan-1h-and-pivots.md#35-labels-and-benchmark-pr-f). Changing a label
parameter means a new label variant with a new name, never an edit; changing a benchmark
rule means a new dated section here that says what changed and why.

## In plain words

The swing detector knows a high was a high only after price has fallen the full threshold
from it. A _candidate_ is the same high caught earlier, when price has fallen only a quarter
or a half of the threshold. The label records what happened next: did price finish the
reversal, or did it turn back and go through the high? It is the answer sheet a model is
graded against, and it is never an input.

## Labels

One label variant per swing scale and stage: `<scale>_q25` and `<scale>_q50` (twelve). Each
is a stage of its own, as the scales are. Fast scales write to `market.pivot_label_1s`
(rows are seconds), slow scales to `market.pivot_label_1m` (rows are minutes). The variant's
parameters in `market.variant.params` are the label ID.

| Parameter              | Value                              | Meaning                                                                  |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Stage `q`              | 0.25 and 0.5                       | Progress (largest reversal since the extreme ÷ θ) that makes a candidate |
| Reversal `R`           | 1.0                                | Reversal barrier, in θ from the extreme `E`: the confirmation itself     |
| Invalidation `C`       | 0.25                               | Invalidation barrier, in θ beyond `E`                                    |
| Horizon `K`            | 300 rows fast, 240 rows slow       | Scheduled-open seconds, or minutes, after the decision row               |
| Survival deadline `S`  | `K`                                | Rows `E` must stay unbroken                                              |
| Session                | The calendar's scheduled-open interval holding the decision row |                                             |

Rules, on top of section 3.5:

1. **Candidate.** At a row's close a scale in a leg (`state` 2) has one running extreme,
   identified by its segment, direction, level, and row. The first close at which that
   extreme's stored `progress` is at least `q` is its decision row for stage `q`; an extreme
   gets at most one candidate per stage. `θ` is the stored `theta_bps`, frozen with the extreme.
2. **First passage** reads every released trade after the decision row, in release order.
   For a high `E`: reversal when `10⁴ × ln(E / p) ≥ R × θ`, invalidation when
   `10⁴ × ln(p / E) ≥ C × θ`; lows mirror. Equality reaches a barrier. Outcomes: reversal (1),
   invalidation (2), timeout (3: rows `d + 1 … d + K` passed without either), session end
   (4: the session's last row came first), unknown (5: a row without data coverage, or a
   nonpositive price, came first). A candidate made at its session's last row is a session end.
3. **Survival** is separate: broken (2) by the first trade strictly beyond `E` within `S`
   rows, survived (1) after `S` rows without one, else session end (4) or unknown (5).
4. **Resolved before decision** (outcome 0). With `R = 1`, progress at a close can never
   reach `R`: the extreme would already be confirmed. So this class holds every confirmed
   high or low that never had a candidate of that stage at a row close (it went from below
   `q` to confirmed inside one row, or was confirmed while the direction was still unknown).
   It is stored at its confirmation row, as an observation and never a prediction target, so
   every confirmed pivot is either such a row or the extreme of a candidate.
5. **A label is independent of the detector after its decision row.** If price goes beyond
   `E` by less than `C × θ`, the detector moves its running extreme; the label keeps `E` and
   its `θ`.
6. **Stored with each label:** the decision row and its end, the extreme's row and level,
   `θ`, `progress` and `displacement` (the reversal of the last trade price from `E` at the
   close ÷ θ: where price is, not how far it got), whether the candidate was a provisional
   higher low or lower high, both outcomes with their rows and trade times, and
   `available_ns`, the time both outcomes were known. No column is a feature.

## Benchmark

Run by `research benchmark`; nothing in it is stored in the database.

**Data.** Front-contract sessions only, each within one contract. Development period: trade
dates 2026-01-02 (the first with every input stage warm) through 2026-08-31. **Holdout:
2026-09-01 onward, not read by this PR.** Sessions that are not warm for the scale are
excluded and counted.

### A. Detectors against hindsight reference swings

Reference swings are defined without any detector, in hindsight, per session, from the base
rows (`bar_1s` for the fast tasks, `bar_1m` for the slow ones). A row `i` holds a reference
high when its high is the highest of rows `i − W … i + W` (the first such row on ties), and
price rose to it and fell from it by at least `D`: `10⁴ × ln(high_i / lowest low)` over rows
`i − W … i` and over rows `i … i + W` are both at least `D`. Lows mirror. `D = m ×` the
window ATR in bps at row `i − 1` (`1m@1s` for fast, `1h@1m` for slow). A row is eligible when
the whole window lies in its session with no missing row and the ATR is defined.

| Task | Rows    | `W` | `m` |
| ---- | ------- | --- | --- |
| F1   | seconds | 300 | 1   |
| F2   | seconds | 300 | 2   |
| S1   | minutes | 240 | 1   |
| S2   | minutes | 240 | 2   |

Detectors, each giving alarms (kind, the row at which it is known, the row it claims as the
extreme). Fast detectors are scored on F1 and F2, slow ones on S1 and S2:

- **Directional change:** the three stored scales of the stream (`market.pivot_event`).
- **Fixed left/right extrema:** a row whose high is the strict first maximum of rows
  `i − n … i + n`, known at `i + n`; `n` = 30 and 120 rows (fast), 15 and 60 (slow).
- **Slope sign:** the least-squares slope of the close (carried through rows without
  trades) over the trailing `n` rows; a high when it turns from positive to negative, a low
  for the reverse, alternating; it claims the highest high (lowest low) of those `n` rows.
  `n` = 60 and 300 (fast), 30 and 120 (slow).
- **CUSUM:** two one-sided sums of one-row log returns of the close in ATRs of the previous
  row, with allowance 0.05 and threshold 1; a high when the downward sum reaches the
  threshold, claiming the row before that sum last left zero; both sums restart at an alarm.

Scoring, per task, product, and kind, then pooled: a reference swing at row `i` is _found_
by the earliest unused alarm of its kind known in rows `i … i + W` that claims a row within
5 rows (fast) or 2 rows (slow) of `i`. Reported: reference swings and alarms per open hour;
coverage (share found); delay in rows (median and 90th percentile, found swings); location
error in rows of the earliest alarm of the kind in `i … i + W` whether or not it found the
swing (median and 90th percentile); false alarms per eligible open hour (alarms that found
nothing); precision.

### B. Logistic regression against one gradient-boosted model

- **Rows:** candidates that were provisional higher lows or lower highs at their decision
  row (`prov = 1`), per scale and stage. Target: reversal (1) against invalidation or
  timeout (0). Session ends, unknowns, and rows resolved before decision are excluded and
  counted. All candidates (not only provisional ones) are reported as a secondary result.
- **Inputs:** the `feature` columns of the decision row's own tables: for fast scales
  `candle_1m_1s`, `vol_1s`, and the scale's `pivot_1s` row; for slow scales `candle_1h_1m`,
  `stats_1h_1m`, `vol_1m`, and the scale's `pivot_1m` row. Label columns are never inputs.
- **One population for both models:** features that are NULL on more than 1% of the first
  fold's training rows are dropped and listed (several are NULL by design, such as
  `break_up_age_s` while the level holds); a row with any other NULL is excluded and counted.
- **Extreme ATR multiples:** a row with any `*_atr` input above 50 in absolute value is
  excluded from training and scoring, and counted.
- **Models,** one configuration each, no search: logistic regression (inputs standardized
  on the training rows, L2 with `C = 1`), and scikit-learn's
  `HistGradientBoostingClassifier` (300 trees, learning rate 0.05, 31 leaves, at least 200
  rows per leaf, L2 1.0, seed 0). Separate models for highs and lows. At most 400,000
  training rows per model, drawn with seed 0.
- **Baselines with nothing fitted on features:** the random-walk probability of reaching
  the reversal barrier first, `(x + C) / (R + C)` with `x` the stored displacement (it
  ignores the horizon; the horizon-aware version of the
  [research note](../research/pivots/2026-11-05-early-confirmation-update.md) is not built),
  and the training rows' reversal rate.
- **Splits:** four walk-forward folds. Test blocks are the sessions of May, June, July, and
  August 2026; each is scored by models trained on development sessions before it, leaving
  out the last session before the block. A label ends with its session, so one session
  covers every overlap.
- **Reported** per scale and stage, pooled over folds and per product: rows, reversal rate,
  log loss, Brier score, ROC AUC, and average precision for each model and baseline; the
  log-loss gain over the random-walk baseline, and of the boosted model over logistic
  regression, with 95% intervals from resampling whole test sessions (1,000 resamples,
  seed 0).
