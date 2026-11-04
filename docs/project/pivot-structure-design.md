**Pivot and market-structure contract: review follow-up**

Proposed November 3, 2026, following the review of PR #66. This defines the next
implementation; it is not implemented or benchmarked. Read the
[agent handoff](pivot-detection-handoff.md) and [research](../research/pivots/2026-11-03-reviewed-findings.md).
The [stage/minute/pivot plan](plan-1h-and-pivots.md#3-pivot-and-structure-design)
governs the observations (the trade path), thresholds and their inputs, segments, price
domain, ages, storage, and labels. This contract governs structure semantics: classes,
trend, provisional relations, breaches, and their field names. Where both cover a point,
they must agree; an _epoch_ here is a plan _segment_.

**One chronological swing history per contract, stream, and scale.**

| Family | Detector observations                           | Threshold normalizer                | Initial multipliers |
| ------ | ----------------------------------------------- | ----------------------------------- | ------------------- |
| Fast   | Released trades; state published per second row | Available same-contract `1m@1s` ATR | 0.5, 1, 2           |
| Slow   | Released trades; state published per minute row | Available same-contract `1h@1m` ATR | 0.5, 1, 2           |

These six scales follow the [recorded decisions](plan-1h-and-pivots.md#6-decisions).
Name them by stream and multiplier, such as `fast_atr_0p5` and `slow_atr_2`;
include the registry/configuration version in provenance. Each has its own state,
but **no phase key**. Never compare pivots across contracts, streams, or scales.

The threshold determines the minimum reversal magnitude. Sampling determines which
observations can trigger it and when. A large threshold often produces longer swings,
but does not guarantee an hour/day duration. `1m@1s` and `1h@1m` identify the ATR
context and the publication cadence, not a promise about the duration of the swing.

ATR still follows the existing per-phase indicator rules. At each candidate update,
read only the ATR already available for that stream's newest row. That does not create
60 swing histories: the detector consumes every released trade in one sequence. On
second decision rows, join slow state by `available_at <= decision_at`, holding the
latest completed-minute state and reporting its age/source ordinal. Do not reprocess
that held state or emit its confirmation again on every second.

The stored detector replays the engine's released trades in order
([plan 3.1](plan-1h-and-pivots.md#31-input-stream)), because a bar's high, low, or close
cannot show every crossing. A close-stream detector (one observation per bar close) is a
benchmark baseline only; it is not stored and must not be called exact.

**Directional change and availability.**

For an up leg with running high `H`, freeze
`theta_bps = max(k * ATR_bps, 2 * spread_bps)` when its candidate is set. Use a usable
trade-sampled spread under a declared observation-age policy. Mirror this for a down
leg's running low `L`. Undefined ATR or unusable spread means an unready candidate,
not a zero threshold; restart it from the next eligible observation and mark the
interruption. A ready candidate keeps its frozen threshold until a strict new extreme
replaces it. Equal prices keep the first extreme occurrence and do not refresh scale.

A high confirms when `10_000 * ln(H / p) >= theta_bps`; a low confirms when
`10_000 * ln(p / L) >= theta_bps`. Emit at the current observation's availability,
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

**Confirmed structure is a deterministic second layer.**

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

Store normalized deltas as `low_change_atr = (L_new - L_prev) / A_new` and
`high_change_atr = (H_new - H_prev) / A_new`, where `A_new` is the positive price-unit
ATR snapshot belonging to the new candidate. Positive/negative signs have the same
meaning for both fields. Keep that snapshot fixed for these event-relative deltas;
current-price distances to confirmed levels may use a separately named current ATR.

**Provisional higher lows and lower highs are causal candidate features.**

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
trade's time is recorded; its feature row is the second row that contains it.

**Coverage, closures, and resets are part of the state contract.**

| Situation             | Behavior                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Covered no-trade row  | Advance scheduled-row ages; no new price, progress, pivot, or breach                                                                                               |
| Scheduled closure     | No synthetic rows; carry valid state, report wall age/closure crossing; a reopening observation can confirm                                                        |
| Missing coverage      | Preserve historical events, end the active state epoch, drop the candidate and reset current structure/comparators; rebuild known structure after coverage resumes |
| Contract switch       | Use the warmed state of that contract; never import the prior contract's prices or pivots                                                                          |
| Unknown/invalid scale | Mark candidate-dependent values unavailable; do not manufacture confirmation from a fallback zero threshold                                                        |

An epoch reset prevents "latest confirmed" from implying complete swing history
through an unknown interval. Historical events remain queryable with their old epoch.
The empty-window/analysis-close policy of the related stage plan does not turn an
unchanged carried price into a new observed trade for this detector.

**Build and store the fixed grid before comparing predictive quality.**

After the planned stage/version work and minute/hourly inputs, implement the
deterministic detector and structure together, validate synthetic/recorded fixtures,
then pilot and materialize all six scales. Dense per-second features expose fast
state and the latest available slow state; the sparse pivot-event table retains native
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

**Required implementation examples and checks.**

| Case                                                  | Expected result                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| First confirmed low/high                              | Same-kind comparison unknown; trend stays NULL                                                |
| Two confirmed lows 100 then 102                       | HL appears at the second confirmation, not its extreme time                                   |
| Two confirmed highs 110 then 108                      | LH; signed high delta is negative                                                             |
| Equal same-kind pivots                                | EL/EH, never HL/HH or a strict breach                                                         |
| Candidate 102 above prior low 100, then extends to 99 | Provisional HL can be true after partial rebound, then clears without rewriting its past rows |
| HH+HL; LH+LL; one equal/mixed pair                    | Up; down; mixed, once both comparisons are known                                              |
| Volatility falls without a new price                  | Frozen threshold does not create confirmation                                                 |
| Adjacent second rows with different ATR phases        | Same swing history/comparators; only an actual qualifying observation changes events          |
| One slow confirmation joined to 60 second rows        | One event ID/availability, held context with age; no 60 confirmation pulses                   |
| Missing interval, quiet interval, roll, closure       | Distinct behavior from the state table above                                                  |

Prove price/size scale invariance, prefix invariance, checkpoint continuation, and
whole-session versus incremental parity. Test threshold equality/overshoot, repeated
breaches, stale scale inputs, initial warm-up, epoch resets, and source-row as-of joins.
Use throwaway databases to validate schema/event uniqueness before any local migration
or backfill. Benchmark results must still report missed turns, false alarms, timing,
candidate failures, coverage, and uncertainty; no profitability gate is required.
