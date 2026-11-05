# Plan: extensible stages, `1h@1m` rows, and swing structure (higher lows, lower highs)

Proposed November 3, 2026; decisions recorded the same day ([section 6](#6-decisions)).
Status November 4: PR A is done (#70), the schema folded into a baseline (#71), and
GC/SI rebuilt on it ([results](handoff.md#baseline-rebuild-gc-and-si)). PR B1 (#74) added
the minute stages and moved the engine onto the stages
([results](handoff.md#pr-b1-results-minute-stages)); B2, the hourly-only metrics of
section 5.4, is next ([handoff](handoff.md#pr-b-1h1m-rows)). It answers four questions: are the stored `1m@1s` rows
right, how to make the system extensible, when to build `1h@1m`, and how to add high/low
pivot detection at both resolutions. The [feature pipeline](feature-pipeline.md) sets the
calculation tiers and database rules, and [section 7](#7-volatility-tier-atr-family) the
volatility (ATR) tier, including bullish and bearish ATR.

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
4. **Calculations run in tiers** ([feature pipeline](feature-pipeline.md)): base rows (0),
   candles, indicators, and the volatility family (1), market structure sized by that
   volatility (2), then signals that combine indicators and structure, such as higher-low
   sequences (3). Labels are kept apart. Each tier reads only the tiers below it.
5. **Then swing structure**: a multi-scale directional-change detector plus a deterministic
   _market-structure_ layer that labels each confirmed swing as a higher/lower high/low.
   Store a small fixed grid of scales at both resolutions, then benchmark and train on
   the stored values ([section 3](#3-pivot-and-structure-design)).

| PR  | Tier | Contents                                                                                                                                                                                         | Rebuild         |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| A   | 0–1  | Stages and tiers, per-stage versions and checkpoints, column and variant registries, summation order, empty-window policy, drawdown/drawup and high/low-order fields, derived lead (40 to start) | every stage     |
| B   | 0–1  | `bar_1m`, `candle_1h_1m` (the `1h@1m` stage, B1), and the hourly-only metrics as stage `stats_1h_1m` (B2)                                                                                        | new tables only |
| C   | 1    | Volatility family: `vol_1s`, `vol_1m`, including bullish/bearish and adverse-excursion ATR ([section 7](#7-volatility-tier-atr-family))                                                          | new tables only |
| D   | 2    | Swing detector and structure of price and RSI: `pivot_1s`, `pivot_1m`, `pivot_rsi_1s`, `pivot_rsi_1m`, `pivot_event`                                                                             | new tables only |
| E   | 3    | Structure signals: `signal_1s`, `signal_1m` ([contract](pivot-structure-design.md#tier-3-structure-signals))                                                                                     | new tables only |
| F   | —    | Pivot outcome labels and the benchmark (future-looking, stored apart from inputs)                                                                                                                | new tables only |

Volatility comes before structure because swing thresholds are sized by it. `vol_1s` can
start right after A; `vol_1m` and the slow pivot scales need B.

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
Then `bar_1m` floats equal the `1m@1s` candle at the same minute end exactly. This is an
intentional, versioned numerical change: it can alter the last bits of float sums, so PR A
makes it in a separate step after the unchanged-rows proof ([section 4](#4-extensibility-stages)).

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
- **Availability follows the publication row.** Fast state is published once per second
  row, after that second's trades, at the second's close plus the close delay; slow state
  once per minute row, at the minute's close plus the close delay. A crossing trade's
  exact time is recorded, but no feature uses it before its row is published, so slow
  confirmations and breaches never appear on the second rows inside their minute.
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

**Positive prices only.** Reversals are measured in log-bps, which needs positive prices,
as every bps feature does. A trade at a price of zero or below (valid for some futures)
ends the segment, exactly like missing data, and the detector stays idle until prices are
positive again; a flag records it. GC and SI have never traded at nonpositive prices.

**Threshold inputs.** `ATR_bps` is the window's ATR (`1m@1s` for fast scales, `1h@1m`
for slow), and `spread_bps` is the last sampled book spread (`book_spread_bps`), both from
the previous completed row: the previous second for fast scales, the latest previously
completed minute for slow scales. A segment ([3.3](#33-structure-higher-lows-and-lower-highs)) starts
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

The same detector and structure layer also run on the RSI series
([swing sources](pivot-structure-design.md#swing-sources-price-and-rsi)): RSI pivots with
thresholds in RSI points (5, 10, 20), their higher lows and lower highs, and in tier 3
the structural divergences between price and RSI.

The [pivot/structure contract](pivot-structure-design.md) defines the exact classes, trend,
provisional relations, breaches, and their field names; this section summarizes them.

Within one **segment** (a stretch with data coverage and defined threshold inputs),
confirmed pivots alternate high,
low, high, … per scale. Missing data ends the segment, because the swing during the gap is
unobserved: the next segment's first pivot may be of either kind, and it is never compared
with pivots before the gap. Each structure value needs only its own references: a
confirmed level can be breached as soon as it is confirmed (with `trend_before` NULL if the
trend is not yet known), a same-kind class needs two confirmed pivots of that kind, and
`trend` needs a classified high and low. Until then each is NULL; the last confirmed levels before the gap remain in `pivot_event`, with
their segment. Each confirmed low `L_k` is a
**higher low** if `L_k > L_{k−1}`, a lower low if it is lower, and an equal low if the
two are equal. Highs are classified the same way. Trend state: **up** after a higher
high and a higher low, **down** after a lower high and a lower low, otherwise
**mixed**. A breach (`break_up`, `break_down`) is a trade strictly beyond the latest confirmed
high or low.
In a down structure, `break_up` is the first sign of reversal.

The early signal you are after is a **provisional higher low**: the current down leg's
running low is still above the last confirmed low, and price has already reversed part of
`θ`. It is stored in every trend context; a filter such as "only in an up or mixed
structure" belongs to the strategy or model, which also receives `trend`. The reversal progress (0 to 1, where 1 is
confirmation) is the key ML input: the model learns how likely confirmation is from
progress, flow, and context. Lower highs mirror this.

### 3.4 Stored values

Each scale is a **variant row**: `pivot_1s` and `pivot_1m` are keyed
`(contract_id, variant_id, slot_ordinal, end_ns)`, with each scale's parameters (stream,
multiplier, threshold normalizer, spread floor, and the reclaim window `W`) in a registry
table
([feature pipeline](feature-pipeline.md#database-properties)). Adding a scale later adds
rows, not columns, and leaves the existing scales current. Per scale, normalized:

- `dir`, `progress` (reversal since the running extreme ÷ θ), `ext_dist_atr`, `ext_age_s`
- `leg_atr`, `leg_age_s`, `leg_delta_ratio` (aggressor flow over the leg: divergence input),
  `prev_leg_atr`, `retrace` (current leg ÷ previous leg)
- `low_dist_atr`, `high_dist_atr` (close vs the last confirmed low and high), with ages
  since each extreme and since its confirmation
- `low_change_atr` = `(L_k − L_{k−1}) / ATR`, `high_change_atr` = `(H_k − H_{k−1}) / ATR`
  (ATR snapshot of the new pivot), latest low and high classes, `trend` (−1, 0, +1; NULL
  until both comparisons exist), `low_run_ratio`, `high_run_ratio`, `trend_age_s`, provisional HL/LH
  flags, and breach ages
- `theta_bps`, and validity/warm-up flags

Signals that combine structure with indicators (pullback quality, divergences, failed
breaks, cross-scale counts) are tier 3, in their own stages (PR E); the
[contract](pivot-structure-design.md#tier-3-structure-signals) defines them.

Every age (`*_age_s`) counts scheduled-open rows, like `slot_ordinal`: seconds of open
time for the fast stream, and minutes × 60 for the slow stream. Closures add nothing, so
an extreme set just before an 18:15 close is 60 s old one minute after the 23:00 reopen.
If wall-clock age is ever needed, it gets a separately named column.

Also stored is a sparse **`market.pivot_event`** table, one row per event of a scale:
confirmed highs and lows, breaches (`breach_up`, `breach_down`), and reclaims. Every event
has its ID, kind, observation ordinal and the exact time of the trade that produced it,
`available_at`, and the epoch. Pivots add their extreme ordinal and time, the raw level (as
data context, not a feature), θ and its ATR snapshot, leg statistics, and the structure
class. Breaches and reclaims add the ID of the pivot they refer to and the breach depth. Charts, labels,
and SQL research use it.

**Initial grid** (illustrative, to be judged by the benchmark): fast `k ∈ {0.5, 1, 2}` ×
`1m@1s` ATR and slow `k ∈ {0.5, 1, 2}` × `1h@1m` ATR, every scale with the same spread
floor `f = 2` (θ ≥ 2 spreads; it rarely binds at slow scales). For scale:
the median `1m@1s` ATR in September 2026 was 4.3 bps for GC and 6.4 bps for SI. So
0.5 × ATR is about 8 GC ticks but only about 3 SI ticks, which is why the spread floor matters.

**Size:** three fast-scale rows per second of about 16 `double precision` columns come to
roughly 20–25 GB for a GC+SI year. Minute rows and events are under 1 GB. See decision 3.

### 3.5 Labels and benchmark (PR F)

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
- **Parameters are frozen in the PR F spec before any labels are computed**, and they
  stay identical in training and testing.

Labels are a stage (`pivot_label`) whose inputs are `market` and the pivot stages. The
benchmark follows the reviewed research:

- Compare DC scales, fixed left/right extrema, a slope-sign rule, and one CUSUM/FOCuS
  variant.
- Compare logistic regression with one GBDT on the provisional-HL/LH candidates.
- Measure delay, location error, coverage, and false alarms per open hour.
- Use chronological purged splits and an untouched newest holdout.

Its result decides which scales to keep or add. Identity is per variant
([feature pipeline](feature-pipeline.md#database-properties)): adding a scale builds only
that scale and what depends on it; removing one deletes its rows, events, and labels;
changing the detector's code rebuilds every scale. Cross-scale summaries change only when
a new version declares a different scale set.

## 4. Extensibility: stages

**Today:**

- One builder hash covers 15 files: all of `strategy-core` plus ingest and storage. Any
  edit, including one that only adds minute storage, marks every second row stale.
- New values go into two wide tables, so each addition means a migration and a
  rebuild of everything.
- The engine (`FeaturePipeline`) and storage (`SecondRowBuilder`) assemble the same
  pieces separately. The engine's `1h@1m` has only 8 features.

**Proposal:** treat the pipeline like assembly-line stations, ordered in tiers; the
[feature pipeline](feature-pipeline.md) defines the tiers, read rules, full stage graph,
and database properties. Each station has its own
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
  it. Then `market` → `bar_1s` → `candle_1m_1s`; (`bar_1s`, `candle_1m_1s`) → `vol_1s`;
  `bar_1s` → `bar_1m` → `candle_1h_1m`; (`bar_1m`, `candle_1h_1m`) → `vol_1m`; (`market`, `candle_1m_1s`, `vol_1s`) → `pivot_1s`;
  (`market`, `candle_1h_1m`, `vol_1m`) → `pivot_1m`; each resolution's lower tiers and
  pivots → `signal_1s`, `signal_1m` (second rows read minute values as of their
  availability); (`market`, `pivot_1s`, `pivot_1m`) → `pivot_label`. The
  [feature pipeline](feature-pipeline.md#stages) lists every stage's inputs.
  Pivot stages read the trade path from `market`, never from aggregated bars
  ([3.1](#31-input-stream)), and missing coverage from it too ([3.2](#32-detector-directional-change-with-a-frozen-scale)).
- **Identity per stage** is a hash of the stage's modules, settings, columns, and package
  versions, plus its inputs' identities; a stage with variants has one identity per
  variant (the stage's plus the variant's parameters). A new stage never touches existing ones. Editing
  a shared kernel correctly invalidates every stage that uses it.
- **Each stage owns its tables**: a dense table keyed `(contract_id, slot_ordinal, end_ns)`,
  with monthly partitions, plus any event tables it emits. `pivot_1s` and `pivot_1m` each
  own their rows of `market.pivot_event` (marked by stage and builder). Building or
  rebuilding a session deletes and replaces that stage's dense rows _and_ events for the
  session in one transaction, so events always match the features. For a stage with
  variants this is scoped to `(stage, variant, session)`: building one scale never
  touches another scale's rows or events. Continuous views are generated from the column registry, so migrations stay
  consistent.
- **Bookkeeping:** a new `market.stage_slice` table, keyed by stage, variant (none for
  stages without variants), contract, and session, so each variant keeps its own builder
  identity and checkpoint. It holds the builder, ordinal bounds, checkpoint, report, and source files.
  `ingest_slice` stays as is.
- **Ingest** recomputes upstream stages in memory from DBN (0.35 s per session) instead
  of reading 57 GB back, and writes only stale stages. Each session commits all of its
  stage rows and checkpoints in one transaction.
- **The engine runs the same graph**, so live sessions compute exactly what is stored.

This is not a rewrite. `SecondRowBuilder` becomes two stage classes around unchanged
numerical code, and the tables stay as they are. PR A works in three steps: (1) the stage
refactor, proven to leave every stored value bit-identical; (2) the canonical summation
order, a versioned change whose float differences are reported (expected within a few
ulps) while every integer column stays identical; (3) the empty-window policy, whose
differences are expected and reported. Then it rebuilds once. Adding a
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
2. **Full-year validation.** The `1m@1s` candle at every ordinal `60m` _is_ minute `m`,
   so after backfill SQL compares the fields both tables store (OHLC, high/low times,
   volume, buy/sell volume, trades, observed seconds, delta extremes, and VWAP) for all
   775,050 minutes. The candle table does not store `pv`, `session_cvd`, or the raw metric
   fields, so a reference check covers those: for every stored session, `combine_metrics`
   must equal `MetricWindow(60)`'s window values at each minute end (the same 60 seconds),
   field by field, and `session_cvd` must equal the second row's value at the minute end.
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

   Implemented in PR B2 as stage `stats_1h_1m` (tier 1, reading `bar_1m` and `candle_1h_1m`;
   [results](handoff.md#pr-b2-results-hourly-statistics)). Derived details: a window's minute
   returns run between consecutive minute closes inside it, carried through minutes without
   trades from its first observed minute (59 when the oldest minute traded), so a window never
   reads rows older than its own; the return statistics need 10 of them (two VR(5) horizons);
   the share of up minutes counts minutes whose close changed; features need a complete window.

5. **Engine parity.** The engine's `1h@1m` features equal the stored columns, and the
   engine reads the full stage.
6. **Warm-up.** Measure NULL rates at each roll's first front session. The lead is set in
   PR A ([section 6](#6-decisions)). If PR B shows it is too short, raising it prepends
   sessions to every contract, which rebuilds every stored stage, not only the new ones;
   budget that rebuild explicitly.

## 6. Decisions

Decided by Paul on November 3, 2026 (items 2 and 6 updated with the tier order and the
recommended lead, which Paul accepted):

1. **Empty windows:** carry the last trade price as an indicator input
   ([Finding 1](#finding-1-quiet-windows-blank-out-si-features-policy-decision)), flagged,
   with its age, never across missing data. Applied in PR A.
2. **Order:** stages first (PR A), then `1h@1m` (PR B), the volatility tier (PR C),
   structure (PR D), structure signals (PR E), and labels with the benchmark (PR F).
3. **Pivot storage:** dense per-second features plus the sparse event table, one row per
   scale ([3.4](#34-stored-values)).
4. **Initial scales:** 0.5, 1, and 2 times the window's ATR, at both resolutions. The
   2-spread floor in [3.4](#34-stored-values) stays as a noise guard unless it is changed.
5. **Disk:** not a constraint; space will be added for all products as needed.
6. **Lead sessions: 40**, applied in PR A's rebuild (raised from the 20 Paul accepted:
   review showed 20 is too short, see below). Every stage shares a contract's span, and
   prepending sessions later changes the history behind every stored row, which means
   rebuilding all stored stages (`spans()`/`diff()` treat an earlier start as a rebuild
   from the beginning). The lead must cover each value's own warm-up _plus_ the warm-up of
   what it summarizes. The longest planned chain is the daily ATR percentile: a daily
   ATR(14) needs 15 prior sessions before its first value, and a percentile over its
   trailing 20 values needs 20 more, 35 in all. The time-of-day ATR normal needs about 21
   (one session to warm the hourly ATR, then 20). Forty covers both with margin, so PRs
   B–F add only new tables. Each stage declares its need
   ([feature pipeline](feature-pipeline.md#database-properties)), and a test fails if any
   exceeds the lead. From PR A the required lead is derived from the indicators'
   parameters, not typed by hand ([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)):
   40 is the starting value, and the planner asks for a rebuild with the reason if a
   change (such as EMA(200), about 30 sessions) needs more. The cost is about 75% more
   contract-sessions in the PR A rebuild;
   lead sessions of a far delivery month trade thinly, which the session reports record.

## 7. Volatility tier: ATR family

ATR sets stop distances, position sizes, and the swing thresholds, so one ATR(14) per
window is too little. The volatility family is tier 1 (PR C), with its own stage per
resolution (`vol_1s`, `vol_1m`), computed before structure so swing thresholds can use
it. Each value is per phase on same-phase windows, like ATR, normalized, and
scale-invariance tested.

Following the [windows, not candles](feature-pipeline.md#principle-windows-not-candles)
principle, every measure here describes the price path inside a window. A window's open,
close, and wicks are not treated as signals.

**Adverse excursion along the path (primary).** Range-based ATR sees only a window's
extremes against its starting price. It misses a window in which price rallies, drops 8
ticks, and recovers: a long was stopped out even though the window ended higher, and
nothing says the low will not be revisited. The path order is known exactly from the
trades:

- **Tier-0 fields, added in PR A:** each second's `drawdown` (the largest drop from a
  trade to any later, lower trade in that second) and `drawup`. They merge exactly into
  minutes and windows together with the high and low:
  `drawdown(a then b) = max(drawdown_a, drawdown_b, high_a − low_b)`.
- **Long adverse excursion** of a window: the deepest drop a long would have sat through,
  from the price at the window's start or any later high to any later low:
  `max(drawdown, P₀ − low)`, where `P₀` is the last trade before the window (the previous
  same-phase window's last price). **Short adverse excursion** mirrors it with drawup.
- `long_adverse_atr_bps` and `short_adverse_atr_bps` are their Wilder(14) averages over
  same-phase windows. The current window's excursions ÷ ATR are also stored. These are
  the stop distances that recent windows would actually have hit, by side.

**Bullish and bearish ATR.** True range splits exactly into an upward and a downward
part, measured from the same starting price `P₀` (the window's first trade when there is
none): `up = max(H, P₀) − P₀`, `down = P₀ − min(L, P₀)`, and `TR = up + down`.

- **Bullish ATR** (`bull_atr_bps`) is the Wilder(14) average of `2 × down`: volatility as
  a long position feels it. Rallies count as zero and declines count double, so in a
  market that moves equally both ways it equals ATR. It rises when selling spikes
  dominate, which is when a long's stop needs more room.
- **Bearish ATR** (`bear_atr_bps`) is the Wilder(14) average of `2 × up`: the short side's
  view.
- With the same seeding, `(bull + bear) / 2 = ATR`. Their skew,
  `(bull − bear) / (bull + bear)` from −1 to 1, says which side drives the volatility.
- Unlike adverse excursion, these use only the extremes, so a deep drop that recovered
  within the window counts the same as one that did not. Both are stored so the
  benchmark and models can compare them.

**The window's extremes as levels.** The high and low a window reached remain levels after
price leaves them:

- `high_dist_atr`, `low_dist_atr`: the current price's distance to the window's high and
  low, in ATR.
- `high_age_s`, `low_age_s`: how long ago, in scheduled-open time, each was set
  (`high_at_ns` and `low_at_ns` are already stored).
- `extreme_order`: +1 when the low came before the high, −1 when the high came first, 0
  when both are the same observation (a flat or single-trade window). Across seconds the
  order follows the seconds; within one second it comes from a tier-0 field added in
  PR A, set from the trades' release order (timestamps can tie).

**Also in the family:**

- **Several horizons.** ATR(5), ATR(14) (stored now), and ATR(50), in bps, with
  `log(ATR5 / ATR14)` and `log(ATR14 / ATR50)` showing volatility expanding or
  contracting.
- **Time-of-day normal.** Volatility at the US open is several times that of the Asian
  session, so ATR(14) right after 08:30 CT still reflects the quiet minutes before. Store
  ATR relative to its typical level at the same minute of the session over the previous
  20 sessions (log ratio). The key is the minute's offset in scheduled-open minutes from
  the session's first open, at both resolutions. Each session contributes one sample per
  minute: the window ATR at that minute's last row (`vol_1m`: the `1h@1m` ATR at the
  minute row; `vol_1s`: the `1m@1s` ATR at ordinal `60m`, the window that is exactly that
  minute). Every row compares its current ATR with the mean of its minute's samples from
  earlier sessions only. Keying second rows by each scheduled second would need about
  82,800 × 20 values in every checkpoint for no gain in a 20-session typical level.
  Minutes missing from a session (early closes) simply add no sample.
- **Daily scale.** The simple mean of the prior 14 complete sessions' true ranges (bps;
  a fixed window, exact after 15 sessions, since a Wilder average at daily scale would
  need about 107 sessions to forget its start); the current
  session's range so far as a share of it (how much of a typical day's move is used);
  distances to the session high and low in daily ATRs.
- **The current window against its ATR.** True range ÷ ATR (an expanding range), and
  the ATR's percentile within its own trailing sessions (a causal rank, 0–1).
- **Other estimators.** Parkinson and Garman–Klass volatility from OHLC, and the ratio of
  realized volatility from one-second returns to ATR (noise versus trend; the `1h@1m`
  version is in PR B).
- **Cost relative to movement.** Spread ÷ ATR: the share of a typical move paid to cross
  the spread, which decides which swing scales are tradable.
- **Risk context, not features.** ATR in price units and in dollars per contract (ATR ×
  multiplier) for stop distances and position sizing in execution. Raw units stay out of
  model inputs.

**History.** Daily and time-of-day ATR need up to 35 prior sessions of the same contract,
including their inputs' warm-up, which the 40 lead sessions provide ([decision 6](#6-decisions)). They are computed within each contract, never from
the front-contract sequence: a roll-day true range would compare the new contract's high
and low with the old contract's close, a false volatility spike.

**Implemented at minute resolution in PR C1** as stage `vol_1m` (tier 1, reading `bar_1m` and
`candle_1h_1m`; calculations in `strategy_core/volatility.py`, shared with `vol_1s`). Derived
details: averages (ATR(5), ATR(50), bullish/bearish, adverse excursion, the time-of-day normal)
are defined like the ATR, for complete windows and empty ones at the carried price; values of the
window itself and of the session so far need a complete window; the daily ATR and its percentile
belong to the session. A daily true range needs a complete session (seen from its open, no
missing data) whose previous calendar interval was complete; the daily ATR averages the last 14
such ranges, each in bps of its session's close, and the percentile ranks it among the previous
20 sessions' values (ties count half). The time-of-day normal averages the last 20 samples of
`atr_bps` at the same session minute, read before the current one joins. Ages count rows: the
scheduled-open seconds from the extreme's second to the window's newest; at `1h@1m` they carry
`stats_1h_1m.high_pos` and `low_pos` (age = 3599 × (1 − pos)), kept so both resolutions share
columns. Dollars per contract come from the contract symbol's product (`market.PRODUCTS`).
Warm-up: the daily percentile, 35 sessions declared as 35 × 86,400 s (37 typical sessions).

**Implemented at second resolution in PR C2** as stage `vol_1s` (tier 1, reading `bar_1s` and
`candle_1m_1s`; `volatility.py` unchanged, so `vol_1m` stays current). The same 26 features with
the same names and rules, per phase `o % 60` on same-phase `1m@1s` windows, plus `rv_bps` and
`rv_atr`: realized volatility from the window's one-second returns (between consecutive observed
second closes inside the window, none into its first observed second), in bps and against the
`1m@1s` ATR (the hourly one is `stats_1h_1m.rv_atr`), with its return count `rv_returns` as
context. Time-of-day samples are the `1m@1s` ATR at ordinal `60m`, keyed by the minute's offset;
every second of a minute compares its own phase's ATR with that minute's samples from earlier
sessions. The daily scale is computed from the second rows and equals `vol_1m`'s at every
minute's last second. Ages count rows, 0–59. Warm-up: 37 typical sessions, as for `vol_1m`.

**Swing thresholds.** The initial pivot grid uses ATR(14) (decision 4). Because the
threshold normalizer is a variant parameter, the benchmark can add variants without a
migration. Candidates: time-of-day ATR, which may stop the open from producing a burst of
small swings; and directional thresholds, where a high confirms on a decline sized by
bullish ATR (the noise of declines) and a low on a rise sized by bearish ATR. Each new
variant builds only its own rows and their signals.
