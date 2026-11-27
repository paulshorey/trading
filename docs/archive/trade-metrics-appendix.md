# Trade-metrics appendix (archived from the TBBO handoff)

Archived November 27, 2026. This is the part of the imported TBBO engineering specification
(`TBBO_Engineering_Handoff.docx`, version 1.0, November 1, 2026) that the stored rows do not
implement or that is not the schema used here: the logical database schema, the live-session
and recovery rules, the full metric inventory (Appendix A, 183 entries, most of them never
built), the future-label definitions, and the source list. It is kept for reference only.
The metrics that are stored, and their definitions, are in
[trade-metrics-reference.md](../project/trade-metrics-reference.md); what is stored is
decided by the column registry (`market.column`), not by this file. The companion
`TBBO_Metric_Catalog.json` is not in this repository. Where the text says TBBO, the project's
data is now MBP-1 (decided November 15, 2026), and the limits it names for quote changes
between trades no longer hold; depth beyond the best bid and ask is still not available.

## 3.3 Logical database schema

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

## 4.1 Availability and late data

Historical decoding and live subscriptions call the same reducer, timer interface and indicator implementation. Databento uses the same market-data record structures across historical and live services. Application arrival and decision timing still require explicit modeling. [S5]

At deployment, configure and version the allowed finalization delay L. A healthy live timer considers intervals ending at or before synchronized UTC now minus L, drains already-received events, then publishes completed rows. Track backlog and subscription health; stop claiming completeness when disconnected or materially behind. Sparse instruments need this timer because another trade may not arrive promptly.

Record bar_end_ns, app_arrival_ns where available, actual published_at_ns and feature_available_at_ns. A row labeled 10:00:00 describes [10:00:00, 10:00:01) and cannot be used at 10:00:00. A completed hourly indicator similarly becomes available only after its hour closes. Partial-period indicators require different names and definitions.

Keep immutable as_seen decision versions and separately corrected research revisions. A late event can repair the current state and produce a newer revision, but must not rewrite what a previous decision observed. Record the state-repair availability time. Replay for execution evaluation consumes the same as_seen versions and availability transitions.

Historical ts_recv is capture time, not the application’s actual arrival time. Without recorded live arrivals, apply an explicit simulated lag and interruption policy; do not claim exact reproduction of historic transport delays. Persist live arrival/publication logs for later replay.

## 4.2 Empty intervals and unknown coverage

| Condition                          | Output and indicator behavior                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healthy open second with no trades | Volume/counts/delta = 0; CVD unchanged; observed OHLC/VWAP and observed quote summaries = NULL. has_trade = false. No future backfill.                                                                            |
| Analysis prices on an empty second | Set indicator-only analysis_open/high/low/close to the latest known trade close, with carried=true and age. Observed OHLC stays NULL. Before any known price, remain NULL; gaps are not carried as complete data. |
| Quote carry                        | Maintain a separate analysis_midpoint or quote state if enabled, with age and carried flag. It represents the last TBBO observation and does not prove the current market quote.                                  |
| Feed gap or recovering period      | coverage_status identifies incomplete history. Store observed partial totals; block affected decisions. Repair from replay and checkpoint before restoring eligibility.                                           |
| Scheduled closure                  | Default emits no active-session rows. Hold within-contract price-indicator state. The next actual price change includes the reopen gap. Bar-count windows and elapsed-time windows are distinct.                  |
| Mid-session import                 | Without a session-start seed, mark session_cvd_complete=false and session_vwap_complete=false. An accumulation since import start is not the full-session value.                                                  |

## 4.3 Recovery and deterministic restarts

For historical imports, use checksummed file manifests and source ordinals. Reject overlapping ranges or resolve them through the import protocol. Rerunning the same source and version must not add volume again. Keep cursor advancement and state persistence in the same transaction.

For live reconnects, follow the provider’s documented replay cursor: last ts_event and the number of records already consumed at that timestamp, per schema/instrument; discard only the previously consumed replay prefix. Equal-time original trades must all survive. Persist the cursor with the matching aggregate state and verify this procedure against the pinned client/data version. [S6]

Checkpoint exact RSI/EMA and other recursive states, warm-up counts, rolling windows, session totals and normalization state. A fixed one-day reread does not necessarily reconstruct the exact recursive state. After an unknown gap, restore/replay from a valid checkpoint or explicitly reset and rewarm; retain the state version used by each decision.

For regular-cadence range indicators, use the separate analysis OHLC series consistently. For enabled quote-price indicators, a healthy empty second may use a flagged analytic OHLC equal to the last sampled midpoint. Book EMA presets likewise carry the previous sampled input across healthy empty seconds. Retain age, define any maximum-age eligibility threshold in configuration, and never count these carries as new observations. Fixed elapsed-time windows use time cutoffs; they do not extend backward to collect a fixed number of valid samples.

## 8.1 Indicator families and extensions

A saved price series supports many standard indicators. The catalog includes SMA/EMA/Wilder averages, RSI/StochRSI, MACD/PPO, momentum and ROC, Bollinger and channel measures, ATR/range measures, DMI/ADX, CCI, regression slopes, efficiency and return statistics. Volume and signed-flow families include VWAP, relative volume, OBV, accumulation/distribution, Chaikin measures, MFI, force and volume oscillators, with explicit variants and domain checks.

The generic rolling feature registry also applies causal sums, means, dispersion, quantiles, ranks, lags, differences, slopes, correlations and threshold/persistence rules to saved trade/quote series. Each new instance needs an exact formula, sufficient state, eligibility, units and timing. Avoid silently using a library’s default seed or NaN handling. Standard names can hide different implementations.

Higher-timeframe values joined to one-second rows must be the latest fully completed and available value unless a separately specified partial-timeframe feature is used. Cross-contract or cross-symbol features require synchronized as-of joins, instrument-specific units and independent coverage masks; they are not single-contract TBBO measurements.

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
