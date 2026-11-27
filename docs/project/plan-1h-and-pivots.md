# Design notes that the code cites

The code points to this file by section and finding number, so the numbers below keep
the numbering of the original plan. The plan itself (the proposal, its decisions, the
step-by-step work and its results) is finished and archived in
[plan-1h-and-pivots-original.md](../archive/plan-1h-and-pivots-original.md). What stays
here is the reasoning that the code still relies on. Other documents describe the
current system: the [feature pipeline](feature-pipeline.md) (tiers, stages, database
rules) and the [swing and structure contract](pivot-structure-design.md).

## 1. Findings from the review of the stored rows

### Finding 1: an empty window is a flat candle

A 60-second window without a trade (`status` empty) is a known fact: the price did not
change. A missing window is an unknown. If both were treated as unknown, one quiet minute
would erase the next 14 to 26 values of its phase, because lookback indicators need every
same-phase candle in their range. Measured on September 2026 front sessions, before the
rule was changed:

| Product | Empty windows | `rsi` NULL | `ema50_atr` NULL | `aroon_up` NULL | `flow_price_corr` NULL |
| ------- | ------------- | ---------- | ---------------- | --------------- | ---------------------- |
| GC      | 0.06%         | 0.12%      | 0.06%            | 1.16%           | 1.17%                  |
| SI      | 3.18%         | 5.74%      | 3.18%            | 30.83%          | 28.12%                 |

The NULLs also cluster in quiet hours, so a model trained on complete rows would see
mostly busy markets.

The rule: a healthy empty window keeps the last trade price as its indicator input, so
it contributes zero change (a flat candle). It stays flagged, and its age is recorded
(`price_age_s`). Its observed OHLC stays NULL, and nothing is ever carried across missing
data. Missing data keeps the gap policy: it ends a segment (see section 3.2).

### Finding 2: sums over the same histories

Rolling `pv` sums use `sliding_window_view(...).sum()` (`windows.py`), metric windows add
newest-first (`window_metrics.py`), `bars.combine` uses `reduceat`, and minute
aggregation adds a fourth path. Each is deterministic, and tests show that chunking does
not change results. But two different summation orders can differ in the last bits of a
float. So every path that sums the same history uses one ordered-sum helper, and then
`bar_1m` floats equal the `1m@1s` candle at the same minute end exactly.

## 3. Pivot and structure design

Section 3.5, a design for outcome labels and a reversal benchmark, was withdrawn on
November 23, 2026 and is not kept here (see the archived plan). The swings are computed
by rule only.

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
  `1m@1s` ATR as of the previous second, with a spread floor. The middle timeframe has
  its own table (`pivot_10s`) built the same way on `10m@10s`.
- **Slow scales** run on the same trade stream, with thresholds from the `1h@1m` ATR of
  the latest completed minute and the same spread floor, and are stored at each minute's
  end (`pivot_1m`).
- Prices stay in exact fixed-point integers inside the detector, so ties are exact.
  Outputs are normalized (`Unit`).
- Second-resolution entries read the slow structure as of the latest completed minute,
  with its age, exactly as `1h@1m` bias features are joined.

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
positive again. GC and SI have never traded at nonpositive prices.

**Threshold inputs.** `ATR_bps` is the window's ATR (`1m@1s` for fast scales, `1h@1m`
for slow), and `spread_bps` is the last sampled book spread (`book_spread_bps`), both from
the previous completed row: the previous second for fast scales, the latest previously
completed minute for slow scales. A segment ([3.3](#33-structure-higher-lows-and-lower-highs))
starts only at the first row where both are defined: at a contract's start, after warm-up,
and after missing data. Until then the detector is idle; it keeps no candidate, so no
later scale is applied to an earlier extreme. Within a segment both stay defined, because
with flat candles for quiet windows (Finding 1) only missing data makes them undefined. As
a safeguard, if either is ever undefined, the segment ends exactly as for missing data.

| Situation         | Rule                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Closure (no rows) | State continues; a reopening jump can confirm a pivot, because it is a real move                          |
| Missing data      | Starts a new structure segment: earlier events stay recorded, the open candidate is dropped, direction unknown |
| Empty bar         | No new price, no change; ages advance (Finding 1)                                                         |
| Roll              | Per contract; a new contract warms up during its lead sessions                                            |
| Emitted events    | Immutable; a later break of the level is a new event, never an edit                                       |

### 3.3 Structure: higher lows and lower highs

The same detector and structure layer also run on the RSI and CVD series
([swing sources](pivot-structure-design.md#swing-sources-price-rsi-and-cvd)), each with
thresholds in multiples of its own ATR. The
[pivot and structure contract](pivot-structure-design.md) defines the exact classes,
trend, provisional relations, breaches, and their field names; this section summarizes it.

Within one **segment** (a stretch with data coverage and defined threshold inputs),
confirmed pivots alternate high, low, high, … per scale. Missing data ends the segment,
because the swing during the gap is unobserved: the next segment's first pivot may be of
either kind, and it is never compared with pivots before the gap. Each structure value
needs only its own references: a confirmed level can be breached as soon as it is
confirmed (with `trend_before` NULL if the trend is not yet known), a same-kind class
needs two confirmed pivots of that kind, and `trend` needs a classified high and low.
Until then each is NULL; the last confirmed levels before the gap remain in
`pivot_event`, with their segment. Each confirmed low `L_k` is a **higher low** if
`L_k > L_{k−1}`, a lower low if it is lower, and an equal low if the two are equal. Highs
are classified the same way. Trend state: **up** after a higher high and a higher low,
**down** after a lower high and a lower low, otherwise **mixed**. A breach (`break_up`,
`break_down`) is a trade strictly beyond the latest confirmed high or low. In a down
structure, `break_up` is the first sign of reversal.

The early signal is a **provisional higher low**: the current down leg's running low is
still above the last confirmed low, and price has already reversed part of `θ`. It is
stored in every trend context; a filter such as "only in an up or mixed structure" belongs
to the strategy or model, which also receives `trend`. `progress` (see 3.6) measures how
far the open move has come toward confirming. Lower highs mirror this.

### 3.4 Stored values

Each scale is a **variant row**: `pivot_1s`, `pivot_10s`, and `pivot_1m` are keyed
`(contract_id, variant_id, slot_ordinal, end_ns)`, with each scale's parameters (stream,
multiplier, threshold normalizer, spread floor, and the reclaim window `W`) in a registry
table ([feature pipeline](feature-pipeline.md#database-properties)). Adding a scale adds
rows, not columns, and leaves the existing scales current. Per scale, normalized:

- `dir`, `progress`, `ext_dist_atr`, `ext_age_s`
- `leg_atr`, `leg_age_s`, `leg_delta_ratio` (aggressor flow over the leg: divergence input),
  `prev_leg_atr`, `retrace` (current leg ÷ previous leg)
- `low_dist_atr`, `high_dist_atr` (close vs the last confirmed low and high), with ages
  since each extreme and since its confirmation
- `low_change_atr` = `(L_k − L_{k−1}) / ATR`, `high_change_atr` = `(H_k − H_{k−1}) / ATR`
  (ATR snapshot of the new pivot), latest low and high classes, `trend` (−1, 0, +1; NULL
  until both comparisons exist), `low_run_ratio`, `high_run_ratio`, `trend_age_s`,
  provisional HL/LH flags, and breach ages
- `theta_bps`, and validity/warm-up flags

Every age (`*_age_s`) counts scheduled-open rows, like `slot_ordinal`: seconds of open
time for the fast stream, and minutes × 60 for the slow stream. Closures add nothing, so
an extreme set just before an 18:15 close is 60 s old one minute after the 23:00 reopen.
If wall-clock age is ever needed, it gets a separately named column.

Also stored is a sparse **`market.pivot_event`** table, one row per event of a scale:
confirmed highs and lows, breaches (`breach_up`, `breach_down`), and reclaims. Every event
has its ID, kind, observation ordinal and the exact time of the trade that produced it,
`available_at`, and the epoch. Pivots add their extreme ordinal and time, the raw level (as
data context, not a feature), θ and its ATR snapshot, leg statistics, and the structure
class. Breaches and reclaims add the ID of the pivot they refer to and the breach depth.
Charts and SQL research use it.

**Scales.** Fast: `k ∈ {0.5, 1, 2, 3}` × the `1m@1s` ATR; the middle and slow timeframes
use the same multiples of their own ATR. Every scale has the same spread floor `f = 2`
(θ ≥ 2 spreads; it rarely binds at slow scales). The median `1m@1s` ATR in September 2026
was 4.3 bps for GC and 6.4 bps for SI, so 0.5 × ATR is about 8 GC ticks but only about 3
SI ticks, which is why the spread floor matters.

### 3.6 What is stored for price swings

Sections 3.1 to 3.4 and the [contract](pivot-structure-design.md) are implemented for
price in `strategy_core/swings.py` (the detector) and `stage_step_pivot.py`. Details:

- **Each scale is a stage of its own** (a variant), for example `pivot_1s:fast_atr_0p5`
  and `pivot_1m:slow_atr_1`, writing to its timeframe's table under its `variant_id`
  ([variants are stages](feature-pipeline.md#stages)).
- **Threshold inputs.** Fast: the previous second's `candle_1m_1s.atr_bps` and
  `book_spread_bps`. Slow: `candle_1h_1m.atr_bps` of the latest minute completed before the
  trade's own minute, and the last sampled spread carried along the minute rows
  (`bar_1m.last_bid`, `last_ask`; never across a missing minute), so the minute branch
  reads nothing from the second-resolution candle. A threshold or ATR that is undefined or
  not above zero ends the segment.
- **ATRs.** Reversals and `theta` are in log basis points. Every `*_atr` value is a price
  difference divided by the ATR in price units (`vol_1s.atr_price`, `vol_1m.atr_price`) of
  the same input row, frozen with the extreme it describes.
- **`progress`** is the deepest pullback since the running extreme, divided by the frozen
  threshold θ (0 to 1; 1 means confirmed). It is not a probability. `ext_dist_atr` is the
  current distance of the last trade from the extreme. Beside the features of 3.4 each
  scale stores `reversal_delta_ratio` (flow since the running extreme) and
  `cand_change_atr` (the running extreme against the latest confirmed pivot of its kind:
  the provisional version of `low_change_atr` and `high_change_atr`). Whole-number values
  are stored as `smallint` or `integer`, which is exact and keeps rows small.
- **Levels are context.** The dense rows keep only the running extreme (`ext_px`);
  confirmed levels are in `market.pivot_event`. The latest confirmed high or low of a row
  is the last such event of its scale and segment at or before it; the rows do not repeat
  event keys.
- **Event identity** is (`builder_id`, `contract_id`, `variant_id`, `slot_ordinal`, `seq`):
  the builder that wrote it, the row of the observation that produced it, and its order in
  that row. A breach or reclaim names its pivot by (`ref_ordinal`, `ref_seq`).
- **Reclaims.** A level is breached once and reclaimed at most once: by the first trade
  strictly back inside within `W` published rows of the breach (60 seconds fast, 15 minutes
  slow), unless a new pivot of its kind confirmed first.
- **Missing data on a slow scale** ends the segment at the missing second and keeps the
  scale idle for the rest of that minute; the hourly window then keeps it idle until the
  missing minute has left it.
- **A nonpositive price** ends the segment (`state` 0); there is no separate flag.
- **`warm`** is reported by the stage ([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)).
- **A scale's name never changes meaning.** Its parameters are fixed in `market.variant`
  when it is first registered; a stage whose settings differ is refused, so a changed
  scale gets a new name and is added next to the old one.
- **A retired scale** (removed from `SCALES`) is marked in `market.variant.retired_at`, not
  deleted: its rows and events stay until removed on purpose, the planner ignores them,
  and the continuous views leave them out. Registering it again clears the mark.
- **The engine** reads every scale: `1m@1s.<scale>.<feature>` row by row, and
  `1h@1m.<scale>.<feature>` as of the latest completed minute.

## 5. `1h@1m` hourly statistics

### 5.4 Hourly-only metrics: statistics as sums of second statistics

The stage `stats_1h_1m` (tier 1, reading `bar_1m` and `candle_1h_1m`; code in
`stage_step_stats.py`) stores metrics that are not window sums of second statistics:

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

Details: a window's minute returns run between consecutive minute closes inside it,
carried through minutes without trades from its first observed minute (59 when the oldest
minute traded), so a window never reads rows older than its own. The return statistics
need 10 of them (two VR(5) horizons). The share of up minutes counts minutes whose close
changed. Features need a complete window. `active_ratio` is observed seconds ÷ 3600
(`bar_1m` has `observed_seconds`). The session features and latest-book ages are not
repeated at the hour: at a minute end they duplicate the second row. The metric fields of
an hour are built by combining the minute rows (`combine_metrics`, which reuses the
bridge, CVD-extreme, and first/last-by-validity rules of the second windows), and a
minute with any missing second is missing.

## 7. The volatility family

ATR sets stop distances, position sizes, and the swing thresholds, so one ATR(14) per
window is too little. The volatility family is tier 1, with its own stage per resolution
(`vol_1s`, `vol_1m`), computed before structure so swing thresholds can use it. Each
value is per phase on same-phase windows, like ATR, normalized, and scale-invariance
tested. Every measure describes the price path inside a window; a window's open, close,
and wicks are not treated as signals.

**Adverse excursion along the path (primary).** Range-based ATR sees only a window's
extremes against its starting price. It misses a window in which price rallies, drops 8
ticks, and recovers: a long was stopped out even though the window ended higher. The path
order is known exactly from the trades:

- **Tier-0 fields:** each second's `drawdown` (the largest drop from a trade to any later,
  lower trade in that second) and `drawup`. They merge exactly into minutes and windows
  together with the high and low:
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
  within the window counts the same as one that did not.

**The window's extremes as levels.**

- `high_dist_atr`, `low_dist_atr`: the current price's distance to the window's high and
  low, in ATR.
- `high_age_s`, `low_age_s`: how long ago, in scheduled-open time, each was set.
- `extreme_order`: +1 when the low came before the high, −1 when the high came first, 0
  when both are the same observation (a flat or single-trade window). Within one second
  it comes from a tier-0 field set from the trades' release order (timestamps can tie).

**Also in the family:**

- **Several horizons.** ATR(5), ATR(14), and ATR(50), in bps, with `log(ATR5 / ATR14)`
  and `log(ATR14 / ATR50)` showing volatility expanding or contracting.
- **Time-of-day normal.** Volatility at the US open is several times that of the Asian
  session, so ATR(14) right after 08:30 CT still reflects the quiet minutes before. ATR
  is stored relative to its typical level at the same minute of the session over the
  previous 20 sessions (log ratio). The key is the minute's offset in scheduled-open
  minutes from the session's first open, at both resolutions. Each session contributes
  one sample per minute: the window ATR at that minute's last row (`vol_1m`: the `1h@1m`
  ATR at the minute row; `vol_1s`: the `1m@1s` ATR at ordinal `60m`, the window that is
  exactly that minute). Every row compares its current ATR with the mean of its minute's
  samples from earlier sessions only. Minutes missing from a session (early closes) add
  no sample.
- **Daily scale.** The simple mean of the prior 14 complete sessions' true ranges (bps; a
  fixed window, since a Wilder average at daily scale would need about 107 sessions to
  forget its start); the current session's range so far as a share of it; distances to
  the session high and low in daily ATRs.
- **The current window against its ATR.** True range ÷ ATR, and the ATR's percentile
  within its own trailing sessions (a causal rank, 0 to 1).
- **Other estimators.** Parkinson and Garman–Klass volatility from OHLC, and the ratio of
  realized volatility from one-second returns to ATR (noise versus trend).
- **Cost relative to movement.** Spread ÷ ATR: the share of a typical move paid to cross
  the spread, which decides which swing scales are tradable.
- **Risk context, not features.** ATR in price units and in dollars per contract (ATR ×
  multiplier) for stop distances and position sizing in execution. Raw units stay out of
  model inputs.

**History.** Daily and time-of-day ATR need up to 35 prior sessions of the same contract,
including their inputs' warm-up, which the lead sessions provide. They are computed
within each contract, never from the front-contract sequence: a roll-day true range would
compare the new contract's high and low with the old contract's close, a false volatility
spike.

**Minute resolution** (`vol_1m`; calculations in `strategy_core/volatility.py`, shared
with `vol_1s`; reads `bar_1m` and `candle_1h_1m`). Averages (ATR(5), ATR(50),
bullish/bearish, adverse excursion, the time-of-day normal) are defined like the ATR, for
complete windows and empty ones at the carried price. Values of the window itself and of
the session so far need a complete window; the daily ATR and its percentile belong to the
session. A daily true range needs a complete session (seen from its open, no missing
data) whose previous calendar interval was complete; the daily ATR averages the last 14
such ranges, each in bps of its session's close, and the percentile ranks it among the
previous 20 sessions' values (ties count half). The time-of-day normal averages the last
20 samples of `atr_bps` at the same session minute, read before the current one joins.
Ages count rows: the scheduled-open seconds from the extreme's second to the window's
newest; at `1h@1m` they carry `stats_1h_1m.high_pos` and `low_pos` (age = 3599 × (1 −
pos)), kept so both resolutions share columns. Dollars per contract come from the contract
symbol's product (`market.PRODUCTS`). Warm-up of the daily percentile: 35 sessions
declared as 35 × 86,400 s (37 typical sessions).

**Second resolution** (`vol_1s`; reads `bar_1s` and `candle_1m_1s`). The same features
with the same names and rules, per phase `o % 60` on same-phase `1m@1s` windows, plus
`rv_bps` and `rv_atr`: realized volatility from the window's one-second returns (between
consecutive observed second closes inside the window, none into its first observed
second), in bps and against the `1m@1s` ATR (the hourly one is `stats_1h_1m.rv_atr`),
with its return count `rv_returns` as context. Time-of-day samples are the `1m@1s` ATR at
ordinal `60m`, keyed by the minute's offset; every second of a minute compares its own
phase's ATR with that minute's samples from earlier sessions. The daily scale is computed
from the second rows and equals `vol_1m`'s at every minute's last second. Ages count
rows, 0 to 59. Warm-up: 37 typical sessions, as for `vol_1m`.

**Swing thresholds.** The swing grid uses ATR(14). Because the threshold normalizer is a
variant parameter, variants can be added without a migration. Candidates not built:
time-of-day ATR, which may stop the open from producing a burst of small swings; and
directional thresholds, where a high confirms on a decline sized by bullish ATR and a low
on a rise sized by bearish ATR.
