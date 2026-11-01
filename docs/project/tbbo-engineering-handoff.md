# TBBO Engineering Handoff

_One second futures records for historical research and live decisions_

Implementation specification and metric inventory. Version 1.0, 1 November 2026.

> Converted from `TBBO_Engineering_Handoff.docx` (November 1, 2026) without changes to its
> content; metric names are shown as catalog identifiers. The companion
> `TBBO_Metric_Catalog.json` it cites is not in this repository. What this project
> implements, and where it deliberately differs, is in [ingestion](ingestion.md).

## Purpose

Build one deterministic processing engine that converts each actual futures contract’s Databento TBBO records into one-second OHLCV, aggressor volume, CVD, trade-price RSI and selected quote-derived features. Both historical files and live subscriptions must use the same aggregation and indicator code. The model and decision engine consume completed one-second feature records.

Preserve exact base statistics separately from rolling indicators and 0–100 model transforms. This allows new windows, model versions and normalization rules without downloading trades again. Save the first-pass state needed for any path, distribution or price-profile feature before deleting the raw events.

The companion TBBO_Metric_Catalog.json is the machine-readable specification. It contains each metric’s identifier, formula, units, inputs, required accumulator or rolling state, validity rules, normalization guidance and interpretation. The inventory below covers a broad practical set of measurements and parameterized indicator families. Arbitrarily many additional transformations are possible; the list does not imply that every feature belongs in the first model.

## Implementation priorities

| Priority                           | Required outcome                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** Preserve observations        | Exact OHLCV, side volumes and counts, CVD path, price–volume sums, selected quote statistics, quality and provenance. Compute any enabled irreversible summaries in the first pass.                                      |
| **2** Build causal indicators      | Trade-price RSI, rolling price and volume indicators, CVD trends, sampled-midpoint indicators and selected book features. Pin cadence, parameters, seeds, reset rules and availability.                                  |
| **3** Validate and select features | Verify replay, reaggregation and causal invariance. Evaluate candidate feature groups on held-out periods and instruments, including execution costs. Core denotes data-preservation priority, not proven trading value. |

## Report map

Sections 1–4 define the input, aggregation, storage and historical/live contract. Sections 5–8 specify CVD, RSI, quote calculations, rollups and normalization. Sections 9–11 define validation, limits and implementation acceptance. Appendix A is the full metric inventory; Appendix B separates future labels; Appendix C lists primary sources.

## 1. Scope and defaults

The venue-specific examples assume CME Group futures in GLBX.MDP3. Apply the same architecture to other US futures datasets only after verifying their side, quantity, flag and quote-count conventions. Process expirations and Micro/E-mini variants independently. A root symbol or continuous alias is a research mapping, not a contract aggregation key.

| Setting                   | Specification for version 1                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument identity       | dataset + publisher_id + instrument_id, joined to valid-time definitions and the actual contract symbol. Retain root, expiration, tick rules, multiplier and calendar version.                                                   |
| Bar clock                 | Use ts_recv for UTC buckets. Preserve ts_event and source order. An event-time variant is a different aggregation version with its own ordering and availability rules.                                                          |
| Interval                  | One second, start inclusive and end exclusive. Label the row by bar_start_ns; retain bar_end_ns and feature_available_at_ns.                                                                                                     |
| Session                   | Use the product’s exchange calendar and trading-date convention, including DST, holidays and overnight trading. Do not reset at an assumed UTC midnight.                                                                         |
| State resets              | Session CVD, session VWAP and session profiles reset at the configured session start. Price indicators continue within the same contract across scheduled breaks. Contract changes start independent state.                      |
| Empty seconds             | Emit zero activity only when the scheduled session and feed coverage are healthy. Observed OHLC and quote summaries stay NULL. Separate carried analysis prices support regular-cadence indicators.                              |
| Gaps                      | Mark incomplete or recovering coverage. Suppress decisions using affected features until repaired and rewarmed according to the configured rule. Preserve observed partial quantities.                                           |
| RSI                       | Wilder RSI of one-second analysis_close derived from trade closes; 14 close-to-close changes, requiring 15 input prices for the first value. Other periods are explicit instances. Flat gain/loss state yields 50 after warm-up. |
| Quote weighting           | Default event mean counts valid normalized trade records equally. Volume-weighted variants use eligible trade quantity. Neither is a clock-time average.                                                                         |
| Normalization             | Retain raw values. Materialize versioned, causal 0–100 representations in a feature layer. NULL and validity masks remain distinct from neutral 50.                                                                              |
| Finalization delay        | Required deployment parameter L, measured against transport and processing behavior. No universal value is assumed. Store actual publication times and model historical lag explicitly.                                          |
| Optional information loss | Enable path, sketch, footprint and event-time indicator packages before raw deletion if those future research capabilities are wanted.                                                                                           |

The clock and empty-bar choices are application policies. Databento’s own OHLCV uses trade ts_recv for bucketing, labels intervals by their start, and omits intervals without trades. Our dense open-session grid is an explicit extension. [S4]

## 2. Input contract and numerical rules

### 2.1 Required fields

TBBO attaches the best bid and ask immediately before the effect of each trade. It adds top-level quote prices, sizes and order counts to trade observations. Preserve those six fields as a matched observation before deriving any nonlinear metric. [S1]

| Input group              | Fields and handling                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and provenance  | dataset, publisher_id, instrument_id, contract mapping, source file or stream generation, stable record ordinal, sequence, schema and decoder version.                             |
| Times                    | ts_recv and ts_event as exact epoch nanoseconds. Live adapters also record app_arrival_ns; output publication time is separate.                                                    |
| Trade                    | action, side, price, size, flags, depth and ts_in_delta. Preserve diagnostics even when they are not model features.                                                               |
| Top quote prices         | bid_px_00 and ask_px_00. Decode undefined values before arithmetic. Price units use the vendor fixed-point scale.                                                                  |
| Top displayed quantities | bid_sz_00 and ask_sz_00. Quantity is observed displayed size at one price level; repeated observations can refer to the same resting liquidity.                                    |
| Top order counts         | bid_ct_00 and ask_ct_00, when meaningful for that dataset and period. These count displayed orders, not distinct traders.                                                          |
| External metadata        | Tick rules, contract multiplier and calendar come from instrument/reference metadata. Feed-health and exchange status may require additional subscriptions or operational records. |

### 2.2 Aggressor classification and record counting

For Trade records, B means buyer aggressor, A means seller aggressor and N means unspecified. Unknown-side trades remain in total volume; preserve a separate unknown quantity and count. Do not silently classify an unknown as a sell, or replace the exchange side with candle direction. [S2]

CME normalizes each trade summary into one Trade record; passive Fill detail belongs to MBO. Count each accepted TBBO trade once. A trade_record_count is therefore a normalized-record count, not a count of unique market orders or people. CME implied trades can have unknown side. Do not use F_LAST as a filter that discards other TBBO trade records. [S3]

### 2.3 Exact numeric representation

Decode prices and timestamps losslessly. Databento prices use signed integers scaled by 1e-9. In JavaScript, decode into BigInt or an equivalent exact representation before any Number conversion; numbers above 2^53−1 are not guaranteed exact. Large JSON integers should be decimal strings or a lossless typed encoding. [S1, S8]

Store OHLC and volumes exactly. The products price_int × quantity and price_int² × quantity can overflow int64 even when each input fits. Use checked wide types or arbitrary-precision integer/decimal accumulators. For statistical moments, centered price offsets and mergeable central moments avoid subtracting two huge nearly equal floating-point numbers.

Keep midpoint_twice_int = bid_price_int + ask_price_int when exact midpoint storage is useful. Do not round a half-tick midpoint to a trade tick. Convert scaled differences to float64 only at the derived-feature boundary. A valid futures price may be zero or negative; reject undefined sentinels, not every nonpositive price. Log and relative-return features require their own positive-denominator domain checks.

### 2.4 Validation subsets

Validate trades independently of quotes. A valid trade with an unusable quote still contributes to OHLCV and classified CVD. Each quote metric has its own valid count and weight. Missing values, zero measurements, unknown sides, stale carries, incomplete history and rejected observations must remain distinguishable.

| Subset                | Eligibility                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted trade        | Trade action, usable price, positive valid size, supported instrument and accepted source position.                                                                                           |
| **P** Quote prices    | Subset of accepted trades with usable matched bid/ask, acceptable quality policy and bid \<= ask. Crossed quotes are excluded by default. Locked quotes can support midpoint and zero spread. |
| **D** Displayed depth | P plus usable nonnegative bid/ask sizes and positive combined size. A side-specific division additionally needs that side’s size > 0.                                                         |
| **C** Order counts    | D plus usable counts with positive combined count. Average order size requires a positive count on the particular side.                                                                       |
| **K** Known side      | Aggressor is B or A, intersected with the subset needed by the particular formula.                                                                                                            |
| Transitions           | Two eligible observations in order with no disallowed gap between them. Record possible and accepted transition counts.                                                                       |

Interpret flags bitwise and retain flag counts. F_MAYBE_BAD_BOOK identifies a detected unrecoverable channel gap; retaining observed trades does not establish complete volume. Older CME data has documented exceptions: before 2017-05-21 ts_recv is a proxy equal to ts_event and F_BAD_TS_RECV is expected; before 2015-11-20 timestamps have millisecond resolution. Record timestamp_origin and resolution instead of rejecting all such history. [S2, S3]

## 3. Aggregation and database records

### 3.1 One pass processing contract

Maintain independent state for each actual contract. Use the historical index clock ts_recv; preserve the feed’s stable order for equal timestamps. ts_event may be non-monotonic, and a filtered TBBO sequence naturally skips other messages. A sequence jump or duplicate timestamp alone is insufficient evidence of a missing or duplicate trade. [S2]

```text
bar_start_ns = (ts_recv_ns // 1_000_000_000) * 1_000_000_000
bar_end_ns   = bar_start_ns + 1_000_000_000

on_event(event):
    decode_exactly_and_resolve_contract(event)
    apply_source_cursor_and_idempotency_policy(event)
    route_by_half_open_second(event)
    update_trade_ohlcv_counts_sums_and_side_buckets(event)
    update_signed_delta_prefix_and_enabled_path_state(event)
    compute_valid_quote_metrics_then_update_their_summaries(event)
    update_enabled_histograms_sketches_and_joint_terms(event)
    update_quality_provenance_and_recovery_cursor(event)

finalize_second(contract, second, availability):
    materialize_raw_base_statistics_and_quality()
    update_session_and_rolling_state_causally()
    materialize_versioned_features_and_normalization()
    persist_base_features_state_and_cursor_atomically()
    publish_exact_feature_version_used_by_decisions()
```

This is a processing contract, not a complete production implementation. The adapter must validate ordering and late-event routing before updating an already published interval. Do not deduplicate arbitrary identical-looking event content; distinct legitimate records can match in all conveniently visible fields.

### 3.2 Preserve summary state

| Summary                  | Minimum retained state                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OHLCV and VWAP           | First/last event order and price, minimum/maximum price, total quantity/count, exact price×quantity sum; side-specific equivalents where enabled.                                                           |
| Means and variances      | Per-metric valid count, mean and centered M2; weighted versions additionally keep total weight and weighted central state. Keep sums when needed for exact ratios.                                          |
| CVD path                 | Net delta and minimum/maximum signed-volume prefixes including the initial zero; session seed/completeness and reset identity.                                                                              |
| Joint quote interactions | Sum of per-event products or ratios, with matching denominators. Examples: q×sign×imbalance, spread×imbalance, q/opposite_depth. Separate means cannot reconstruct these.                                   |
| Paths and runs           | Within-second transition statistics, first/last states, leading/trailing run summaries and maximum-run state. These support exact boundary merging only when the chosen statistic’s full state is retained. |
| Distributions            | Compatible histograms or mergeable sketches with version/error metadata. Scalar quantiles alone cannot recover future quantiles over larger intervals.                                                      |
| Price footprints         | Optional per-second, per-price buy/sell/unknown volume and counts. Preserve the whole sparse price map if later session or hourly profiles are required.                                                    |

### 3.3 Logical database schema

| Table or collection   | Record contract                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| instrument_versions   | Valid-time contract identity, tick rules, multiplier, expiration, root and calendar/version.                                                                                     |
| ingest_runs           | Source manifests and digests, dataset/schema, requested/actual coverage, decoder versions, aggregation config hash, accepted/rejected totals and completion status.              |
| bars_1s_base          | Contract key + bar_start_ns + aggregation_version + revision. OHLCV, side/CVD summaries, quote summaries, sufficient statistics, quality, source lineage and completion times.   |
| features_1s           | Exact base revision + feature_set_version + parameter_hash + normalization_version. Raw derived indicators, normalized model values, validity masks and feature_available_at_ns. |
| indicator_checkpoints | Consumed source cursor plus recursive states, rolling buffers, session values, last observations, normalization reference state and version/hash.                                |
| footprint_1s optional | Contract key + second + exact price key. Buy/sell/unknown and total quantities/counts, or an equivalent sparse nested representation.                                            |
| labels_1s separate    | Origin feature version, future horizon, target definition, value, label_available_at and quality. Never joined into origin-time inputs without maturity gating.                  |

Expose a one-second joined view for the model and decision engine. The logical separation above does not require multiple database round trips; it protects provenance and lets normalized features change without rewriting observed data. Partition by contract/date as appropriate and use transactional batches. The catalog is a feature registry, not a requirement to add one physical column for every candidate and parameter combination.

## 4. Historical and live consistency

### 4.1 Availability and late data

Historical decoding and live subscriptions call the same reducer, timer interface and indicator implementation. Databento uses the same market-data record structures across historical and live services. Application arrival and decision timing still require explicit modeling. [S5]

At deployment, configure and version the allowed finalization delay L. A healthy live timer considers intervals ending at or before synchronized UTC now minus L, drains already-received events, then publishes completed rows. Track backlog and subscription health; stop claiming completeness when disconnected or materially behind. Sparse instruments need this timer because another trade may not arrive promptly.

Record bar_end_ns, app_arrival_ns where available, actual published_at_ns and feature_available_at_ns. A row labeled 10:00:00 describes [10:00:00, 10:00:01) and cannot be used at 10:00:00. A completed hourly indicator similarly becomes available only after its hour closes. Partial-period indicators require different names and definitions.

Keep immutable as_seen decision versions and separately corrected research revisions. A late event can repair the current state and produce a newer revision, but must not rewrite what a previous decision observed. Record the state-repair availability time. Replay for execution evaluation consumes the same as_seen versions and availability transitions.

Historical ts_recv is capture time, not the application’s actual arrival time. Without recorded live arrivals, apply an explicit simulated lag and interruption policy; do not claim exact reproduction of historic transport delays. Persist live arrival/publication logs for later replay.

### 4.2 Empty intervals and unknown coverage

| Condition                          | Output and indicator behavior                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healthy open second with no trades | Volume/counts/delta = 0; CVD unchanged; observed OHLC/VWAP and observed quote summaries = NULL. has_trade = false. No future backfill.                                                                            |
| Analysis prices on an empty second | Set indicator-only analysis_open/high/low/close to the latest known trade close, with carried=true and age. Observed OHLC stays NULL. Before any known price, remain NULL; gaps are not carried as complete data. |
| Quote carry                        | Maintain a separate analysis_midpoint or quote state if enabled, with age and carried flag. It represents the last TBBO observation and does not prove the current market quote.                                  |
| Feed gap or recovering period      | coverage_status identifies incomplete history. Store observed partial totals; block affected decisions. Repair from replay and checkpoint before restoring eligibility.                                           |
| Scheduled closure                  | Default emits no active-session rows. Hold within-contract price-indicator state. The next actual price change includes the reopen gap. Bar-count windows and elapsed-time windows are distinct.                  |
| Mid-session import                 | Without a session-start seed, mark session_cvd_complete=false and session_vwap_complete=false. An accumulation since import start is not the full-session value.                                                  |

### 4.3 Recovery and deterministic restarts

For historical imports, use checksummed file manifests and source ordinals. Reject overlapping ranges or resolve them through the import protocol. Rerunning the same source and version must not add volume again. Keep cursor advancement and state persistence in the same transaction.

For live reconnects, follow the provider’s documented replay cursor: last ts_event and the number of records already consumed at that timestamp, per schema/instrument; discard only the previously consumed replay prefix. Equal-time original trades must all survive. Persist the cursor with the matching aggregate state and verify this procedure against the pinned client/data version. [S6]

Checkpoint exact RSI/EMA and other recursive states, warm-up counts, rolling windows, session totals and normalization state. A fixed one-day reread does not necessarily reconstruct the exact recursive state. After an unknown gap, restore/replay from a valid checkpoint or explicitly reset and rewarm; retain the state version used by each decision.

For regular-cadence range indicators, use the separate analysis OHLC series consistently. For enabled quote-price indicators, a healthy empty second may use a flagged analytic OHLC equal to the last sampled midpoint. Book EMA presets likewise carry the previous sampled input across healthy empty seconds. Retain age, define any maximum-age eligibility threshold in configuration, and never count these carries as new observations. Fixed elapsed-time windows use time cutoffs; they do not extend backward to collect a fixed number of valid samples.

## 5. Core calculations and RSI

### 5.1 Trade volume and CVD

Use p for trade price, q for trade quantity and eps for aggressor sign: +1 for B, −1 for A. Unknown is a separate class; it has no signed increment in classified CVD. Let Vbuy, Vsell and Vunknown be the quantities in the second.

```text
V = Vbuy + Vsell + Vunknown
delta = Vbuy - Vsell
classified_volume = Vbuy + Vsell
classification_coverage = classified_volume / V       # if V > 0
aggressor_score = 100 * Vbuy / classified_volume       # if > 0
trade_vwap = sum(p * q) / V                            # if V > 0

prefix[0] = 0
prefix[k] = prefix[k-1] + signed_increment[k]
cvd_open  = 0 if new_session else previous_bar_cvd_close
cvd_high  = cvd_open + max(prefix)
cvd_low   = cvd_open + min(prefix)
cvd_close = cvd_open + delta
```

These are classified-volume CVD values. An unknown-side trade changes total volume without changing classified delta. Store both volume-based and count-based imbalance if useful; they answer different questions. Denominators using classified volume and total volume must have different field names.

Session CVD is path-dependent and reset-dependent. Also store raw second delta so trailing 5, 30, 60 or 300-second delta can be recomputed without the session’s arbitrary starting offset. The catalog includes changes, slopes, sign persistence, flow ratios and price/flow disagreement definitions. A disagreement is descriptive; it does not demonstrate absorption or identify a trader.

### 5.2 Trade price RSI

The default trade-price RSI uses the one-second analysis_close derived from actual trade closes. It is distinct from an RSI that updates on every trade. An optional per-trade RSI must be computed during initial event processing and sampled into each second; its length counts trades, not seconds.

```text
change[t] = analysis_close[t] - analysis_close[t-1]
gain[t] = max(change[t], 0)
loss[t] = max(-change[t], 0)

# Seed after N changes from N+1 cadence-consistent prices.
avg_gain = mean(first N gains)
avg_loss = mean(first N losses)

# Subsequent completed input bars.
avg_gain = ((N-1) * avg_gain + gain[t]) / N
avg_loss = ((N-1) * avg_loss + loss[t]) / N
RSI = 100 * avg_gain / (avg_gain + avg_loss)
# If both averages are zero, RSI = 50 after warm-up.
# Only gains -> 100; only losses -> 0. Before warm-up -> NULL.
```

Wilder smoothing uses alpha = 1/N, not the usual EMA alpha = 2/(N+1). Pin the library/version or implement and test the stated recurrence. The current TA-Lib source documents this recurrence and its neutral flat-series convention. [S9]

A 14-period RSI on one-second closes means 14 input-bar changes; a 14-period one-minute RSI means 14 one-minute changes. Resample the underlying bars before calculating minute/hour RSI. Do not average one-second RSI values. On healthy empty seconds the carried analysis_close contributes zero change; at closures no synthetic closed-market bars are inserted. Name the cadence and missing-data policy in the feature identity.

### 5.3 Parameter configuration

A practical initial registry can emit trade RSI(14), trade RSI(60), rolling delta/volume/returns over 5, 30, 60 and 300 elapsed seconds, plus RSI(14) on completed minute and hourly bars when sufficiently warmed. These are illustrative engineering presets, not optimized settings. Store every window, seed, carry rule and price source in parameter_hash. Candidate selection belongs in later model validation.

## 6. Quote calculations and sampling

Let b and a be the attached bid and ask prices, B and A their displayed quantities, nb and na the displayed order counts, and tau the valid tick size. Quotes are sampled before each trade’s effect. All second-level means below are over the appropriate valid trade observations. [S1, S7]

| Per-event value         | Formula and interpretation                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quoted spread           | s = (a-b)/tau. Preserve mean, maximum, last, valid count and optional dispersion/volume-weighted mean.                                                                                      |
| Midpoint                | m = (a+b)/2. Preserve sampled OHLC; returns and RSI can be computed later. These extrema are only over observed TBBO samples.                                                               |
| Displayed imbalance     | I = (B-A)/(B+A); score J = 100\*B/(B+A). Preserve the mean of per-event J, last J, depth magnitude and coverage.                                                                            |
| Weighted midpoint       | w = (a\*B+b\*A)/(B+A); tilt_ticks = (w-m)/tau = s\*I/2. A simple queue-size-weighted price, not a guaranteed fair price.                                                                    |
| Order-count imbalance   | 100\*nb/(nb+na). Also compute B/nb and A/na when denominators are positive. These are displayed averages, not the order-size distribution.                                                  |
| Effective spread        | e = 2\*eps\*(p-m)/tau for known-side trades. Volume-weight using only eligible known-side observations. It describes those observed executions relative to their attached midpoint.         |
| Trade relative to depth | R = q/A for a buy or q/B for a sell. Keep side mean/max and optional distribution. R can exceed 1 and is not the fraction of unique liquidity consumed.                                     |
| Flow and book alignment | 50\*(1 + sum(q\*eps\*I)/sum(q)) on known-side depth-valid records. High values include both buys in bid-heavy states and sells in ask-heavy states; the score is not a bullish probability. |

The weighted-midpoint construction follows standard top-of-book size weighting. The effective-spread expression uses the conventional signed distance from midpoint. Here it is a descriptive futures feature against the supplied pre-trade quote, not a securities reporting calculation or a guarantee of the platform’s execution cost. [S10, S11]

### 6.1 Calculate nonlinear values before averaging

Compute each event’s ratio, product and eligibility before updating its sum. For example, mean(B/(B+A)) generally differs from mean(B)/(mean(B)+mean(A)). Mean weighted-midpoint tilt requires mean(s\*I/2), not the product of separate means. Joint flow/book alignment cannot generally be recovered from separate aggregate flow and book scores.

For each event-mean statistic retain numerator and eligible count. For a quantity-weighted statistic retain sum(q\*x) and the corresponding eligible sum(q). Include unknown-side trades in quote-only statistics when their quotes are usable; exclude them only from features requiring aggressor sign. A mean of second means is an equal-second statistic, which differs from pooling the trades.

### 6.2 Redundancy and limits

For positive spread, 100\*(w-b)/(a-b) equals J exactly. Retaining both as independent model inputs adds no information. When executions occur exactly at the corresponding best ask/bid, effective spread equals quoted spread. Keep raw components and test feature groups instead of assuming every derived formula adds an independent signal.

TBBO omits quote-only updates between trades. Consequently, observed quote maxima, changes and paths are sampled descriptions. Carrying the last sample does not recover the actual boundary quote. The optional OFI-style transition expression is explicitly named a sampled pressure proxy; complete order-flow imbalance requires the relevant quote-event stream. [S7, S12]

## 7. Reaggregation to minutes and hours

Construct larger bars from aligned completed one-second base records. Require coverage for every in-session child interval. For tick-denominated summaries, ensure the tick convention is compatible throughout the parent interval; retain price-unit statistics or split definitions when tick rules change.

| Statistic                          | Correct merge                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trade OHLC                         | First non-NULL observed open; maximum high; minimum low; last non-NULL observed close. If no observed trades, OHLC remains NULL.                       |
| Volume and counts                  | Add total/buy/sell/unknown quantities, counts, delta and exact price×quantity sums. Recompute VWAP from combined sums.                                 |
| Means and ratios                   | Add matching numerators and denominators, then divide. Never average child ratios unless equal-child weighting is explicitly intended.                 |
| Central moments                    | Merge count, mean and M2. For two groups, d=mean2-mean1; M2=M2_1+M2_2+d²\*n1\*n2/(n1+n2). Use the weighted analogue for quantity weights.              |
| Sampled quote OHLC                 | Merge observed endpoints/extrema with their timestamps. Retain sampled labeling and quality coverage.                                                  |
| CVD extrema                        | Concatenate prefix paths with offsets from earlier children. Net delta alone does not reproduce intrainterval CVD highs/lows.                          |
| Price or midpoint paths            | Add within-child transition sums plus one eligible bridge from each prior last observation to the next first observation. Do not double count bridges. |
| Runs and quantiles                 | Merge complete boundary/run state or compatible sketches/histograms. Child maximum runs and scalar p90s alone are insufficient.                        |
| Footprints and profiles            | Add compatible per-price quantity/count maps, then recompute POC/value areas/price-level imbalances. One POC per child cannot recover the parent POC.  |
| RSI and other recursive indicators | Recompute on the parent cadence. A minute RSI is not an average of second RSI. Preserve indicator state for streaming calculation.                     |

### 7.1 Exact CVD prefix merge

```text
# Consecutive child summaries A then B, relative to each child start:
delta_parent = delta_A + delta_B
prefix_max_parent = max(prefix_max_A, delta_A + prefix_max_B)
prefix_min_parent = min(prefix_min_A, delta_A + prefix_min_B)

cvd_high_parent = cvd_open_parent + prefix_max_parent
cvd_low_parent  = cvd_open_parent + prefix_min_parent
```

For session-spanning intervals, the reset changes the meaning of session CVD. Default parent bars do not merge session-CVD levels across a reset. Raw delta and relative prefix summaries can still form a separately named continuous interval path if that is the intended analysis.

### 7.2 What survives raw event deletion

OHLCV, side sums and simple moments support many new rolling features. They do not preserve arbitrary event order, exact event-relative labels or full distributions. Enable a footprint map, path/run summary, histogram/sketch or event indicator in the initial import when that information is wanted. Keep source manifests and code/configuration versions so a future new first-pass feature can be reproduced by redownloading the relevant source range.

## 8. Normalization and causal feature definitions

The database keeps raw measurements in meaningful units. The model view may expose 0–100 values, but each transform must state what its score means. A percentile, an imbalance and RSI all use this numerical range while measuring different things.

| Input type                   | Allowed representation and edge behavior                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native bounded feature       | RSI or a volume share stays in 0–100. Signed imbalance I in [-1,1] maps to 50\*(1+I). Undefined denominators stay NULL unless a documented indicator-specific flat-state convention applies. |
| Unbounded signed measurement | Optional score = 50+50\*tanh(x/c), c>0. Fit c on the training fold only or estimate it from a documented prior-data window.                                                                  |
| Nonnegative magnitude        | Optional score = 100\*x/(x+c), c>0, or a prior-window percentile. Preserve the raw value for cost and scale interpretation.                                                                  |
| Causal percentile            | 100\*(count(prior \< x)+0.5\*count(prior == x))/prior_count. Exclude the current reference sample and all future observations; require minimum coverage.                                     |
| Absolute price               | Keep exact raw price; for model input prefer tick differences, distance from trailing VWAP/mean or a suitably scaled return. Full-history min–max scaling is prohibited.                     |
| Missing or invalid           | NULL plus validity/coverage mask. If the model requires imputation, fit and version it as part of training; never make unavailable data indistinguishable from observed neutral 50.          |
| Identifiers and timestamps   | Preserve exact types. They are keys/provenance, not values that need arbitrary 0–100 conversion. Cyclical calendar features may be separate engineered inputs.                               |

Define every feature instance by metric_id, price_source, cadence, window or half-life, weighting, validity subset, carry/reset policy, formula version and normalization version. Train-only normalization parameters may be frozen for validation/live use; online alternatives must update using only data available before the current decision.

Do not normalize using a future session high/low, full-session volume, full-dataset ranks or labels. Recompute normalized parent features from raw parent statistics; averaging second percentiles does not create a minute percentile. Report raw bounds and the count of clipped or invalid values where appropriate.

### 8.1 Indicator families and extensions

A saved price series supports many standard indicators. The catalog includes SMA/EMA/Wilder averages, RSI/StochRSI, MACD/PPO, momentum and ROC, Bollinger and channel measures, ATR/range measures, DMI/ADX, CCI, regression slopes, efficiency and return statistics. Volume and signed-flow families include VWAP, relative volume, OBV, accumulation/distribution, Chaikin measures, MFI, force and volume oscillators, with explicit variants and domain checks.

The generic rolling feature registry also applies causal sums, means, dispersion, quantiles, ranks, lags, differences, slopes, correlations and threshold/persistence rules to saved trade/quote series. Each new instance needs an exact formula, sufficient state, eligibility, units and timing. Avoid silently using a library’s default seed or NaN handling. Standard names can hide different implementations.

Higher-timeframe values joined to one-second rows must be the latest fully completed and available value unless a separately specified partial-timeframe feature is used. Cross-contract or cross-symbol features require synchronized as-of joins, instrument-specific units and independent coverage masks; they are not single-contract TBBO measurements.

## 9. Acceptance fixtures

### 9.1 Numeric reference second

Use tick size 0.25, initial session CVD 100 and the following three ordered trades inside one second. The prices and quantities are a constructed test fixture.

| Time offset | Side | Trade       | Bid and ask     | Bid and ask size |
| ----------- | ---- | ----------- | --------------- | ---------------- |
| 0.100 s     | B    | 10 @ 100.25 | 100.00 / 100.25 | 300 / 100        |
| 0.200 s     | A    | 20 @ 100.00 | 100.00 / 100.25 | 100 / 300        |
| 0.300 s     | B    | 30 @ 100.50 | 100.25 / 100.50 | 400 / 100        |

| Expected output             | Value                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Trade OHLC                  | 100.25, 100.50, 100.00, 100.50                                                                                |
| Total and classified volume | Total 60; buy 40; sell 20; unknown 0; delta +20; record count 3                                               |
| Exact price–volume sum      | 6,017,500,000,000 in raw 1e-9 price units × contracts                                                         |
| Trade VWAP                  | 100.2916666667                                                                                                |
| CVD path                    | Relative prefixes 0, +10, −10, +20; session OHLC 100, 120, 90, 120                                            |
| Spread                      | Mean and maximum 1 tick                                                                                       |
| Sampled midpoint OHLC       | 100.125, 100.375, 100.125, 100.375; range 1 tick                                                              |
| Book score                  | Per-event 75, 25, 80; event mean 60; last 80; volume-weighted mean 60.8333333333                              |
| Mean displayed sizes        | Bid 266.6666666667; ask 166.6666666667. Their ratio gives 61.5384615385, which is not the mean book score 60. |
| Alignment                   | Raw quantity-weighted eps×I = 0.55; mapped score 77.5                                                         |
| Last weighted midpoint      | 100.45; tilt +0.3 tick                                                                                        |
| Effective spread            | 1 tick for each trade and for the volume-weighted mean                                                        |

### 9.2 Required edge and invariance tests

- Unknown side: add N quantity 5. Total and unknown volume rise by 5; classified delta stays +20. Quote-only denominators can include the observation, while known-side denominators cannot.
- Boundaries and duplicates: a trade exactly at bar_end enters the next interval. Distinct original trades with equal timestamps all count. Replayed prefixes do not count twice.
- Chunking and restarts: one file, multiple disjoint chunks, checkpoint restart and reconnect replay produce identical base statistics and recursive state under the same availability policy.
- Validity: a valid trade with missing or crossed quote still contributes to OHLCV/CVD. Zero denominators produce NULL unless a specified flat-state convention applies, with the appropriate flag. Nonpositive valid prices are handled without blanket rejection.
- Empty versus gap: a healthy empty interval has known zero activity; a gap has unknown completeness. An import beginning mid-session reports incomplete cumulative state.
- Numeric precision: include epoch nanoseconds above 2^53−1 and price–quantity products above int64. Confirm exact boundaries, volume sums and serialization.
- Rollups: compare direct raw-event aggregation with one-second merges for OHLCV, CVD prefixes, weighted means, central moments, paths and profiles. Vary child trade counts so an incorrect mean-of-means fails.
- RSI: verify seed from N changes, increasing series 100, decreasing series 0, flat series 50 after warm-up, and exact checkpoint restoration. Verify minute RSI from minute closes.
- Calendar and contracts: cover session resets, DST, maintenance, holidays, contract switches and legacy timestamp flags. No cross-expiration CVD or artificial roll return is permitted.
- Causality: processing only the prefix available at time T gives the same as_seen features through T as processing the full future stream. Later events or labels must not alter earlier decision inputs.
- Late correction: preserve the original decision row, create corrected lineage and replay dependent state from the right checkpoint. Check availability of the repaired state.
- Model representation: valid bounded outputs satisfy their declared ranges; NULLs remain distinguishable; training transforms never use validation/test periods.

## 10. Unsupported conclusions and separate labels

| Requested quantity or conclusion                 | TBBO limitation                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| True time-weighted spread or depth               | Requires quote changes between trades. TBBO supports event/volume-weighted sampled statistics and explicitly labeled carry approximations.                                 |
| Exact quote at the second boundary               | The last pre-trade quote is a previous observation. It may differ from the post-trade or boundary quote.                                                                   |
| Full OFI or cancellation and replenishment rates | Intervening quote events are missing. Endpoint differences and the catalog pressure expression are sampled proxies only.                                                   |
| Depth beyond best bid and ask                    | TBBO gives top-level state. Multi-level imbalance, cumulative depth curves and exact sweep depth require additional book data.                                             |
| Hidden liquidity or iceberg detection            | Observed trades and displayed top depth may support hypotheses, but cannot prove hidden-order size or participant intent.                                                  |
| Queue position and exact passive fills           | Top-level quantities/counts do not identify order priority, cancellations ahead, own queue position or matching allocation.                                                |
| Exact execution from one-second OHLC             | A bar can omit the order of target/stop crossings. Intrasecond fill paths, queue effects, latency and partial fills require assumptions or additional retained event data. |
| Open interest and settlement                     | These are separate market/reference observations. They cannot be inferred exactly from gross trade volume or the last trade of a session.                                  |
| Buyer and seller identity                        | Aggressor side states which side initiated the observed trade, not who traded, whether a position opened/closed, or whether it was institutional.                          |
| Guaranteed alpha or net profit                   | A computable feature has no automatic predictive or economic value. Validate feature groups out of sample with appropriate trading costs.                                  |

Forward returns, markouts and realized future outcomes are labels. Store them separately with origin, horizon, target observation convention and maturity time. An event-relative markout at event_time+h generally cannot be recovered exactly from a one-second summary after raw deletion. A common bar-end horizon can be computed from retained signed price–volume sums, but is a different target. Matured past outcomes may enter later features only after their actual availability. [S13]

For model evaluation, compare a price/volume baseline, then add classified flow/CVD, then quote features, then optional interactions. Use chronological splits, control overlap of forward-label horizons and fit preprocessing on training data only. Retain raw cost-related spread measures even when percentile versions are used for prediction.

## 11. Delivery and implementation acceptance

Implement the ingestion contract and exact base storage first. Add the enabled first-pass packages during that same raw-data pass. Rolling features can be added later from preserved inputs. Before deleting source files, verify which future research questions would require information that the selected summary package does not keep.

| Deliverable from the engineer | Acceptance condition                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versioned configuration       | Contract filters, clock, session calendar, validity policy, enabled packages, parameter sets, normalization policy and finalization delay are explicit and hashed.                                                 |
| Historical import script      | Streams source files, preserves exact types/order, supports resumable idempotent imports, reconciles accepted/rejected quantities and writes one-second base records.                                              |
| Shared live reducer           | Uses the same formulas, timer/state interface and checkpoint protocol. Records arrivals, publication times and exact feature versions consumed by decisions.                                                       |
| Feature registry              | Each implemented catalog instance has tests, input/state dependencies, units, cadence, warm-up, invalidity behavior and availability. No unreviewed label becomes a contemporaneous feature.                       |
| Database and checkpoints      | Raw and transformed values remain separable. Revisions, source manifests and state can reproduce every published decision input.                                                                                   |
| Validation evidence           | Numeric fixture, boundaries, replay/restart, gap handling, precision, rollups and causal-prefix tests pass. Report unavailable subsets and coverage; do not require profitability as an ingestion acceptance test. |

The accompanying catalog is intentionally larger than an initial model feature set. Core entries identify preservation and baseline priorities. Optional entries identify additional hypotheses or state that can be enabled selectively. The engineer should expand parameterized families into concrete, versioned instances and avoid materializing redundant or unselected transforms by default.

## Appendix A Metric inventory

The catalog contains 183 metric entries or parameterized families and 3 separately staged future-label entries. Grouped entries can produce several columns; the count is not a count of independent predictive signals. The JSON companion is the detailed data dictionary for state, inputs, validity, normalization and source links.

Expressions are language-neutral algorithmic notation: sum, mean, min, max, abs, sqrt and log have their usual meanings; ^ denotes exponentiation and 1[condition] is an indicator. NULL means unavailable. N/W/h and thresholds are explicit parameters. References to t mean the current completed input bar; every output is gated by feature availability. Price and tick size use matching units.

Quote notation: p/q = trade price/quantity; b/a = bid/ask; B/A = displayed bid/ask quantity; nb/na = order counts; eps = known aggressor sign; tau = tick size. P/D/C/K are the validity subsets in Section 2. The JSON includes the full trade and quote notation dictionaries. Normalized scores remain separate from raw measurements.

Stages identify when computation occurs: second/event requires initial raw processing; rolling/session can use preserved base state; matured features need completed past labels. Core means preservation priority. Optional means candidate capability. All stages obey the quality and timing rules in this report.

### A1 Trade Price And Activity

| Metric or family          | Stage  | Priority | Definition                                                                                                                 | Units                                                    |
| ------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `trade_ohlc`              | second | core     | O=first p_i; H=max(p_i); L=min(p_i); C=last p_i in deterministic event order.                                              | price                                                    |
| `trade_volume`            | second | core     | V=sum(q_i).                                                                                                                | contracts                                                |
| `trade_record_count`      | second | core     | N=count(valid Trade records).                                                                                              | records                                                  |
| `trade_time_bounds`       | second | core     | first_trade_ns=min(timestamp_i); last_trade_ns=max(timestamp_i) under the selected clock; persist event order for ties.    | nanoseconds                                              |
| `price_quantity_sum`      | second | core     | PV=sum(p_i\*q_i).                                                                                                          | price times contracts                                    |
| `trade_vwap`              | second | core     | VWAP=PV/V.                                                                                                                 | price                                                    |
| `trade_price_variance_vw` | second | optional | Weighted population variance=sum(q_i\*(p_i-VWAP)^2)/V; std=sqrt(variance).                                                 | price squared for variance; price for standard deviation |
| `trade_price_mean_event`  | second | optional | mean_price=sum(p_i)/N; event_population_variance=sum((p_i-mean_price)^2)/N.                                                | price for mean; price squared for variance               |
| `trade_vwap_side`         | second | optional | VWAP_B=sum(p_i\*q_i\*1[B])/V_B; likewise A and N.                                                                          | price                                                    |
| `buy_sell_vwap_gap_ticks` | second | optional | (VWAP_B-VWAP_A)/tick_size.                                                                                                 | ticks                                                    |
| `notional_turnover`       | second | optional | sum(abs(p_i)\*q_i\*contract_multiplier) for instruments whose multiplier correctly maps price to quoted-currency notional. | currency notional                                        |

### A2 Trade Size Distribution

| Metric or family           | Stage  | Priority | Definition                                                                                                                                    | Units                                                  |
| -------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `trade_size_mean_std`      | second | core     | mean_size=V/N; size_var=sum((q_i-mean_size)^2)/N; size_std=sqrt(size_var).                                                                    | contracts for mean/std; contracts squared for variance |
| `trade_size_min_max`       | second | core     | min_size=min(q_i); max_size=max(q_i).                                                                                                         | contracts                                              |
| `trade_size_quantiles`     | second | optional | q50/q90/q99 from the configured empirical size distribution; exact discrete quantile uses smallest q with cumulative count >= ceil(alpha\*N). | contracts                                              |
| `large_trade_activity`     | second | optional | large_count=count(q_i>=K); large_volume=sum(q_i\*1[q_i>=K]); large_volume_share=100\*large_volume/V.                                          | records; contracts; percent                            |
| `trade_size_concentration` | second | optional | HHI=sum(q_i^2)/V^2. Optional normalized HHI=(HHI-1/N)/(1-1/N) for N>1.                                                                        | dimensionless                                          |
| `trade_size_gini`          | second | optional | For sorted sizes q\_(j), G=2\*sum(j\*q\_(j))/(N\*V)-(N+1)/N.                                                                                  | 0-1                                                    |
| `trade_size_entropy`       | second | optional | For predefined size bins with shares f_k=count_k/N, H=-sum(f_k\*log(f_k)); normalized H/log(K) for K>1.                                       | dimensionless                                          |

### A3 Aggressor Flow

| Metric or family             | Stage   | Priority | Definition                                                                                                                                                          | Units                        |
| ---------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `aggressor_volume`           | second  | core     | V_B=sum(q_i\*1[side=B]); V_A=sum(q_i\*1[side=A]); V_N=sum(q_i\*1[side=N]); V=V_B+V_A+V_N.                                                                           | contracts                    |
| `aggressor_record_count`     | second  | core     | N_B=count(B); N_A=count(A); N_N=count(N); N=N_B+N_A+N_N.                                                                                                            | records                      |
| `volume_delta`               | second  | core     | delta=V_B-V_A.                                                                                                                                                      | contracts                    |
| `known_volume_fraction`      | second  | core     | coverage=100\*(V_B+V_A)/V; unknown_fraction=100\*V_N/V.                                                                                                             | percent                      |
| `aggressor_volume_imbalance` | second  | core     | I_flow=(V_B-V_A)/(V_B+V_A); score=100\*V_B/(V_B+V_A).                                                                                                               | -1 to 1; 0-100               |
| `aggressor_count_imbalance`  | second  | optional | I_count=(N_B-N_A)/(N_B+N_A); score=100\*N_B/(N_B+N_A).                                                                                                              | -1 to 1; 0-100               |
| `signed_size_moments`        | second  | optional | For known-side trades x_i=epsilon_i\*q_i, preserve count, sum x, sum x^2, min x, max x; compute population variance.                                                | contracts; contracts squared |
| `large_trade_delta`          | second  | optional | delta_large=sum(epsilon_i\*q_i\*1[q_i>=K]) over known sides; retain buy/sell large volume and threshold coverage.                                                   | contracts                    |
| `side_size_asymmetry`        | second  | optional | mean_buy_size=V_B/N_B; mean_sell_size=V_A/N_A; normalized difference=(mean_buy_size-mean_sell_size)/(mean_buy_size+mean_sell_size).                                 | contracts; -1 to 1           |
| `rolling_signed_flow`        | rolling | core     | delta_W=sum(delta_t over W); V_B_W=sum(V_B_t); V_A_W=sum(V_A_t); I_W=(V_B_W-V_A_W)/(V_B_W+V_A_W).                                                                   | contracts; -1 to 1           |
| `flow_ema_trend`             | rolling | optional | EMA_h(x)\_t=alpha_h\*x_t+(1-alpha_h)\*EMA_h(x)\_(t-1), alpha_h=1-2^(-1/h). Compare fast and slow EMAs of delta or I_flow.                                           | contracts or signed ratio    |
| `flow_persistence`           | rolling | optional | positive_fraction=100\*count(delta_t>0)/count(eligible seconds); negative/zero fractions analogously; optionally run lengths of positive/negative per-second delta. | percent; seconds             |

### A4 Cvd Path

| Metric or family           | Stage   | Priority | Definition                                                                                                                                                                                           | Units        |
| -------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `session_cvd`              | rolling | core     | CVD_t=CVD_previous+delta_t, reset to zero at the configured session anchor per actual instrument.                                                                                                    | contracts    |
| `cvd_bar_path`             | second  | core     | Let d_0=0 and d_j=sum\_{i\<=j} epsilon_i\*q_i with epsilon=0 for unknown records. Save d_close=delta, d_high=max(0,d_j), d_low=min(0,d_j). Session CVD OHLC are anchor_CVD+{0,d_high,d_low,d_close}. | contracts    |
| `cvd_path_range`           | second  | optional | range=d_high-d_low; up_excursion=d_high; down_excursion=-d_low.                                                                                                                                      | contracts    |
| `cvd_path_drawdown_drawup` | second  | optional | max_drawdown=max\_{j\<=k}(d_j-d_k); max_drawup=max\_{j\<=k}(d_k-d_j).                                                                                                                                | contracts    |
| `cvd_path_efficiency`      | second  | optional | abs(delta)/(V_B+V_A); signed form delta/(V_B+V_A).                                                                                                                                                   | 0-1; -1 to 1 |

### A5 Event Order

| Metric or family                 | Stage   | Priority | Definition                                                                                                                                                                            | Units                        |
| -------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `aggressor_runs`                 | second  | optional | Find maximal consecutive B or A runs; N breaks a run by default. Save max run count and volume by side, first/last run side/count/volume, and all_one_run flag.                       | records; contracts           |
| `aggressor_transition_counts`    | second  | optional | Count adjacent known-side pairs BB,BA,AB,AA within uninterrupted known-side runs. switch_fraction=(BA+AB)/(BB+BA+AB+AA).                                                              | counts; fraction             |
| `aggressor_sign_autocorrelation` | rolling | optional | For known-side event sequence with a declared unknown-break policy, corr(epsilon_i,epsilon\_(i-k)) for lag k; retain pair count and first/second/cross moments.                       | -1 to 1                      |
| `trade_price_path_variation`     | second  | optional | Within observed event order, abs_path=sum(abs(p_i-p\_(i-1)))/tau; squared_path=sum(((p_i-p\_(i-1))/tau)^2); up/down/unchanged transition counts.                                      | ticks; ticks squared; counts |
| `trade_price_path_efficiency`    | second  | optional | abs(C-O)/sum(abs(adjacent trade price changes)); signed form (C-O)/sum(abs(changes)).                                                                                                 | 0-1; -1 to 1                 |
| `event_trade_price_rsi`          | event   | optional | Apply the stated Wilder RSI recurrence to successive accepted trade prices in feed order, with N trade-to-trade changes. Save last/min/max RSI observed in each second after warm-up. | 0-100                        |
| `trade_price_step_volume`        | second  | optional | Within the second, sum current trade q_i into up/down/unchanged buckets according to sign(p_i-p_previous); save first price and first quantity for an optional boundary bridge.       | contracts                    |

### A6 Event Timing

| Metric or family           | Stage   | Priority | Definition                                                                                                  | Units                      |
| -------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- |
| `within_second_subbuckets` | second  | optional | For fixed subintervals such as ten 100 ms bins: count, total volume and B/A/N volume in each bin.           | arrays of counts/contracts |
| `trade_arrival_intervals`  | second  | optional | For adjacent ordered trades in a second, dt_i=timestamp_i-timestamp\_(i-1); save count, mean, M2, min, max. | nanoseconds                |
| `trade_idle_age`           | second  | core     | bar_end_ns-last_observed_trade_ns, using only trades already known at finalization.                         | nanoseconds                |
| `trade_arrival_burstiness` | rolling | optional | B=(std(dt)-mean(dt))/(std(dt)+mean(dt)) for the configured set of valid interarrival intervals.             | -1 to 1                    |

### A7 Price Level Distribution

| Metric or family               | Stage  | Priority | Definition                                                                                                                                                                                                                                                                                                                            | Units                      |
| ------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `volume_at_price_map`          | second | optional | For each exact raw fixed-point price p, store total quantity, B/A/N quantities and trade counts. A uniform-grid integer tick index is an optional lossless representation with an explicit price origin and tick size.                                                                                                                | contracts/counts per price |
| `volume_profile_poc`           | second | optional | POC=price with maximum total traded volume. Tie policy for this specification: choose lowest price among ties.                                                                                                                                                                                                                        | price                      |
| `volume_profile_value_area`    | second | optional | For fraction f in (0,1], start at the specified POC. Expand within the observed profile minimum/maximum price bounds by one valid tick level on the side with larger volume; ties choose the lower-price side. Exhausted sides are ineligible. Include interior zero-volume levels until included volume >= f\*V; return VAL and VAH. | price                      |
| `price_level_delta`            | second | optional | delta(k)=V_B(k)-V_A(k); known imbalance(k)=delta(k)/(V_B(k)+V_A(k)). Save largest positive/negative delta level and their magnitudes if desired.                                                                                                                                                                                      | contracts; ratio; price    |
| `footprint_diagonal_imbalance` | second | optional | Using actual price p: buy flag if V_B(p)>=min_qty and V_A(p-tau)>0 and V_B(p)>=R\*V_A(p-tau); sell flag compares V_A(p) with V_B(p+tau) symmetrically. Zero comparators emit a separate zero_comparator flag and do not qualify under this version. Count adjacent qualifying price levels for stacked flags.                         | flags; level counts        |
| `volume_profile_entropy`       | second | optional | H=-sum_k f_k\*log(f_k), f_k=V(k)/V; HHI=sum_k f_k^2; optionally effective_levels=exp(H).                                                                                                                                                                                                                                              | dimensionless              |

### A8 Price Derived

| Metric or family             | Stage   | Priority | Definition                                                                                                                              | Units                   |
| ---------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `candle_geometry`            | second  | core     | range=(H-L)/tau; signed_body=(C-O)/tau; upper_wick=(H-max(O,C))/tau; lower_wick=(min(O,C)-L)/tau; close_location=(C-L)/(H-L).           | ticks; 0-1              |
| `close_momentum_ticks`       | rolling | core     | momentum_N=(C_t-C\_(t-N))/tau; also one-step gap=(O_t-C\_(t-1))/tau where defined.                                                      | ticks                   |
| `percentage_and_log_returns` | rolling | optional | simple_return=C_t/C\_(t-N)-1; log_return=log(C_t/C\_(t-N)).                                                                             | fraction                |
| `rolling_price_statistics`   | rolling | core     | For x in {close,HL2,HLC3,OHLC4}, calculate SMA_N, population std_N, min_N, max_N, median_N and chosen quantiles.                        | price; price dispersion |
| `return_autocorrelation`     | rolling | optional | corr(r_t,r\_(t-k)) over N eligible pairs, with r in declared tick or positive-price return units.                                       | -1 to 1                 |
| `rolling_extrema_distances`  | rolling | optional | Distance from C_t to prior-window high/low, rolling VWAP, SMA/EMA, and prior completed-session levels, expressed in ticks or ATR units. | ticks; ATR units        |

### A9 Trend Averages

| Metric or family    | Stage   | Priority | Definition                                                                                                                      | Units |
| ------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `price_ema_rma_wma` | rolling | core     | EMA_N: alpha=2/(N+1); RMA_N: alpha=1/N; y_t=alpha\*x_t+(1-alpha)\*y\_(t-1). WMA_N=sum\_{j=0}^{N-1}(N-j)\*x\_(t-j)/(N\*(N+1)/2). | price |

### A10 Momentum Oscillators

| Metric or family        | Stage   | Priority | Definition                                                                                                                                                                                                       | Units         |
| ----------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `trade_price_rsi`       | rolling | core     | d=C_t-C\_(t-1); g=max(d,0); l=max(-d,0). Seed G,D as arithmetic means of the first N gains and losses from N+1 closes. Thereafter G_t=((N-1)\*G\_(t-1)+g_t)/N and D_t=((N-1)\*D\_(t-1)+l_t)/N. RSI=100\*G/(G+D). | 0-100         |
| `stochastic_oscillator` | rolling | optional | fastK=100\*(C_t-LL_N)/(HH_N-LL_N); slowK=SMA_M(fastK); D=SMA_Dperiod(slowK), where HH=max H and LL=min L in the defined N-bar window.                                                                            | 0-100         |
| `williams_percent_r`    | rolling | optional | WILLR=-100\*(HH_N-C_t)/(HH_N-LL_N).                                                                                                                                                                              | -100 to 0     |
| `stochastic_rsi`        | rolling | optional | 100\*(RSI_t-min_N(RSI))/(max_N(RSI)-min_N(RSI)); optional named K/D smoothers.                                                                                                                                   | 0-100         |
| `cci`                   | rolling | optional | TP=(H+L+C)/3; CCI=(TP_t-SMA_N(TP))/(0.015\*mean_N(abs(TP_j-SMA_N(TP)))).                                                                                                                                         | dimensionless |
| `cmo`                   | rolling | optional | CMO=100\*(sum_N(gains)-sum_N(losses))/(sum_N(gains)+sum_N(losses)).                                                                                                                                              | -100 to 100   |

### A11 Volume Weighted Prices

| Metric or family          | Stage   | Priority | Definition                                                                                                                                                                     | Units                      |
| ------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `rolling_trade_vwap`      | rolling | core     | VWAP_W=sum(PV_t over W)/sum(V_t over W). Session/anchored VWAP uses the corresponding cumulative sums.                                                                         | price                      |
| `vwap_distance_and_bands` | rolling | core     | distance_ticks=(C_t-VWAP_W)/tau; weighted_sigma_W from merged price-volume moments; bands=VWAP_W +/- k\*weighted_sigma_W; standardized_distance=(C_t-VWAP_W)/weighted_sigma_W. | ticks; price; z-like units |

### A12 Volume And Activity

| Metric or family          | Stage   | Priority | Definition                                                                                                                    | Units                               |
| ------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `rolling_volume_activity` | rolling | core     | V_W=sum(V); N_W=sum(N); rate=V_W/window_seconds; mean_size=V_W/N_W; zero_trade_fraction=count(N=0)/eligible_clock_seconds.    | contracts; records; rates; fraction |
| `relative_volume`         | rolling | optional | RVOL=V_t/median(V\_(t-N)...V\_(t-1)), or session_to_date_volume/median(prior completed sessions volume_to_same_elapsed_time). | ratio                               |
| `volume_oscillator`       | rolling | optional | raw=EMA_fast(V)-EMA_slow(V); percent=100\*raw/EMA_slow(V).                                                                    | contracts; percent                  |

### A13 Volatility

| Metric or family             | Stage   | Priority | Definition                                                                                                           | Units                               |
| ---------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `rolling_return_variability` | rolling | core     | r_t=(C_t-C\_(t-1))/tau; save population std_N(r), sqrt(sum_N(r^2)), skewness=m3/m2^(3/2), excess kurtosis=m4/m2^2-3. | ticks; dimensionless higher moments |
| `true_range_atr`             | rolling | core     | TR_t=max(H_t-L_t,abs(H_t-C\_(t-1)),abs(L_t-C\_(t-1))); ATR_N=RMA_N(TR).                                              | price; ticks after division by tau  |

### A14 Volatility Bands

| Metric or family   | Stage   | Priority | Definition                                                                                                                         | Units                      |
| ------------------ | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `bollinger_bands`  | rolling | optional | middle=SMA_N(C); sigma=population_std_N(C); upper/lower=middle +/- k\*sigma; percentB=(C-lower)/(upper-lower); z=(C-middle)/sigma. | price; ratio; z-like units |
| `keltner_channels` | rolling | optional | Explicit modern variant: center=EMA_N(C); upper/lower=center +/- k\*ATR_M.                                                         | price                      |

### A15 Trend And Breakout

| Metric or family    | Stage   | Priority | Definition                                                                                                                                   | Units        |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `donchian_channels` | rolling | optional | Prior-window high=max(H\_(t-N)...H\_(t-1)); low=min(L\_(t-N)...L\_(t-1)); midpoint=(high+low)/2; distances=(C_t-high)/tau and (C_t-low)/tau. | price; ticks |

### A16 Trend Oscillators

| Metric or family | Stage   | Priority | Definition                                                                         | Units                              |
| ---------------- | ------- | -------- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| `macd`           | rolling | optional | MACD=EMA_fast(C)-EMA_slow(C); signal=EMA_signal(MACD); histogram=MACD-signal.      | price; ticks after division by tau |
| `ppo`            | rolling | optional | PPO=100\*(EMA_fast(C)-EMA_slow(C))/EMA_slow(C); optional signal EMA and histogram. | percent                            |
| `trix`           | rolling | optional | E1=EMA_N(C); E2=EMA_N(E1); E3=EMA_N(E2); TRIX=100\*(E3_t/E3\_(t-1)-1).             | percent                            |

### A17 Trend Strength

| Metric or family           | Stage   | Priority | Definition                                                                                                                                                                                                     | Units |
| -------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `directional_movement_adx` | rolling | optional | up=H_t-H\_(t-1); down=L\_(t-1)-L_t; +DM=up if up>down and up>0 else 0; -DM=down if down>up and down>0 else 0; +DI=100\*RMA_N(+DM)/RMA_N(TR), -DI similarly; DX=100\*abs(+DI-(-DI))/(+DI+(-DI)); ADX=RMA_N(DX). | 0-100 |

### A18 Trend Recency

| Metric or family | Stage   | Priority | Definition                                                                                                                                                     | Units              |
| ---------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `aroon`          | rolling | optional | Use N+1 bars spanning N steps. age_high=steps since most recent highest H; age_low analogous. AroonUp=100\*(N-age_high)/N; Down similarly; oscillator=Up-Down. | 0-100; -100 to 100 |

### A19 Adaptive Trend

| Metric or family        | Stage   | Priority | Definition                                                                                                                                              | Units      |
| ----------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `efficiency_ratio_kama` | rolling | optional | ER=abs(C_t-C\_(t-N))/sum\_{j=t-N+1}^t abs(C_j-C\_(j-1)); alpha=[ER\*(2/(fast+1)-2/(slow+1))+2/(slow+1)]^2; KAMA_t=KAMA\_(t-1)+alpha\*(C_t-KAMA\_(t-1)). | 0-1; price |

### A20 Trend Statistics

| Metric or family          | Stage   | Priority | Definition                                                                                            | Units                      |
| ------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| `linear_regression_trend` | rolling | optional | OLS y_j=C_j against x_j=0..N-1: slope=Sxy/Sxx; intercept=ybar-slope\*xbar; fitted_last; R2=1-SSE/SST. | price/bar; price; fraction |
| `choppiness_index`        | rolling | optional | CHOP=100\*log10(sum_N(TR)/(HH_N-LL_N))/log10(N).                                                      | index                      |

### A21 Trend And Stop References

| Metric or family         | Stage   | Priority | Definition                                                                                                                                                                                                                                                                                                                                                                                         | Units            |
| ------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `atr_trailing_reference` | rolling | optional | Default includes the current completed bar: long_reference=max(H over last N completed bars)-k\*ATR_M; short_reference=min(L over last N completed bars)+k\*ATR_M. A prior-only variant has a separate identifier.                                                                                                                                                                                 | price            |
| `parabolic_sar`          | rolling | optional | Stateful variant: provisional SAR=prior SAR+AF\*(EP-prior SAR). Uptrend clamps SAR to prior two lows and reverses if current L\<=SAR; downtrend clamps to prior two highs and reverses if H>=SAR. On reversal set SAR=prior EP, AF=AF0, EP=current opposite extreme. Otherwise update EP and increase AF by step up to cap when a new trend extreme occurs.                                        | price; direction |
| `supertrend`             | rolling | optional | Configured variant: basic upper/lower=HL2 +/- k\*ATR. Final upper resets to basic if basic\<prior upper or prior C>prior upper, otherwise carries; final lower resets if basic>prior lower or prior C\<prior lower. Trend flips down when an uptrend close falls below final lower, and up when a downtrend close rises above final upper; active line is lower in uptrend and upper in downtrend. | price; direction |

### A22 Price Volume Indicators

| Metric or family                 | Stage   | Priority | Definition                                                                                                                                                                           | Units                           |
| -------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `obv`                            | rolling | optional | OBV_t=OBV\_(t-1)+sign(C_t-C\_(t-1))\*V_t; unchanged close adds zero.                                                                                                                 | contracts                       |
| `accumulation_distribution_line` | rolling | optional | MFM=(2\*C-H-L)/(H-L); money_flow_volume=MFM\*V; ADL_t=ADL_prev+money_flow_volume. Zero-range candle uses MFM=0 with flat flag.                                                       | contracts-weighted index        |
| `chaikin_money_flow`             | rolling | optional | CMF_N=sum_N(MFM\*V)/sum_N(V), with zero-range MFM=0 under this convention.                                                                                                           | -1 to 1                         |
| `chaikin_oscillator`             | rolling | optional | EMA_fast(ADL)-EMA_slow(ADL).                                                                                                                                                         | contracts-weighted index        |
| `money_flow_index`               | rolling | optional | TP=(H+L+C)/3; raw_flow=TP\*V. Positive flow sums raw_flow when TP rises, negative when it falls; equal TP contributes to neither. MFI=100\*positive_sum/(positive_sum+negative_sum). | 0-100                           |
| `price_volume_trend`             | rolling | optional | PVT_t=PVT_prev+V_t\*(C_t-C\_(t-1))/C\_(t-1).                                                                                                                                         | contracts-weighted return index |
| `force_index`                    | rolling | optional | Force_t=((C_t-C\_(t-1))/tau)\*V_t; optional EMA_N(Force).                                                                                                                            | tick-contracts                  |
| `ease_of_movement`               | rolling | optional | EMV_t=((H_t+L_t)/2-(H\_(t-1)+L\_(t-1))/2)\*(H_t-L_t)/V_t; optional SMA_N.                                                                                                            | price squared per contract      |

### A23 Session Context

| Metric or family          | Stage   | Priority | Definition                                                                                                                                                                                                    | Units        |
| ------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `session_price_reference` | rolling | core     | Session open=first valid trade price; high_to_date=max observed price since anchor; low_to_date=min; return_to_open=(C-open)/tau; distance_to_high=(C-high_to_date)/tau; distance_to_low=(C-low_to_date)/tau. | price; ticks |
| `prior_session_pivots`    | rolling | optional | From the previous completed configured session: P=(H+L+C)/3; R1=2P-L; S1=2P-H; R2=P+(H-L); S2=P-(H-L). Also raw prior high/low/close and current tick distances.                                              | price; ticks |

### A24 Pattern Features

| Metric or family               | Stage   | Priority | Definition                                                                                                                                                                                               | Units              |
| ------------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `confirmed_local_pivots`       | rolling | optional | A high pivot centered at j is confirmed only at j+k if H_j is strictly greater than all other highs in [j-k,j+k]; low symmetric. Emit latest confirmed pivot price and its age on confirmation-time row. | price; bars; flags |
| `candlestick_pattern_families` | rolling | optional | Parameterized body/wick/gap/relative-body rules or a pinned candlestick-recognition implementation. Inputs are completed OHLC on a declared timeframe.                                                   | categorical/flags  |

### A25 Cross Feature Interactions

| Metric or family     | Stage   | Priority | Definition                                                                                                                                                                                     | Units |
| -------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `flow_price_context` | rolling | optional | Retain jointly: signed-volume imbalance over W, tick price change over W, total/known volume and volatility. Optional products or bounded differences may be derived after consistent scaling. | mixed |

### A26 Generic Transformations

| Metric or family          | Stage   | Priority | Definition                                                                                                                                                | Units             |
| ------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `lag_slope_change_family` | rolling | optional | For any eligible base scalar x: lag_k=x\_(t-k), difference=x_t-x\_(t-k), rolling mean/std, EMA, OLS slope, causal percentile and selected cross-products. | inherited/derived |

### A27 Quote coverage and observation age

| Metric or family                 | Stage  | Priority | Definition                                              | Units           |
| -------------------------------- | ------ | -------- | ------------------------------------------------------- | --------------- |
| `quote_price_valid_count`        | second | core     | count(i in P)                                           | records         |
| `quote_depth_valid_count`        | second | core     | count(i in D)                                           | records         |
| `quote_order_count_valid_count`  | second | optional | count(i in C)                                           | records         |
| `quote_price_valid_volume`       | second | core     | sum(q_i for i in P)                                     | contracts       |
| `quote_known_side_valid_volume`  | second | core     | sum(q_i for i in P intersect K)                         | contracts       |
| `quote_price_valid_fraction`     | second | core     | 100\*quote_price_valid_count/trade_record_count         | percent         |
| `last_quote_observation_time_ns` | second | core     | timestamp of last valid quote-bearing TBBO record       | UTC nanoseconds |
| `last_quote_observation_age_ms`  | second | core     | (bar_end_ns-last_quote_observation_time_ns)/1e6         | milliseconds    |
| `quote_observed_this_second`     | second | core     | 1 if quote_price_valid_count>0 else 0                   | boolean         |
| `quote_carried_forward`          | second | core     | 1 when output quote state came from an earlier interval | boolean         |

### A28 Retained quote state

| Metric or family             | Stage  | Priority | Definition                                             | Units                    |
| ---------------------------- | ------ | -------- | ------------------------------------------------------ | ------------------------ |
| `last_observed_quote_fields` | second | core     | last valid b,a,B,A,nb,na using field-specific validity | price; contracts; orders |

### A29 Quoted spread

| Metric or family                    | Stage   | Priority | Definition                                                                   | Units            |
| ----------------------------------- | ------- | -------- | ---------------------------------------------------------------------------- | ---------------- |
| `spread_mean_ticks`                 | second  | core     | mean_P(s_i), s_i=(a_i-b_i)/tau                                               | ticks            |
| `spread_volume_weighted_mean_ticks` | second  | optional | sum_P(q_i\*s_i)/sum_P(q_i)                                                   | ticks            |
| `spread_max_observed_ticks`         | second  | core     | max_P(s_i)                                                                   | ticks            |
| `spread_min_observed_ticks`         | second  | optional | min_P(s_i)                                                                   | ticks            |
| `spread_last_observed_ticks`        | second  | optional | (last_ask-last_bid)/tau                                                      | ticks            |
| `spread_std_at_trades_ticks`        | second  | optional | sqrt(mean_P((s_i-mean_P(s))^2))                                              | ticks            |
| `wide_spread_volume_pct`            | second  | optional | 100\*sum_P(q_i\*1[s_i>k])/sum_P(q_i)                                         | percent          |
| `wide_spread_observation_pct`       | second  | optional | 100\*count_P(s_i>k)/count(P)                                                 | percent          |
| `relative_quoted_spread_bps`        | second  | optional | mean_P(10000\*(a_i-b_i)/m_i), m_i>0                                          | basis points     |
| `spread_by_aggressor_side`          | second  | optional | VW(s_i \| eps_i=+1); VW(s_i \| eps_i=-1); optionally unknown side separately | ticks            |
| `spread_percentile_W`               | rolling | optional | prior_rank_W(S_t)                                                            | percentile score |
| `spread_change_h`                   | rolling | optional | S_t-S\_(t-h)                                                                 | ticks            |

### A30 Sampled midpoint

| Metric or family                   | Stage   | Priority | Definition                                        | Units |
| ---------------------------------- | ------- | -------- | ------------------------------------------------- | ----- |
| `midpoint_sampled_ohlc`            | second  | core     | first_P(m_i), max_P(m_i), min_P(m_i), last_P(m_i) | price |
| `midpoint_mean_at_trades`          | second  | optional | mean_P(m_i)                                       | price |
| `midpoint_volume_weighted_mean`    | second  | optional | sum_P(q_i\*m_i)/sum_P(q_i)                        | price |
| `midpoint_std_at_trades_ticks`     | second  | optional | sqrt(mean_P(((m_i-mean_P(m))/tau)^2))             | ticks |
| `midpoint_range_observed_ticks`    | second  | core     | (mid_high_observed-mid_low_observed)/tau          | ticks |
| `midpoint_return_h_ticks`          | rolling | core     | (M_t-M\_(t-h))/tau                                | ticks |
| `midpoint_within_bar_change_ticks` | second  | optional | (last_P(m)-first_P(m))/tau                        | ticks |

### A31 Sampled midpoint paths

| Metric or family                       | Stage  | Priority | Definition                                                                 | Units         |
| -------------------------------------- | ------ | -------- | -------------------------------------------------------------------------- | ------------- |
| `midpoint_path_sq_change_ticks2`       | second | optional | sum over consecutive valid observations within bar of ((m_i-m_prev)/tau)^2 | ticks squared |
| `midpoint_path_abs_change_ticks`       | second | optional | sum over eligible within-bar transitions abs(m_i-m_prev)/tau               | ticks         |
| `midpoint_transition_direction_counts` | second | optional | counts of eligible sampled midpoint steps >0, \<0, =0                      | transitions   |
| `midpoint_path_efficiency`             | second | optional | 100\*abs(last_m-first_m)/(tau\*midpoint_path_abs_change_ticks)             | percent       |

### A32 Midpoint Indicator

| Metric or family                     | Stage   | Priority | Definition                                                                                                                            | Units              |
| ------------------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `midpoint_rsi_N`                     | rolling | core     | 100\*RMA_N(max(M_t-M_prev,0))/(RMA_N(gain)+RMA_N(loss))                                                                               | RSI score          |
| `midpoint_change_std_W_ticks`        | rolling | core     | Population SD of eligible one-second midpoint changes (M_t-M_prev)/tau whose timestamps fall inside the last W elapsed clock seconds. | ticks              |
| `midpoint_atr_N`                     | rolling | optional | TR_t=max(Hmid-Lmid,abs(Hmid-Cmid_prev),abs(Lmid-Cmid_prev)); ATR=RMA_N(TR)/tau                                                        | ticks              |
| `midpoint_standard_price_indicators` | rolling | optional | Apply specified SMA, EMA, MACD, ROC, Bollinger, stochastic, CCI or other price-indicator definition to saved midpoint close/OHLC      | indicator-specific |

### A33 Price Comparison

| Metric or family                      | Stage   | Priority | Definition                                              | Units |
| ------------------------------------- | ------- | -------- | ------------------------------------------------------- | ----- |
| `trade_midpoint_return_gap_h_ticks`   | rolling | optional | ((trade_close_t-trade_close\_(t-h))-(M_t-M\_(t-h)))/tau | ticks |
| `trade_midpoint_rsi_difference_score` | rolling | optional | 50+0.5\*(RSI_mid-RSI_trade)                             | score |

### A34 Displayed quantity imbalance

| Metric or family                       | Stage   | Priority | Definition                                                      | Units                  |
| -------------------------------------- | ------- | -------- | --------------------------------------------------------------- | ---------------------- |
| `book_imbalance_mean_score`            | second  | core     | mean_D(J_i), J_i=100\*B_i/(B_i+A_i)                             | score                  |
| `book_imbalance_volume_weighted_score` | second  | optional | sum_D(q_i\*J_i)/sum_D(q_i)                                      | score                  |
| `book_imbalance_last_score`            | second  | core     | last_D(J_i)                                                     | score                  |
| `book_imbalance_std`                   | second  | optional | population SD_D(I_i)                                            | signed-imbalance units |
| `bid_heavy_observation_pct`            | second  | optional | 100\*count_D(I_i>0)/count(D)                                    | percent                |
| `strong_book_imbalance_volume_pct`     | second  | optional | 100\*sum_D(q_i\*1[I_i>k])/sum_D(q_i); symmetric I_i\<-k output  | percent                |
| `book_imbalance_ema_trend`             | rolling | core     | 50+0.5\*(EMA_hfast(J_t)-EMA_hslow(J_t))                         | score                  |
| `book_imbalance_persistence_W`         | rolling | optional | 100\*count(valid seconds with J_t>50)/count(valid seconds in W) | percent                |
| `book_imbalance_change_h_score`        | rolling | optional | 50+0.5\*(J_t-J\_(t-h))                                          | score                  |

### A35 Displayed Depth

| Metric or family                  | Stage   | Priority | Definition                                                | Units            |
| --------------------------------- | ------- | -------- | --------------------------------------------------------- | ---------------- |
| `bid_depth_mean`                  | second  | core     | mean_D(B_i)                                               | contracts        |
| `ask_depth_mean`                  | second  | core     | mean_D(A_i)                                               | contracts        |
| `total_depth_mean`                | second  | core     | mean_D(B_i+A_i)                                           | contracts        |
| `side_depth_extrema`              | second  | optional | min_D(B),max_D(B),min_D(A),max_D(A),min_D(B+A),max_D(B+A) | contracts        |
| `side_depth_volume_weighted_mean` | second  | optional | sum_D(q\*B)/sum_D(q); sum_D(q\*A)/sum_D(q)                | contracts        |
| `opposite_depth_by_aggressor`     | second  | optional | VW(A_i \| eps=+1); VW(B_i \| eps=-1)                      | contracts        |
| `depth_percentile_W`              | rolling | core     | prior_rank_W(L_t)                                         | percentile score |
| `depth_ratio_W`                   | rolling | optional | L_t/median(valid prior W-window L)                        | ratio            |
| `depth_log_change_h`              | rolling | optional | log(L_t/L\_(t-h))                                         | log ratio        |

### A36 Weighted Midpoint

| Metric or family                    | Stage  | Priority | Definition                                                   | Units |
| ----------------------------------- | ------ | -------- | ------------------------------------------------------------ | ----- |
| `weighted_midpoint_sampled_ohlc`    | second | optional | w_i=(a_i\*B_i+b_i\*A_i)/(B_i+A_i); first/max/min/last_D(w_i) | price |
| `weighted_midpoint_tilt_mean_ticks` | second | optional | mean_D((w_i-m_i)/tau)=mean_D(s_i\*I_i/2)                     | ticks |
| `weighted_midpoint_tilt_last_ticks` | second | optional | last_D(s_i\*I_i/2)                                           | ticks |

### A37 Order Count Structure

| Metric or family                       | Stage  | Priority | Definition                                         | Units               |
| -------------------------------------- | ------ | -------- | -------------------------------------------------- | ------------------- |
| `top_order_count_mean`                 | second | optional | mean_C(nb_i), mean_C(na_i), mean_C(nb_i+na_i)      | orders              |
| `order_count_imbalance_mean_score`     | second | optional | mean_C(100\*nb_i/(nb_i+na_i))                      | score               |
| `average_displayed_order_size_by_side` | second | optional | mean(B_i/nb_i \| nb_i>0); mean(A_i/na_i \| na_i>0) | contracts per order |
| `quantity_count_imbalance_gap_score`   | second | optional | mean_C(50+25\*(I_quantity_i-I_order_count_i))      | score               |

### A38 Sampled Quote Transitions

| Metric or family                   | Stage  | Priority | Definition                                                                                                             | Units                |
| ---------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `sampled_quote_change_counts`      | second | optional | counts of observed transitions with changed bid price, ask price, bid size, ask size                                   | sampled transitions  |
| `sampled_same_price_depth_change`  | second | optional | sum(B_i-B_prev) where b_i=b_prev; sum(A_i-A_prev) where a_i=a_prev                                                     | contracts difference |
| `sampled_top_quote_pressure_proxy` | second | optional | sum over sampled transitions [1(b_i>=b_prev)\*B_i-1(b_i\<=b_prev)\*B_prev-1(a_i\<=a_prev)\*A_i+1(a_i>=a_prev)\*A_prev] | contracts proxy      |

### A39 Trade Quote Interaction

| Metric or family                        | Stage  | Priority | Definition                                                                   | Units                        |
| --------------------------------------- | ------ | -------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `execution_midpoint_deviation_vw_ticks` | second | optional | sum_P(q_i\*(p_i-m_i)/tau)/sum_P(q_i)                                         | ticks                        |
| `effective_spread_vw_ticks`             | second | optional | sum\_(P intersect K)(q_i\*2\*eps_i\*(p_i-m_i)/tau)/sum\_(P intersect K)(q_i) | ticks                        |
| `quoted_price_improvement_vw_ticks`     | second | optional | VW((a_i-p_i)/tau for buys; (p_i-b_i)/tau for sells)                          | ticks                        |
| `execution_location_volume_shares`      | second | optional | volume shares for p=b, p=a, b\<p\<a, p\<b or p>a                             | percent                      |
| `beyond_opposite_best_volume_pct`       | second | optional | 100\*sum(q_i\*1[(eps=+1 and p>a) or (eps=-1 and p\<b)])/sum(q_i)             | percent                      |
| `execution_relative_spread_position`    | second | optional | mean or VW of z_i=2\*(p_i-m_i)/(a_i-b_i)                                     | spread-relative signed units |
| `flow_book_alignment_score`             | second | core     | 50\*(1+sum\_(D intersect K)(q_i\*eps_i\*I_i)/sum\_(D intersect K)(q_i))      | score                        |
| `book_imbalance_by_aggressor`           | second | optional | VW(J_i \| buy), VW(J_i \| sell), optionally VW(J_i \| unknown)               | score                        |
| `trade_to_opposite_depth_ratio`         | second | optional | R_i=q_i/A_i for buys; q_i/B_i for sells; store side means and maxima         | dimensionless ratio          |
| `depth_scaled_flow_by_side`             | second | optional | Pbuy=sum_buy(q_i/A_i); Psell=sum_sell(q_i/B_i); Pnet=Pbuy-Psell              | dimensionless flow proxy     |
| `depth_scaled_flow_imbalance_score`     | second | optional | 100\*Pbuy/(Pbuy+Psell)                                                       | score                        |
| `midpoint_response_per_total_volume`    | second | optional | (M_t-M_prev)/tau / total_trade_volume_t                                      | ticks per contract           |

### A40 Past Outcome Context

| Metric or family               | Stage   | Priority | Definition                                                                                                                                                         | Units |
| ------------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `matured_markout_rolling_mean` | rolling | optional | sum(weight_j\*markout_j)/sum(weight_j) over labels with current_time-W \< label_available_at_j \<= current_time; default weight is eligible origin trade quantity. | ticks |

### A41 Data Quality

| Metric or family             | Stage  | Priority | Definition                                                                                                                                                                                                           | Units                       |
| ---------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `source_quality_diagnostics` | second | core     | Counts of malformed/rejected records, each relevant flag bit, unknown sides, locked/crossed/missing quotes and excluded transitions; coverage_status, has_trade, carried flags, source range and state completeness. | counts; flags; enums        |
| `timestamp_diagnostics`      | second | optional | Summaries of ts_recv-ts_event, ts_in_delta, and where logged app_arrival-ts_recv or published_at-bar_end; record negative values, clamping and invalid-origin counts.                                                | nanoseconds or milliseconds |

## Appendix B Future labels

These entries are excluded from the contemporaneous metric list. Materialize them in labels_1s only after their target data have become available. Preserve target-price staleness and contract/coverage rules. They describe future outcomes; they are not executable returns without a fill model.

### Future Sampled Midpoint Change H

(M_asof(origin_bar_end+h)-M_origin)/tau, where M_origin is the sampled midpoint state available for the completed origin bar and target_time=origin_bar_end+h.

Required state: Separate label table with origin feature revision, target_time, target observation timestamp, horizon and label_available_at. Finalize only after the target watermark and actual target-observation availability; never publish earlier than either.

Validity: Both states valid under an as-of observation policy; contract continuity and quality gates.

Never an input at origin t. A midpoint is not an executable market-order price. h in seconds and timing delay must be explicit.

### Trade Markout At Event H

eps_i\*(m_asof(T_i+h)-p_i)/tau; T_i is the configured aggregation clock, default ts_recv, and target_time=T_i+h.

Required state: Retain pending event price, side, quantity and target time until label maturity, or perform dedicated raw replay. Save target_time, target observation timestamp and label_available_at, gated by target watermark and actual observation availability. Exact event-relative targets are not generally recoverable from one-second rows.

Validity: Known side; target quote observation policy and coverage explicit; use latest available observation at or before target, not a future observation backfilled.

Forward outcome only. TBBO-derived target is sampled and may be stale; not own executable profit.

### Bar Common Horizon Signed Markout

[M_asof(origin_bar_end+h)\*sum_K(q_i\*eps_i)-sum_K(q_i\*eps_i\*p_i)]/[tau\*sum_K(q_i)]; all origin trades share target_time=origin_bar_end+h.

Required state: Preserve known-side eligible sum(q), sum(q\*eps) and sum(q\*eps\*p) at origin. Write separate label revision after target watermark and actual target-state availability, with target_time and label_available_at.

Validity: Known-side eligible weight>0; future midpoint valid.

This common bar-end horizon is not the same as event_time_i+h for every trade. Make that distinction explicit in name and model target.

## Appendix C Primary sources

Source facts establish the vendor schema, sampling, timestamp and side conventions, and selected standard formulas. Database layout, feature inventory, proxies, presets and implementation policies are engineering definitions in this report. None of the cited material establishes that this particular feature set will produce profitable US futures trades.

- **[S1]** [Databento TBBO schema](https://databento.com/docs/schemas/tbbo): Trade-attached pre-trade quotes, fields and fixed-point price representation.
- **[S2]** [Databento common fields enums and types](https://databento.com/docs/conventions/common-fields-enums-types): Timestamp/index conventions, side/action meanings, sentinel values and flags.
- **[S3]** [Databento CME Globex dataset specification](https://databento.com/docs/datasets/glbx-mdp3): CME trade-summary normalization, implied-side behavior and legacy timestamp limitations.
- **[S4]** [Databento OHLCV schema](https://databento.com/docs/schemas/ohlcv): Vendor aggregation clock, start labels, empty intervals and implementation differences.
- **[S5]** [Databento Live API](https://databento.com/docs/api-live?lang=raw): Historical/live record-format compatibility; application timing remains an explicit system policy.
- **[S6]** [Databento recovery after disconnection](https://databento.com/docs/api-live/basics/recovering-after-a-disconnection): Intraday replay cursor and duplicate-prefix handling.
- **[S7]** [Databento MBP TBBO and BBO comparison](https://databento.com/docs/faqs/difference-between-mbp-and-tbbo): Trade sampling and omission of intervening quote-only updates.
- **[S8]** [MDN JavaScript maximum safe integer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER): Safe integer limit and the need for exact representations beyond it.
- **[S9]** [TA Lib RSI implementation](https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_RSI.c): Wilder recurrence and current flat-series behavior. Production must pin a reviewed commit/version.
- **[S10]** [Databento microprice and book imbalance](https://databento.com/docs/examples/order-book/microprice?lang=python): Top-of-book weighted midpoint and displayed imbalance context.
- **[S11]** [SEC Report on the Practice of Preferencing](https://www.sec.gov/reports/report-practice-preferencing): Conventional signed effective-spread definition; no claim of securities-reporting compliance for this futures feature.
- **[S12]** [Cont Kukanov and Stoikov The price impact of order book events](https://arxiv.org/html/1011.6402v3): Full order-book-event OFI context; sparse TBBO endpoint proxies are not complete OFI.
- **[S13]** [Databento execution slippage and markouts](https://databento.com/docs/examples/algo-trading/execution-slippage?lang=python): Forward execution-context outcomes and markout concepts; our target/maturity policy is explicitly specified.
- **[S14]** [TA Lib function registry](https://ta-lib.org/functions/): Reference for named indicator families. Formulas/seeds in this handoff define the chosen variants.
- **[S15]** [Databento Trades schema](https://databento.com/docs/schemas/trades): Trade price, quantity, side, timestamps and provenance fields also present in the TBBO processing contract.
