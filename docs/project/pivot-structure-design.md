# Pivot and market-structure contract

This contract defines the swings and structure that the code stores for price, RSI, and
CVD (`strategy_core/swings.py`, `stage_step_pivot.py`, `stage_step_series.py`). The swings
are computed by rule only: no model predicts a reversal. The
[design notes](plan-1h-and-pivots.md#3-pivot-and-structure-design) govern the observations
(the trade path), thresholds and their inputs, segments, price domain, ages, and storage.
This contract governs structure semantics: classes, trend, provisional relations, breaches,
and their field names. Where both cover a point, they agree; an _epoch_ here is a design-note
_segment_. The [research](../archive/research/2026-11-03-reviewed-findings.md) behind the
design is kept for reference.

## One chronological swing history per contract, stream, and scale

A swing history is kept for each contract, each timeframe (stream), and each scale. A scale
is a multiple of that timeframe's ATR:

| Timeframe | Detector observations                             | Threshold normalizer                    | Multipliers      |
| --------- | ------------------------------------------------- | --------------------------------------- | ---------------- |
| `1m@1s`   | Released trades; state published per second row   | Available same-contract `1m@1s` ATR     | 0.5, 1, 2, 3     |
| `10m@10s` | Released trades; state published per 10-second row | Available same-contract `10m@10s` ATR | 0.5, 1, 2, 3     |
| `1h@1m`   | Released trades; state published per minute row   | Available same-contract `1h@1m` ATR     | 0.5, 1, 2, 3     |

That is four multiples on three timeframes, twelve scales. Name them by timeframe and
multiplier, such as `fast_atr_0p5`, `mid_atr_1`, and `slow_atr_2`. Each scale is a variant
row (`variant_id`) whose registry entry holds its stream, multiplier, reclaim window `W`
(it changes which reclaim events the detector emits), threshold normalizer (ATR(14) from the
tier-1 candle; later variants may use the
[volatility family](plan-1h-and-pivots.md#7-the-volatility-family)), and spread floor;
the registry version is part of provenance. Each scale has its own state, but **no phase
key**. Never compare pivots across contracts, timeframes, or scales.

The threshold determines the minimum reversal magnitude. Sampling determines which
observations can trigger it and when. A large threshold often produces longer swings, but
does not guarantee an hour or day duration. `1m@1s` and `1h@1m` identify the ATR context
and the publication cadence, not a promise about the duration of the swing.

ATR still follows the per-phase indicator rules. A candidate's threshold inputs come from
the previous completed row, never the row its extreme falls in: for fast scales the
previous second's `1m@1s` ATR and last sampled spread; for slow scales the latest
previously completed minute's `1h@1m` ATR and that minute's last sampled spread. That does
not create 60 swing histories: the detector consumes every released trade in one sequence.
Slow state is stored only in `pivot_1m`; second decision rows read it through an as-of join
on `available_at <= decision_at`, holding the latest completed-minute state and reporting
its age and source ordinal. Do not reprocess that held state or emit its confirmation
again on every second.

The stored detector replays the engine's released trades in order
([design notes 3.1](plan-1h-and-pivots.md#31-input-stream)), because a bar's high, low, or
close cannot show every crossing. A detector that reads one observation per bar close is
not exact and is not stored.

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

The published candidate `progress` is the deepest pullback since the running extreme,
divided by the frozen threshold, clipped to `[0, 1]`. It is not a probability. The
current distance from the extreme, in ATRs, is `ext_dist_atr`. A crossing can overshoot 1;
retain that displacement on the confirmation event. Publish post-update state, so after confirmation the old
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
sell volume. Ratios formed from them (such as `leg_delta_ratio`) are features; raw sums are data context.

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

## Swing sources: price, RSI, and CVD

The detector and the structure layer are generic over a **source series**, so swings,
higher lows and lower highs, trend, runs, provisional relations, breaches, and reclaims are
computed the same way for every source. A source declares its observations, how distance
is measured, and its threshold. RSI and CVD are built as specified in
[series-structure-spec.md](series-structure-spec.md) ([decision 41](roadmap.md#decisions)):

| Source  | Observations                                                  | Distance                    | Threshold `θ`, frozen when the extreme is set          |
| ------- | ------------------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| `price` | Released trades, in order; published per step row             | `10⁴ × ln(H / p)` (log-bps) | `max(k × ATR_bps, 2 × spread_bps)`                     |
| `rsi`   | The mean of the last 60 rows' RSI (each phase once), per row  | `H − p` in RSI points       | `max(k × the RSI's own ATR, 0.25 points)`              |
| `cvd`   | Running buy − sell volume at each step row's close            | `H − p` in contracts        | `max(k × the CVD's own ATR, 3 typical trades)`         |

`k` is 0.5, 1, 2, or 3 for every source. A series' own ATR is computed as price's is, with
the series in place of price (`stage_step_series.py`).

What differs for RSI and CVD:

- **No path inside a row.** Each row is one observation, at its close, and events happen at
  row closes. Price is the one source that reads the trades inside a row.
- **Their own ATR.** A swing of RSI is measured in ATRs of RSI and a swing of CVD in ATRs of
  CVD, never in price's. Values "in ATRs" divide by that ATR floored at half the smallest
  swing, as price's divide by its ATR floored at the spread.
- **Levels.** RSI is an index, so the level of an RSI high or low is a model input
  (`Unit.INDEX`): a low at 28 differs from one at 45. A CVD level is a count of contracts
  from wherever counting began: context only, read by its changes, never by its level.
- **One chronological series.** The stored RSI is per phase, so consecutive rows come from
  different phase states, each resting at its own level. Read row by row, a detector
  confirms swings solely because two phases hold different values: the fast 0.5 ATR scale
  confirmed two pivots a minute after trading stopped
  ([reproduction](https://github.com/paulshorey/trading/pull/103#issuecomment-7182430941)).
  So the series is the mean of the last 60 rows' RSI, each phase once
  ([decided](results.md#how-should-the-rsi-series-be-read)).
  The rule for any indicator kept per phase: average it over the phases before a zigzag
  reads it.
- **Own stages.** `pivot_rsi_<rows>` and `pivot_cvd_<rows>` (tier 2; inputs `bar_<rows>` and
  `candle_<window>`), one stage per scale, with their events in `market.pivot_event`.

More sources (MACD histogram, other oscillators) can be added as stages that declare the
same three things.

## Failed breaks (sweeps)

After a breach of a confirmed low (`break_down`), a trade back
above that low within `W` scheduled-open rows, before a new low is confirmed, is a
reclaim (`reclaim_low`; `reclaim_high` for highs): the classic stop-run that reverses. Its
event stores `depth_atr`, the deepest observation beyond the level from the breach through
the reclaim, in the ATR snapshot of the breached pivot. Within one trade, breaches and
reclaims are evaluated against the references known before that trade, and only then
confirmations: a trade that both reclaims the old low and confirms a new, lower low emits
the reclaim first. `W` is a scale parameter and part of that scale's identity (60 rows for
the `1m@1s` scales, 30 for `10m@10s`, 15 for `1h@1m`). Breaches and reclaims need the trade
order inside a row, so the detector, which replays the trades, emits them as events.
Nothing reconstructs paths from aggregated rows.

## Storage

Persist the scale/configuration/builder identity, contract, epoch, candidate and comparator
IDs, normalized distances and deltas, progress, confirmed classes, trend, provisional
flags, breach references and ages, and coverage and readiness. Raw levels belong in event
and data context. Declare units: distances and deltas in `Unit.ATR`, threshold in
`Unit.BPS`, progress and trend in `Unit.RATIO`, booleans in `Unit.FLAG`, and elapsed time
in `Unit.SECONDS`. Use NULL when undefined. Row ordinals and IDs are metadata, and elapsed
wall time is kept apart from scheduled-open age. Every scale's state is checkpointed in
shared strategy-core code. Future-looking labels are stored apart from features.

## Not built

The comparison of the structure of price, RSI, and CVD (for example a price lower low
against an RSI higher low, or cumulative-delta change between two lows) is planned as
comparison codes ([roadmap decision 41](roadmap.md#decisions)). No stage computes it yet.
The earlier design of `signal_*` stages (pullback quality, divergences, cross-scale
counts) was never built and is dropped. The reversal benchmark was withdrawn on
November 23, 2026.

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
| One trade reclaims the breached low and confirms the new low      | Reclaim emitted, then the new low (an LL) confirms; both in that trade's row                   |
| Confirmation trade's volume                                       | Counted in the new leg only; each trade belongs to exactly one leg                             |
| Breach to 99.8, extend to 99.5, reclaim above 100 at a low of 100 | `sweep_depth_atr` uses 0.5 (the deepest trade before the reclaim)                              |
| Six consecutive higher lows                                       | `low_run` = 6 on the event; `low_run_ratio` = 1                                                |
| RSI 40 → 55 → 49 with θ = 5 points                                | RSI high at 55 confirmed on the 49 row; its level 55 is a feature, its change ÷ 100 a ratio    |
| RSI NULL (incomplete window)                                      | RSI epoch ends; RSI structure restarts when RSI is defined again                               |

Prove price and size scale invariance, prefix invariance, checkpoint continuation, and
whole-session versus incremental parity. Test threshold equality and overshoot, repeated
breaches, stale scale inputs, initial warm-up, epoch resets, and source-row as-of joins.
Use throwaway databases to validate schema and event uniqueness before any local migration
or backfill.
