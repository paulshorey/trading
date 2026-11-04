# Pivot and market-structure contract

Proposed November 3, 2026, following the review of PR #66. This defines the next
implementation; it is not implemented or benchmarked. Read the
[agent handoff](pivot-detection-handoff.md) and [research](../research/pivots/2026-11-03-reviewed-findings.md).
The [stage/minute/pivot plan](plan-1h-and-pivots.md#3-pivot-and-structure-design)
governs the observations (the trade path), thresholds and their inputs, segments, price
domain, ages, storage, and labels. This contract governs structure semantics: classes,
trend, provisional relations, breaches, and their field names. Where both cover a point,
they must agree; an _epoch_ here is a plan _segment_.

## One chronological swing history per contract, stream, and scale

| Family | Detector observations                           | Threshold normalizer                | Initial multipliers |
| ------ | ----------------------------------------------- | ----------------------------------- | ------------------- |
| Fast   | Released trades; state published per second row | Available same-contract `1m@1s` ATR | 0.5, 1, 2           |
| Slow   | Released trades; state published per minute row | Available same-contract `1h@1m` ATR | 0.5, 1, 2           |

These six scales follow the [recorded decisions](plan-1h-and-pivots.md#6-decisions).
Name them by stream and multiplier, such as `fast_atr_0p5` and `slow_atr_2`. Each scale
is a variant row (`variant_id`) whose registry entry holds its stream, multiplier,
threshold normalizer (initially ATR(14) from the tier-1 candle; later variants may use the
[volatility tier](plan-1h-and-pivots.md#7-volatility-tier-atr-family)), and spread floor;
include the registry version in provenance. Each has its own state,
but **no phase key**. Never compare pivots across contracts, streams, or scales.

The threshold determines the minimum reversal magnitude. Sampling determines which
observations can trigger it and when. A large threshold often produces longer swings,
but does not guarantee an hour/day duration. `1m@1s` and `1h@1m` identify the ATR
context and the publication cadence, not a promise about the duration of the swing.

ATR still follows the existing per-phase indicator rules. A candidate's threshold inputs
come from the previous completed row, never the row its extreme falls in: for fast
scales the previous second's `1m@1s` ATR and last sampled spread; for slow scales the
latest previously completed minute's `1h@1m` ATR and that minute's last sampled spread. That does not create
60 swing histories: the detector consumes every released trade in one sequence. Slow state is stored only in `pivot_1m`; second decision rows read it
through an as-of join on `available_at <= decision_at`, holding the latest
completed-minute state and reporting its age/source ordinal. Do not reprocess
that held state or emit its confirmation again on every second.

The stored detector replays the engine's released trades in order
([plan 3.1](plan-1h-and-pivots.md#31-input-stream)), because a bar's high, low, or close
cannot show every crossing. A close-stream detector (one observation per bar close) is a
benchmark baseline only; it is not stored and must not be called exact.

## Directional change and availability

For an up leg with running high `H`, freeze
`theta_bps = max(k * ATR_bps, 2 * spread_bps)` when its candidate is set. The spread is the last
usable trade-sampled spread (`book_spread_bps`) with no age cutoff; its age is a separate
feature. It is undefined only before the first usable quote of an epoch or after missing
data. Mirror this for a down
leg's running low `L`. An undefined ATR or spread is never a zero threshold: it ends the epoch
exactly as missing coverage does (state table below), and a new epoch starts at the first
row where both inputs are defined. A ready candidate keeps its frozen threshold until a strict new extreme
replaces it. Equal prices keep the first extreme occurrence and do not refresh scale.

A high confirms when `10_000 * ln(H / p) >= theta_bps`; a low confirms when
`10_000 * ln(p / L) >= theta_bps`. The crossing trade's exact time is the
confirmation time. Availability and the feature row follow the scale's publication:
for fast scales the second row containing that trade, at its close plus the close delay;
for slow scales the minute row containing it, at the minute's close plus the close delay,
never the earlier second. Emit at that availability,
then switch direction and seed the next leg from that observation. Initialization
establishes a direction before claiming a completed incoming/outgoing swing; the
initial seed is not a confirmed pivot. Retain exact fixed-point reference prices in
data context and normalized values in features.

The published candidate `progress` is the opposite excursion divided by its frozen
threshold, clipped to `[0, 1]`. A crossing can overshoot 1; retain that displacement
on the confirmation event. Publish post-update state, so after confirmation the old
candidate is gone and the new leg starts at zero progress. The event retains the
confirmed candidate's reference, threshold, progress, extreme ordinal/time,
confirmation ordinal/time, and `available_at`. Never write the new classification
back onto the earlier extreme's feature row.

## Confirmed structure is a deterministic second layer

For confirmed lows `L_prev`, `L_new` in the same history, classify the new low by the
sign of `L_new - L_prev`. Compare highs the same way. Equality is exact in the initial
contract; a future tolerance/pivot-zone definition requires a separate version.

| Comparison                                       | Low class       | High class       |
| ------------------------------------------------ | --------------- | ---------------- |
| New level above previous same-kind level         | Higher low (HL) | Higher high (HH) |
| New level below previous same-kind level         | Lower low (LL)  | Lower high (LH)  |
| Equal levels                                     | Equal low (EL)  | Equal high (EH)  |
| No previous same-kind pivot in the valid history | Unknown         | Unknown          |

The class becomes available only when the new pivot confirms. Retain it as the
latest confirmed low/high class until another same-kind pivot confirms. A confirmed
HL remains an HL relative to its recorded predecessor even if price subsequently
breaks it. Level survival is a separate observation/outcome.

Define `trend` from the latest classified high and low: `+1` for HH and HL, `-1` for
LH and LL, and `0` for other known combinations, including equality. It is NULL until
both comparisons exist in the valid history. Do not encode insufficient history as
mixed/neutral. This state describes swing structure; it is not a forecast or trade.

Sequence counters, updated at each confirmation and NULL until the first classified pivot
of their kind in the epoch. The raw run lengths are event data: each confirmed low records
`low_run` (`+n` after `n` consecutive higher lows, `−n` after `n` consecutive lower lows;
an equal low sets 0, and the next class starts a new run from ±1), and each high records
`high_run` the same way. Model inputs are bounded:

- `low_run_ratio`, `high_run_ratio`: the run clipped to ±5 and divided by 5 (`Unit.RATIO`,
  −1 to 1). Five or more consecutive higher lows read as 1.
- `trend_age_s`: scheduled-open age since `trend` took its current value.

An epoch reset clears the counters and their ratios.

Store normalized deltas as `low_change_atr = (L_new - L_prev) / A_new` and
`high_change_atr = (H_new - H_prev) / A_new`, where `A_new` is the positive price-unit
ATR snapshot belonging to the new candidate. Positive/negative signs have the same
meaning for both fields. Keep that snapshot fixed for these event-relative deltas;
current-price distances to confirmed levels may use a separately named current ATR.

## Provisional higher lows and lower highs are causal candidate features

A provisional HL is true when the current down leg has an eligible candidate low
above the last confirmed low, the comparator belongs to the same valid history, and
`0 < progress < 1`. A provisional LH mirrors this in an up leg: candidate high below
the last confirmed high, with partial downward reversal. These relations can be
reported in any known trend context; any up/mixed/down filter belongs to the strategy.

Retain candidate ID, comparator event ID, normalized candidate-to-comparator distance,
progress, age, and validity. A strict new extreme replaces the candidate ID. If a
candidate low becomes equal to or lower than its comparator, provisional HL becomes
false; if the comparator or required inputs are unknown, the flag is NULL. At
confirmation clear the provisional flag, emit the confirmed class, and retain the
earlier snapshots as they were. A true provisional flag is not a calibrated probability.

For example, with last confirmed low 100 and candidate low 102, an observed partial
rebound can produce provisional HL. A subsequent candidate low of 99 clears it.
Alternatively, confirmation at low 102 emits HL only on the later confirmation row.
These illustrative prices are context, not model inputs.

Use explicit breach fields rather than an ambiguous "break of structure":
`break_up` is an observed trade strictly above the latest confirmed high;
`break_down` is an observed trade strictly below the latest confirmed low. Evaluate
against the references known before processing the observation's confirmations.
Record the first observed breach once per reference event ID and direction, with its
availability and `trend_before`. In an up structure, an upward breach is continuation
and a downward breach is a reversal warning; mirror for down structure. Equality is
not a breach, and an unknown reference produces no claimed breach. The breaching
trade's time is recorded; availability and the feature row follow the same publication
rule as confirmations (second row for fast scales, minute row for slow scales).

**Leg accumulators.** A leg runs from one extreme trade to the next: it holds the trades
after its starting extreme, through and including its ending extreme. Every trade
belongs to exactly one leg. The confirmation trade comes after the confirmed extreme, so
it belongs to the new leg that starts there, not to the completed one. The detector keeps
two sets of sums for the open leg: through its running extreme, and since that extreme.
When a strict new extreme replaces the running one, the since-extreme sums fold into the
through-extreme sums; on confirmation the since-extreme sums seed the new leg. Each leg
records its start and extreme ordinals and its sums of volume, sided volume, and buy −
sell volume. Tier 3 forms ratios from them; raw sums are data context, not features.

## Coverage, closures, and resets are part of the state contract

| Situation             | Behavior                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Covered no-trade row  | Advance scheduled-row ages; no new price, progress, pivot, or breach                                                                                               |
| Scheduled closure     | No synthetic rows; carry valid state, report wall age/closure crossing; a reopening observation can confirm                                                        |
| Missing coverage      | Preserve historical events, end the active state epoch, drop the candidate and reset current structure/comparators; rebuild known structure after coverage resumes |
| Contract switch       | Use the warmed state of that contract; never import the prior contract's prices or pivots                                                                          |
| Unknown/invalid scale | Same as missing coverage: end the epoch, drop the candidate and direction, clear current comparators, keep historical events; never use a fallback zero threshold  |

An epoch reset prevents "latest confirmed" from implying complete swing history
through an unknown interval. Historical events remain queryable with their old epoch.
The empty-window/analysis-close policy of the related stage plan does not turn an
unchanged carried price into a new observed trade for this detector.

## Tier 3: structure signals

These combine structure (tier 2) with indicators and volatility (tier 1) in the
[pipeline's](feature-pipeline.md) third tier (`signal_1s`, `signal_1m`). Per-scale signals
are variant rows like the scales; cross-scale summaries are one row per slot. All are
normalized, NULL when an input is undefined, and available with the row that publishes
them.

Persistence: values about the open candidate (pullback quality) update every row. Values
fixed by an event (divergences at a confirmed pivot, the latest sweep) **hold** on every
later row until the next event of the same kind replaces them or an epoch reset clears
them, and each has an age column (`*_event_age_s`, in scheduled-open rows) so a model sees
how fresh it is. The event tables hold the one-time pulses.

ATR snapshots: every value "in ATR" about a leg uses the ATR frozen with that leg's ending
extreme (for the open leg, its running extreme's snapshot), as stored on the event. No
leg value uses the publication row's current ATR.

**Pullback quality**, for the open candidate and for each confirmed low (mirrored for
highs). The _impulse_ is the last completed leg toward the comparator's opposite pivot,
and the _pullback_ is the leg from that pivot to the candidate low. A leg's duration is
its row count, inclusive: `end ordinal − start ordinal + 1`, where start and end are the
rows of its starting and ending extreme trades. A leg inside one row has duration 1, so
no ratio below divides by zero:

- `pullback_depth`: pullback size ÷ impulse size, clipped to 0–2 (a retracement ratio;
  above 1 means the low is no longer higher).
- `pullback_time_log`: `log(pullback rows ÷ impulse rows)`, clipped to ±3.
- `pullback_volume_log`: `log` of volume per row in the pullback ÷ in the impulse, clipped
  to ±3 (light volume on pullbacks is the classic healthy-trend pattern).

The unclipped ratios are stored on the events as context, not features.

- `pullback_delta_ratio` and `impulse_delta_ratio`: buy − sell over sided volume in each
  leg.
- `impulse_speed_atr`, `pullback_speed_atr`: leg size in ATR per minute, from that
  duration (rows × 60 s for slow scales, rows × 1 s for fast, converted to minutes).

**Divergence at confirmed pivots**, compared with the previous same-kind pivot:

- `low_cvd_change_ratio`: the change in cumulative buy − sell volume between the two lows,
  ÷ sided volume between them (−1 to 1). Price making a lower low while this rises is
  absorption, a classic bullish divergence; mirror for highs (`high_cvd_change_ratio`).
- `low_rsi_change`, `high_rsi_change`: the tier-1 RSI at each pivot's extreme row (index
  points). That value was available at that row, so the comparison is causal once the
  newer pivot confirms.

**Failed breaks (sweeps).** After `break_down` of a confirmed low, a trade back above
that low within `W` scheduled-open rows, before a new low is confirmed, is a `reclaim`.
Within one trade, breaches and reclaims are evaluated against the references known
before that trade, and only then confirmations: a trade that both reclaims the old low
and confirms a new, lower low emits the reclaim first. It is
the classic stop-run below a low that reverses. The fields are `reclaim_age_s` and
`sweep_depth_atr`: the distance from the breached low to the lowest trade from the
breaching trade through the reclaiming trade, in the ATR snapshot of the breached low's
event. Highs mirror this. `W` is a
variant parameter (initially 60 rows for fast scales and 15 for slow). Breaches and
reclaims need the trade order inside a row, so the pivot detector (tier 2), which replays
the trades, detects them and emits `breach` and `reclaim` events with their depth and
ordinals. Tier 3 reads those events; it never reconstructs paths from aggregated rows.

**Location:** `range_pos`, the current price within the latest confirmed low–high range,
clipped to 0 (at or below the low) through 1 (at or above the high). A breach is measured
separately: `beyond_high_atr` and `beyond_low_atr`, the distance beyond the latest
confirmed high or low in the high's or low's ATR snapshot, 0 inside the range.

**Across scales** (one row per slot): each summary declares the variant set it covers, as
part of its identity, so adding a scale never silently changes it; a new version that
includes the scale rebuilds the summary rows. Initially the set is the six scales of the
fixed grid. The summaries are the number of fast scales with `trend = +1` and with
`trend = −1`, the same for slow scales (as of the latest completed minute on second
rows), and the number of scales with a provisional HL or LH. A model learns the
interactions, such as a fast higher low inside a slow uptrend, from these and the
per-scale fields; no combination is hard-coded.

**Later variants**, judged by the benchmark and added as variant rows:

- A time-or-magnitude confirmation that also confirms after `N` rows without a new extreme
  once the reversal reaches a smaller fraction of θ. It catches quiet, sideways turns
  that pure directional change confirms late.
- Equal-high and equal-low zones with a tolerance in ATR (double tops and bottoms).
- Thresholds normalized by time-of-day or directional ATR.

## Build and store the fixed grid before comparing predictive quality

After the planned stage/version work and minute/hourly inputs, implement the
deterministic detector and structure together, validate synthetic/recorded fixtures,
then pilot and materialize all six scales. `pivot_1s` stores fast state per second and
`pivot_1m` stores slow state per minute; second rows join slow state as of its
availability instead of storing copies; the sparse pivot-event table retains native
source ordinals and the immutable confirmed history. Do not emit duplicate slow events
when dense second rows repeat the minute state. Follow the related plan's stage
boundaries; no need to rebuild unrelated second-row calculations to add pivot storage.

Persist scale/configuration/builder identity, contract, epoch, candidate/comparator IDs,
normalized distances and deltas, progress, confirmed classes, trend, provisional flags,
breach references/ages, and coverage/readiness. Raw levels belong in event/data context.
Declare units: distances/deltas in `Unit.ATR`, threshold in `Unit.BPS`, progress/trend
in `Unit.RATIO`, booleans in `Unit.FLAG`, and elapsed time in `Unit.SECONDS`. Use NULL
when undefined. Retain row ordinals/IDs as metadata and separate elapsed wall time
from scheduled-open age. Persist/checkpoint every scale's state in shared strategy-core.

The benchmark then compares stored variants and challengers, using the independent
reference labels and chronological validation in the research. It governs quality
claims and later selection/promotion, not whether deterministic metrics may be stored.
An ML model can receive the predeclared scales; choosing scales or expanding the grid
using test outcomes would still leak evaluation information. Store future-looking
labels separately from contemporaneous features. Keep the fixed initial grid version
for reproducibility if later versions add or retire scales.

## Required implementation examples and checks

| Case                                                              | Expected result                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| First confirmed low/high                                          | Same-kind comparison unknown; trend stays NULL                                                 |
| Two confirmed lows 100 then 102                                   | HL appears at the second confirmation, not its extreme time                                    |
| Two confirmed highs 110 then 108                                  | LH; signed high delta is negative                                                              |
| Equal same-kind pivots                                            | EL/EH, never HL/HH or a strict breach                                                          |
| Candidate 102 above prior low 100, then extends to 99             | Provisional HL can be true after partial rebound, then clears without rewriting its past rows  |
| HH+HL; LH+LL; one equal/mixed pair                                | Up; down; mixed, once both comparisons are known                                               |
| Volatility falls without a new price                              | Frozen threshold does not create confirmation                                                  |
| Adjacent second rows with different ATR phases                    | Same swing history/comparators; only an actual qualifying observation changes events           |
| One slow confirmation joined to 60 second rows                    | One event ID/availability, held context with age; no 60 confirmation pulses                    |
| Missing interval, quiet interval, roll, closure                   | Distinct behavior from the state table above                                                   |
| Lows HL, HL, EL, LL, LL                                           | `low_run` = 1, 2, 0, −1, −2                                                                    |
| Break below a confirmed low, back above it within `W`             | One `reclaim` with its age and sweep depth; none if a new low confirms first or after `W` rows |
| Price LL while cumulative delta rises between lows                | `low_change_atr` < 0 and `low_cvd_change_ratio` > 0 (bullish divergence)                       |
| One trade reclaims the breached low and confirms the new low      | Reclaim emitted, then the new low (an LL) confirms; both in that trade's row                   |
| Confirmation trade's volume                                       | Counted in the new leg only; each trade belongs to exactly one leg                             |
| Impulse and pullback both inside one second                       | Each leg has duration 1 row; time ratio 1; speeds and volume per row defined                   |
| Breach to 99.8, extend to 99.5, reclaim above 100 at a low of 100 | `sweep_depth_atr` uses 0.5 (the deepest trade before the reclaim)                              |
| Six consecutive higher lows                                       | `low_run` = 6 on the event; `low_run_ratio` = 1                                                |

Prove price/size scale invariance, prefix invariance, checkpoint continuation, and
whole-session versus incremental parity. Test threshold equality/overshoot, repeated
breaches, stale scale inputs, initial warm-up, epoch resets, and source-row as-of joins.
Use throwaway databases to validate schema/event uniqueness before any local migration
or backfill. Benchmark results must still report missed turns, false alarms, timing,
candidate failures, coverage, and uncertainty; no profitability gate is required.
