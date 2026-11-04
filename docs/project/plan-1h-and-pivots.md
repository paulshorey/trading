# Plan: extensible stages, `1h@1m` rows, and swing structure (higher lows, lower highs)

Proposed November 3, 2026; decisions recorded the same day ([section 6](#6-decisions)).
Nothing here is implemented yet. It answers four questions: are the stored `1m@1s` rows
right, how to make the system extensible, when to build `1h@1m`, and how to add high/low
pivot detection at both resolutions. [Section 7](#7-after-pivots-more-atr-metrics) outlines
the ATR metrics that follow.

## Summary

1. **The stored `1m@1s` rows are correct as specified** ([checks](#1-review-of-the-stored-1m1s-rows)).
   One policy produces many NULL features in SI and should be decided before
   anything is built on top of it: a window with no trades is treated like missing data.
2. **Refactor the plumbing, not the calculations.** Split the row builder into
   independent _stages_ (one table, one version, one checkpoint each), so adding
   `1h@1m` or pivots never invalidates the 57 GB of second rows again. This is a small
   PR. It needs one GC+SI rebuild (11 minutes at today's lead), which also applies the
   empty-window decision and the [lead](#6-decisions) chosen for every later stage.
3. **Then `1h@1m`** as the update proposed, with the amendments in [section 5](#5-1h1m-amendments-to-the-proposed-plan).
4. **Then swing structure**: a multi-scale directional-change detector plus a deterministic
   _market-structure_ layer that labels each confirmed swing as a higher/lower high/low.
   Store a small fixed grid of scales at both resolutions, then benchmark and train on
   the stored values ([section 3](#3-pivot-and-structure-design)).

| PR  | Contents                                                                                | Rebuild         |
| --- | --------------------------------------------------------------------------------------- | --------------- |
| A   | Stage interface, per-stage versions and checkpoints, empty-window policy, lead sessions | `1s` stages     |
| B   | `bar_1m`, `candle_1h_1m` (the `1h@1m` stage), new hourly-only metrics                   | new tables only |
| C   | Swing detector and structure: `pivot_1s`, `pivot_1m`, `pivot_event`                     | new tables only |
| D   | Pivot benchmark and outcome labels (future-looking, stored apart from inputs)           | new tables only |
| E   | More ATR and volatility metrics ([section 7](#7-after-pivots-more-atr-metrics))         | new tables only |

C's fast scales need only A, so C can start in parallel with B. Its slow scales need B.

## 1. Review of the stored `1m@1s` rows

Read-only checks on November 3, against local database `trading`:

| Check                                                                                                                                                                    | Result                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Raw DBN trades, using only the `databento` library, bucketed into seconds and compared with `bar_1s` (OHLC, volume, buy/sell volume, trades), 2026-09-15 13:00–15:00 UTC | GCZ6 4,727 seconds, SIZ6 2,268 seconds: **0 differences** |
| `candle_1m_1s` vs direct SQL aggregation of its 60 `bar_1s` rows (OHLC, volume, delta, observed seconds), GCZ6, one hour                                                 | 3,541 rows: **0 differences**                             |
| Ordinals: rows per contract equal `max − min + 1`                                                                                                                        | GCQ6 4,102,200, GCZ6 5,952,600: **no gaps or duplicates** |
| Textbook same-phase Wilder RSI(14), ATR(14), and EMA(21) recomputed from stored candle closes, GCZ6, phases 0, 17, and 59 (99,210 candles each)                          | **Bit-identical**, with identical NULLs                   |

Together with the ingest's roll and degraded-session checks, this covers prices, volumes,
aggressor sides, windows, ordinals, and recursive indicators. These checks did not compare
the sampled-book metrics (spread, depth, imbalance) with raw DBN records. Unit tests
cover them against the handoff's reference cases. The planned `catalog --audit` command
should add a raw-record check for them.

### Finding 1: quiet windows blank out SI features (policy decision)

A 60-second window without a trade (`status` empty) is treated like missing data. It is
not an indicator input, and it restarts each indicator's previous close. Lookback
indicators need every same-phase candle in their range, so one quiet minute erases the
next 14–26 values of that phase. Measured on September 2026 front sessions:

| Product | Empty windows | `rsi` NULL | `ema50_atr` NULL | `aroon_up` NULL | `flow_price_corr` NULL |
| ------- | ------------- | ---------- | ---------------- | --------------- | ---------------------- |
| GC      | 0.06%         | 0.12%      | 0.06%            | 1.16%           | 1.17%                  |
| SI      | 3.18%         | 5.74%      | 3.18%            | 30.83%          | 28.12%                 |

In plain terms, a quiet minute is a known fact: the price did not change. A missing
minute is an unknown. The current code treats both as "unknown". The NULLs also
cluster in quiet hours, so an ML model trained on complete rows would see mostly busy
markets.

The TBBO handoff ([§4.2](tbbo-engineering-handoff.md)) recommended a carried
_analysis close_. A healthy empty window keeps the last trade price as its indicator
input, so it contributes zero change. It stays flagged, and its age is recorded. Its
observed OHLC stays NULL, and nothing is ever carried across missing data. The
implementation chose otherwise ([difference 4](ingestion.md#differences-from-the-handoff)).
**Recommendation:** adopt the carried analysis close for empty windows in PR A, keep the
gap policy for missing data, and record `price_age_s` as a feature. This changes stored
features, so it shares PR A's rebuild. It matters most for SI and for the pivot detector,
which would otherwise stall in the same quiet periods.

### Finding 2: three float summation orders

Rolling `pv` sums use `sliding_window_view(...).sum()` (`windows.py`), metric windows
add newest-first (`window_metrics.py`), and `bars.combine` uses `reduceat`. Each is
deterministic, and tests prove that chunking does not change results. Minute aggregation
adds a fourth path, so PR A should provide one ordered-sum helper and use it everywhere.
Then `bar_1m` floats equal the `1m@1s` candle at the same minute end exactly, not just
to the last bit.

## 2. Assessment of the pivot research (PR #66)

**Sound and worth keeping:**

- Directional change (DC) as the primary detector.
- Separate times for the extreme, the confirmation, and availability; no backdating.
- Completion versus survival labels, and timeouts kept apart from unknown outcomes.
- Labels defined independently of any detector.
- No profitability gate for an indicator.

**What it leaves out, for this goal:**

1. **It stops one layer short.** It asks "has a temporary extreme happened?" Your
   strategy asks "is this low _higher_ than the last confirmed low?" That second layer,
   _market structure_, is deterministic once pivots are confirmed. It needs definitions,
   not more research. [Section 3.3](#33-structure-higher-lows-and-lower-highs) supplies them.
2. **Scale comes from the threshold, not the bar size.** Think of a coastline measured
   with a 1 m ruler and a 1 km ruler: same coast, different wiggles. DC with a 2-tick
   threshold finds second-scale swings, and with a 2-hourly-ATR threshold finds day-scale
   swings, on the _same_ price stream. "Pivots for `1m@1s` and `1h@1m`" therefore means
   small and large threshold families. Each is normalized by its own window's ATR.
3. **It gates storage on the benchmark.** The DC detector and structure rules are cheap,
   deterministic, and testable for causality. I would build them, store a small
   predeclared grid, and let the benchmark and ML choose among stored variants. Keep the
   grid small, because storage per second is not free ([sizes](#34-stored-values)).
4. **Interleaved phases are wrong for swings.** The [design doc §5](../sliding-windows/design.md#5-highs-lows-and-pivots)
   proposes pivots on each phase series. That creates 60 interleaved structures, so
   adjacent rows would describe different swing histories, and features would jitter
   second to second. Run swing detection once on the trade stream, publishing state per
   second and per minute ([3.1](#31-input-stream)); the research recommends disjoint
   observations. Keep
   per-phase fractal pivots only as a benchmark, and amend design §5 accordingly.

There are five research files plus the older proposal. After the benchmark, fold the
conclusions into one design doc and leave the rest as history.

## 3. Pivot and structure design

### 3.1 Input stream

- **The detector replays the accepted trades themselves**, in the engine's release order
  (by assigned second, then receive order; `bars.aggregate`). A bar's high and low, or
  even its open, extremes, and close, cannot show every crossing. With a high of 100
  and θ = 4, the trades `99 → 105 → 100` confirm the new high at 105, but replaying only
  the extremes, `99 → 105`, never sees the decline. Stages recompute from the DBN files
  in memory, and live sessions receive the trades, so the exact path is always available.
- **Availability stays per second.** State is published once per second row, after that
  second's trades, at the second's close plus the close delay. A crossing trade's exact
  time is recorded, but no feature uses it before its second closes.
- **Fast scales** are stored per second (`pivot_1s`); each threshold is a multiple of the
  `1m@1s` ATR as of the previous second, with a spread floor.
- **Slow scales** run on the same trade stream, with thresholds from the `1h@1m` ATR of
  the latest completed minute and the same spread floor, and are stored at each minute's
  end (`pivot_1m`).
- Prices stay in exact fixed-point integers inside the detector, so ties are exact.
  Outputs are normalized (`Unit`).
- Second-resolution entries read the slow structure as of the latest completed minute,
  with its age, exactly as `1h@1m` bias features are joined today.

### 3.2 Detector: directional change with a frozen scale

For each contract and scale: an _up_ leg keeps its running high `H` (first occurrence on
ties) and the lowest price since it. The threshold `θ` (bps) is
`max(k × ATR_bps, f × spread_bps)`, taken as of the time `H` was set. It refreshes only
when a strictly higher high replaces `H`, so falling volatility alone can never confirm a
reversal. The high is **confirmed** when `10⁴ × ln(H / p) ≥ θ`. The leg then turns down,
with the running low being the lowest price since `H`. Mirror everything for lows. Until
the first leg is established (at the start, and after missing data), the direction is
unknown: the detector tracks both the running high and the running low, each with the
lowest or highest price since it, and the first reversal of `θ` from either extreme sets
the direction. For example, with θ = 4, `100 → 103 → 97` confirms the high at 103 even
though price never moved 4 from where it started.

**Threshold inputs.** `ATR_bps` is the window's ATR (`1m@1s` for fast scales, `1h@1m`
for slow), and `spread_bps` is the last sampled book spread (`book_spread_bps`), both as
of the previous row. A segment ([3.3](#33-structure-higher-lows-and-lower-highs)) starts
only at the first row where both are defined: at a contract's start, after warm-up, and
after missing data. Until then the detector is idle; it keeps no candidate, so no later
scale is applied to an earlier extreme. Within a segment both stay defined, because with
carried prices for quiet windows (Finding 1) only missing data makes them undefined. As a
safeguard, if either is ever undefined, the segment ends exactly as for missing data.

| Situation         | Rule                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Closure (no rows) | State continues; a reopening jump can confirm a pivot, because it is a real move                                                                                               |
| Missing data      | Starts a new structure segment: earlier events stay recorded, the open candidate is dropped, and direction is unknown again ([3.3](#33-structure-higher-lows-and-lower-highs)) |
| Empty bar         | No new price, no change; ages advance (Finding 1)                                                                                                                              |
| Roll              | Per contract; a new contract warms up during its lead sessions                                                                                                                 |
| Emitted events    | Immutable; a later break of the level is a new event, never an edit                                                                                                            |

### 3.3 Structure: higher lows and lower highs

Within one **segment** (a stretch without missing data), confirmed pivots alternate high,
low, high, … per scale. Missing data ends the segment, because the swing during the gap is
unobserved: the next segment's first pivot may be of either kind, and it is never compared
with pivots before the gap. Structure features (`hl_atr`, `lh_atr`, `trend`,
`trend_swings`, break of structure) stay NULL until the new segment has confirmed both a
high and a low; the last confirmed levels before the gap remain in `pivot_event`, with
their segment. Each confirmed low `L_k` is a
**higher low** if `L_k > L_{k−1}`, a lower low if it is lower, and an equal low if the
two are equal. Highs are classified the same way. Trend state: **up** after a higher
high and a higher low, **down** after a lower high and a lower low, otherwise
**mixed**. A _break of structure_ is a trade beyond the last confirmed opposite pivot.
In a down structure, that is the first sign of reversal.

The early signal you are after is a **provisional higher low**: in an up or mixed
structure, the current down leg's running low is still above the last confirmed low, and
price has already reversed part of `θ`. The reversal progress (0 to 1, where 1 is
confirmation) is the key ML input: the model learns how likely confirmation is from
progress, flow, and context. Lower highs mirror this.

### 3.4 Stored values

Per scale, normalized, as dense columns:

- `dir`, `progress` (reversal since the running extreme ÷ θ), `ext_dist_atr`, `ext_age_s`
- `leg_atr`, `leg_age_s`, `leg_delta_ratio` (aggressor flow over the leg: divergence input),
  `prev_leg_atr`, `retrace` (current leg ÷ previous leg)
- `low_dist_atr`, `high_dist_atr` (close vs the last confirmed low and high), with ages
  since each extreme and since its confirmation
- `hl_atr` = (L*k − L*{k−1}) / ATR, `lh_atr` = (H*k − H*{k−1}) / ATR,
  `trend` (−1, 0, +1), `trend_swings` (consecutive swings in trend), `bos_age_s`
- `theta_bps`, and validity/warm-up flags

Also stored is a sparse **`market.pivot_event`** table, one row per confirmed pivot. It
holds the scale, kind, extreme and confirmation ordinals and times, the raw level (as
data context, not a feature), θ, leg statistics, and the structure label. Charts, labels,
and SQL research use it.

**Initial grid** (illustrative, to be judged by the benchmark): fast `k ∈ {0.5, 1, 2}` ×
`1m@1s` ATR and slow `k ∈ {0.5, 1, 2}` × `1h@1m` ATR, every scale with the same spread
floor `f = 2` (θ ≥ 2 spreads; it rarely binds at slow scales). For scale:
the median `1m@1s` ATR in September 2026 was 4.3 bps for GC and 6.4 bps for SI. So
0.5 × ATR is about 8 GC ticks but only about 3 SI ticks, which is why the spread floor matters.

**Size:** about 16 columns × 3 scales of `double precision` per second comes to roughly
15–20 GB for a GC+SI year. Minute rows and events are under 1 GB. See decision 3.

### 3.5 Labels and benchmark (PR D)

Outcome labels are stored apart from inputs, in their own table, with their availability
times. Hindsight reference swings are flagged as such. Each label follows one complete
first-passage contract, recorded with its parameters (a label ID) so any implementation
assigns the same outcome:

- **Candidate:** a snapshot of the detector at a row's close, never at a trade inside a
  row. For each scale and stage `q` (default `q ∈ {0.25, 0.5}`), the candidate is the
  open leg's running extreme `E` as of the close (with its ordinal, time, and frozen `θ`),
  taken at the first row close where `E`'s progress (the largest reversal since `E`,
  ÷ `θ`) is at least `q`. If the extreme is replaced later, the new extreme is a new
  candidate when its own progress reaches `q`. At the close, no trade lies beyond `E`, and
  any pivot confirmed earlier in the row is already in the snapshot. First passage is
  scored on the trades after that row, from the next row's first trade. If progress at
  the close already reaches `R`, the candidate is stored as **resolved before decision**:
  an observation, not a prediction target.
- **Barriers, in multiples of the frozen `θ`, in log-bps from `E`:** reversal at `R`
  (default 1.0, the confirmation itself) and invalidation at `C` beyond `E` (default
  0.25). A price exactly on a barrier counts as reaching it.
- **Horizon `K`** in scheduled-open rows of the scale's stream (defaults: fast 300
  seconds, slow 240 minutes). Closures add no rows.
- **Path and ties:** the trade path in release order ([3.1](#31-input-stream)), so the
  first barrier reached is unambiguous.
- **Outcomes:** reversal, invalidation, timeout (the horizon was fully observed), session
  end (the session closed first), and unknown (missing data before resolution).
- **Survival** is a separate label with its own frozen deadline `S`, in scheduled-open
  rows after the decision row (default `S = K`). `E` is broken by any trade strictly beyond
  it; a trade equal to `E` does not break it. Outcomes: survived (`S` rows fully observed
  without a break), broken (with the breaking trade's ordinal), session end, and unknown
  (missing data first). `E` is the running extreme at the decision close, so it cannot be
  broken before the decision.
- **Parameters are frozen in the PR D spec before any labels are computed**, and they
  stay identical in training and testing.

Labels are a stage (`pivot_label`) whose inputs are `market` and the pivot stages. The
benchmark follows the reviewed research:

- Compare DC scales, fixed left/right extrema, a slope-sign rule, and one CUSUM/FOCuS
  variant.
- Compare logistic regression with one GBDT on the provisional-HL/LH candidates.
- Measure delay, location error, coverage, and false alarms per open hour.
- Use chronological purged splits and an untouched newest holdout.

Its result decides which scales to keep or add. Changing the grid changes the pivot
stages' identities, so they and every descendant (labels included) rebuild; scales
removed from the grid leave no stored rows or labels behind.

## 4. Extensibility: stages

**Today:**

- One builder hash covers 15 files: all of `strategy-core` plus ingest and storage. Any
  edit, including one that only adds minute storage, marks every second row stale.
- New values go into two wide tables, so each addition means a migration and a
  rebuild of everything.
- The engine (`FeaturePipeline`) and storage (`SecondRowBuilder`) assemble the same
  pieces separately. The engine's `1h@1m` has only 8 features.

**Proposal:** treat the pipeline like assembly-line stations. Each station has its own
inspection stamp, and changing one station re-runs only that station and the ones after
it.

- A `Stage` in `strategy-core` declares:
  - its name and its input stages;
  - its columns, with units;
  - `STATE` for checkpoints, plus a `VERSION`;
  - its module files;
  - `process(inputs) -> Table`.
- The graph starts at an explicit **`market` source**: one contract's `MarketChunk`,
  that is, its trades, the data-coverage windows, and the chunk's start and end. Every
  stage also receives the `SessionCalendar` as a declared input. Coverage and the calendar
  are what let `bar_1s` tell a quiet second (covered, no trades) from missing data
  (uncovered) and a closure (no row). The source's identity covers the DBN files'
  checksums and covered windows, the calendar and its ordinal origin, and the
  trade-assignment timing. It is not stored: ingest reads it from DBN, and live sessions
  from the feed. Accepted, assigned trades in release order (`bars.aggregate`) come from
  it. Then `market` → `bar_1s` → `candle_1m_1s`; `bar_1s` → `bar_1m` → `candle_1h_1m`;
  (`market`, `candle_1m_1s`) → `pivot_1s`; (`market`, `candle_1h_1m`) → `pivot_1m`; (`market`, `pivot_1s`, `pivot_1m`) →
  `pivot_label`.
  Pivot stages read the trade path from `market`, never from aggregated bars
  ([3.1](#31-input-stream)), and missing coverage from it too ([3.2](#32-detector-directional-change-with-a-frozen-scale)).
- **Identity per stage** is a hash of the stage's modules, settings, columns, and package
  versions, plus its inputs' identities. A new stage never touches existing ones. Editing
  a shared kernel correctly invalidates every stage that uses it.
- **Each stage owns its tables**: a dense table keyed `(contract_id, slot_ordinal, end_ns)`,
  with monthly partitions, plus any event tables it emits. `pivot_1s` and `pivot_1m` each
  own their rows of `market.pivot_event` (marked by stage and builder). Building or
  rebuilding a session deletes and replaces that stage's dense rows _and_ events for the
  session in one transaction, so events always match the features. Continuous views are generated from the column registry, so migrations stay
  consistent.
- **Bookkeeping:** a new `market.stage_slice` table, keyed by stage, contract, and
  session. It holds the builder, ordinal bounds, checkpoint, report, and source files.
  `ingest_slice` stays as is.
- **Ingest** recomputes upstream stages in memory from DBN (0.35 s per session) instead
  of reading 57 GB back, and writes only stale stages. Each session commits all of its
  stage rows and checkpoints in one transaction.
- **The engine runs the same graph**, so live sessions compute exactly what is stored.

This is not a rewrite. `SecondRowBuilder` becomes two stage classes around unchanged
numerical code, and the tables stay as they are. PR A must prove that rows are unchanged
with the empty-window policy off. Then it turns the policy on and rebuilds once. Adding a
column to an existing stage stays as documented in [ingestion](ingestion.md#adding-a-metric-or-feature).
It changes that stage's identity, so the stage and every stage downstream of it rebuild;
stages upstream and on other branches stay current. For example, a new `bar_1s` column rebuilds every stored stage, while a new pivot column rebuilds the pivot
stages and `pivot_label`.

## 5. `1h@1m`: amendments to the proposed plan

Keep the update's five parts (aggregation, shared hourly calculations, schema and views,
resumable versioned stage, pilot then backfill). Amend them as follows:

1. **Aggregation reuses existing rules.** Base fields go through `bars.combine`. Metric
   fields go through a new disjoint `combine_metrics` that reuses `MetricWindow`'s bridge,
   CVD-extreme, and first/last-by-validity rules. Group by ordinal (`m = ⌈o / 60⌉`) and
   assert that this equals clock grouping (calendar boundaries are whole minutes).
   As in the engine's `Rollup`, a minute with any missing second is missing.
2. **Free full-year validation.** The `1m@1s` candle at every ordinal `60m` _is_ minute
   `m`. After backfill, SQL compares every integer field of `bar_1m` with those candle rows
   for all 775,050 minutes. With one summation order, floats are compared too.
3. **Feature set:**
   - Reuse `CandleIndicators`, with `active_ratio` redefined as observed seconds ÷ 3600
     (`bar_1m` gets `observed_seconds`).
   - Drop the session features and the latest-book ages: at a minute end they duplicate
     the second row.
4. **New hourly-only metrics.** These are not window sums of second statistics:
   - Realized volatility from consecutive observed one-second closes within the hour, and
     its ratio to ATR. Volatility measured second by second against volatility measured in
     ranges shows noise versus trend.
   - From the 60 disjoint minute returns: standard deviation, skew, lag-1 autocorrelation,
     variance ratio VR(5) (above 1 trending, below 1 mean-reverting: directly relevant to
     pullback entries), and the share of up minutes.
   - Maximum drawdown and drawup inside the window, in ATR: how deep the pullbacks were.
   - Where the high and low fell within the window (0 to 1).
   - Session-anchored VWAP distance, and the prior session's high, low, and close
     distances, all in hourly ATR.
   - Correlation of minute closes with minute cumulative delta inside the window.
5. **Engine parity.** The engine's `1h@1m` features equal the stored columns, and the
   engine reads the full stage.
6. **Warm-up.** Measure NULL rates at each roll's first front session. The lead is set in
   PR A ([section 6](#6-decisions)). If PR B shows it is too short, raising it prepends
   sessions to every contract, which rebuilds every stored stage, not only the new ones;
   budget that rebuild explicitly.

## 6. Decisions

Decided by Paul on November 3, 2026:

1. **Empty windows:** carry the last trade price as an indicator input
   ([Finding 1](#finding-1-quiet-windows-blank-out-si-features-policy-decision)), flagged,
   with its age, never across missing data. Applied in PR A.
2. **Order:** stages first (PR A), then `1h@1m` (PR B), then pivots (PR C).
3. **Pivot storage:** dense per-second features plus the sparse event table.
4. **Initial scales:** 0.5, 1, and 2 times the window's ATR, at both resolutions. The
   2-spread floor in [3.4](#34-stored-values) stays as a noise guard unless it is changed.
5. **Disk:** not a constraint; space will be added for all products as needed.

Still open: **lead sessions**, to be chosen before PR A's rebuild. Every stage shares a
contract's span, and prepending sessions later changes the history behind every stored
row, which means rebuilding all stored stages (`spans()`/`diff()` treat an earlier start as a
rebuild from the beginning). Recommendation: **20 sessions**. That covers hourly EMA(50)
(about 2.2 sessions), several slow-scale swings, and the 14–20 prior sessions that daily
and time-of-day ATR need ([section 7](#7-after-pivots-more-atr-metrics)), so PRs B–E add
only new tables. The cost is about a third more contract-sessions in the PR A rebuild.

## 7. After pivots: more ATR metrics

ATR sets stop distances, position sizes, and the pivot thresholds, so one ATR(14) per
window is too little. Proposed for PR E as its own stage per resolution (`vol_1s`,
`vol_1m`), each value normalized and scale-invariance tested:

- **Several horizons.** Same-phase Wilder ATR(5), ATR(14) (stored now), and ATR(50), in
  bps, with `log(ATR5 / ATR14)` and `log(ATR14 / ATR50)` showing volatility expanding
  or contracting.
- **Time-of-day normal.** Volatility at the US open is several times that of the Asian
  session, so ATR(14) right after 08:30 CT still reflects the quiet minutes before. Add
  ATR relative to the typical ATR at the same minute of the session over the previous
  20 sessions (log ratio).
- **Daily scale.** ATR(14) of prior complete sessions' true ranges (bps); the current
  session's range so far as a share of it (how much of a typical day's move is used);
  distances to the session high and low in daily ATRs.
- **The current candle against its ATR.** True range ÷ ATR (an expansion candle), and
  the ATR's percentile within its own trailing sessions (a causal rank, 0–1).
- **Other estimators.** Parkinson and Garman–Klass volatility from OHLC, and the ratio of
  realized volatility from one-second returns to ATR (noise versus trend; the `1h@1m`
  version is in PR B).
- **Up versus down.** Average upward against downward true range: whether volatility
  comes from rallies or selloffs.
- **Cost relative to movement.** Spread ÷ ATR: the share of a typical move paid to cross
  the spread, which decides which swing scales are tradable.
- **Risk context, not features.** ATR in price units and in dollars per contract (ATR ×
  multiplier) for stop distances and position sizing in execution. Raw units stay out of
  model inputs.

Two points for PR E:

- **History for daily and time-of-day ATR.** These need 14–20 prior sessions of the same
  contract, more than the current lead. Compute them within each contract and give the
  volatility stages a longer lead (and the same for any stage that reads them). Never
  build them from the front-contract sequence: a roll-day true range would compare the new
  contract's high and low with the old contract's close, a false volatility spike.
- **Pivot thresholds.** PR C uses ATR(14). Once PR E exists, the benchmark can compare
  thresholds scaled by the time-of-day ATR, which may stop the open from producing a
  burst of small swings. Only the pivot stages and their descendants would be rebuilt.
