# Trade-metrics reference

What a stored trade metric means, how it is computed from trades and the book at each trade,
and how it merges from seconds into minutes and windows. The definitions come from an
engineering specification written for Databento TBBO records. The project's data is MBP-1
(November 15, 2026), whose trade records are exactly the TBBO records, so the definitions
apply unchanged to the stored trade metrics.

**What is stored is decided by the column registry, not by this page**: the stage `COLUMNS`
in code (`lib/strategy-core/src/strategy_core/`, mainly `metrics.py`, `stage_bar_1s.py`,
`stage_step_bar.py`, `stage_step_stats.py`) and the table `market.column_registry`, which
holds every stored column with its role (feature, context, or key) and a description (also
a PostgreSQL column comment). Where this page names a metric that no stored column
carries, it says so ([not stored](#not-stored)). The stored tables and how they are built
are in [ingestion](ingestion.md).

The rest of the original specification (the logical database schema, live-session and
recovery rules, the 183-entry metric inventory, future labels, and sources) is archived in
[trade-metrics-appendix.md](../archive/trade-metrics-appendix.md).

## 1. Principles

- **One code path.** Historical files and live sessions use the same aggregation and indicator
  code (`strategy-core`). Never reimplement a metric in SQL or a script.
- **Keep exact base statistics apart from rolling indicators.** A new window, indicator or
  normalization then needs no new download: sums, extremes, first and last values, and the
  path fields are stored per second and merge exactly into larger windows.
- **Validate trades independently of the book.** A valid trade with an unusable quote still
  counts toward OHLCV and classified CVD. Each book metric has its own valid count.
- **NULL, never zero, when undefined.** Missing values, zero measurements, unknown sides, and
  rejected records stay distinguishable. A healthy second without trades has zero volume and
  NULL prices; a second without data coverage has NULL volume.
- **Causal.** A row labeled by its end covers the half-open second before it and cannot be used
  earlier. No feature may read data received after the decision.

## 2. Inputs

### 2.1 What a trade record carries

Each accepted trade has a price and size, an aggressor side, and the best bid and ask just
before the trade: price, displayed size, and order count on each side. Keep those fields
together as one observation before deriving any nonlinear metric. Prices are Databento
fixed-point integers (units of 10⁻⁹); times are exact epoch nanoseconds. A valid futures price
may be zero or negative: reject Databento's undefined value, not every nonpositive price.

### 2.2 Aggressor side and counting

`B` is a buyer aggressor, `A` a seller aggressor, `N` unspecified. Unknown-side volume stays in
total volume, is stored separately, and is never signed into CVD or classified as a sell
from the candle's direction. It is mostly the outright legs of spread trades. CME reports each
trade summary as one record, so a trade count is a count of records, not of orders or
traders.

### 2.3 Exact numbers

Prices, spreads, the effective-spread numerator, depth sums, and times are stored as integers.
Products such as price × size can exceed 64 bits, so `pv` (price × size) is a double in
quoted units, as in the engine. Floating-point sums are added oldest first everywhere, so a
minute equals the rolling window that ends with it to the bit.

### 2.4 Validity subsets

| Subset                | Eligibility                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| Accepted trade        | Trade record with a defined price and a positive, defined size                   |
| **P** quote prices    | Accepted trade with a usable bid and ask, and bid at most ask (crossed excluded) |
| **D** displayed depth | P with nonnegative sizes and a positive combined size                            |
| **C** order counts    | D with usable counts and a positive combined count                               |
| **K** known side      | Aggressor `B` or `A`, intersected with the subset the formula needs              |

A side-specific division also needs that side's size or count above zero. The valid counts are
stored beside each metric (`quote_trades` for P, `depth_trades` for D, `order_trades` for C,
and the known-side volumes), and a book statistic is NULL when its count is zero.

## 3. How seconds are made

Trades are assigned to a second by the engine's [timing model](engine.md#timing-model), by event
time with a close delay, not by arrival time (`ts_recv` still decides lateness). The second row
carries its end time `end_ns` and index counter `slot_ordinal`; the second is `[end − 1 s, end)`.

What a row keeps, so that larger windows can be built without the trades:

| Summary                | State kept                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| OHLCV and VWAP         | First and last price and time, high and low and their times, volume, count, `pv`      |
| Side flow              | Buy, sell, and unknown volume and trade counts                                        |
| CVD path               | Net delta and the highest and lowest running delta (`delta_high`, `delta_low`)        |
| Path within the second | Largest drop and rise from a trade to a later one, and which extreme came first       |
| Book at trades         | Per valid subset: sums of spread, imbalance, depth, order counts, and effective spread |
| Quality                | Late trades, trades with a bad book, status                                            |

Joint book and flow terms (for example size × sign × imbalance) are summed per trade, because
separate means cannot rebuild them.

### 3.1 Empty and missing seconds

| Condition                       | Stored row                                                             |
| ------------------------------- | ---------------------------------------------------------------------- |
| Open second, no trades          | `status` 1; volume and counts 0; prices and book statistics NULL       |
| No data coverage                | `status` 0; NULL volume; never skipped, never carried across           |
| Scheduled closure               | No row                                                                 |

Indicators treat a covered second without trades as a flat candle at the last known price
(price indicators only; see [ingestion](ingestion.md#row-rules)). Nothing is carried across
missing data.

## 4. Core calculations

### 4.1 Volume and CVD

Let p be a trade's price, q its size, and ε its aggressor sign (+1 for `B`, −1 for `A`; unknown
has no sign). Vbuy, Vsell and Vunknown are the volumes in the second.

```text
V = Vbuy + Vsell + Vunknown
delta = Vbuy - Vsell
classified_volume = Vbuy + Vsell
vwap = sum(p * q) / V                                  # if V > 0

prefix[0] = 0
prefix[k] = prefix[k-1] + signed_increment[k]
cvd_open  = 0 if new_session else previous_cvd_close
cvd_high  = cvd_open + max(prefix)
cvd_low   = cvd_open + min(prefix)
cvd_close = cvd_open + delta
```

Unknown-side trades change total volume but not the classified delta. Denominators that use
classified volume and total volume must have different names. Stored forms: `session_cvd`
(from the session's open, NULL from the first missing second on) and `cvd` (from the
contract's first stored second, never reset). A disagreement between price and flow is
descriptive; it does not show absorption or who traded.

### 4.2 Trade-price RSI

Wilder RSI of closes with N changes:

```text
change[t] = close[t] - close[t-1]
gain[t] = max(change[t], 0);  loss[t] = max(-change[t], 0)
avg_gain = mean(first N gains);  avg_loss = mean(first N losses)       # seed
avg_gain = ((N-1) * avg_gain + gain[t]) / N                           # then
avg_loss = ((N-1) * avg_loss + loss[t]) / N
RSI = 100 * avg_gain / (avg_gain + avg_loss)
# Both averages zero: RSI = 50 after warm-up. Only gains: 100. Only losses: 0. Before warm-up: NULL.
```

Wilder smoothing uses α = 1/N, not the EMA's 2/(N+1). A minute RSI is computed from minute
closes, never as an average of second RSIs. As stored, indicators run per phase on the window's
candles (`rsi` is RSI(14) of the same-phase candles 60 rows apart), not on consecutive
one-second closes; see [ingestion](ingestion.md#row-rules).

## 5. Book at trades

Let b and a be the bid and ask, B and A their displayed sizes, nb and na their order counts,
and τ the tick size. The book is sampled just before each trade's effect, and every second-level
mean is over the valid trades of the right subset (equal weight per trade unless stated).

| Per-trade value         | Formula                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Quoted spread           | s = (a − b) / τ                                                                        |
| Midpoint                | m = (a + b) / 2                                                                        |
| Displayed imbalance     | I = (B − A) / (B + A); score J = 100 · B / (B + A)                                     |
| Weighted midpoint       | w = (a·B + b·A) / (B + A); tilt in ticks = (w − m) / τ = s · I / 2                     |
| Order-count imbalance   | 100 · nb / (nb + na); also B / nb and A / na where the counts are positive             |
| Effective spread        | e = 2 · ε · (p − m) / τ, known-side trades only                                        |
| Trade relative to depth | R = q / A for a buy, q / B for a sell; can exceed 1                                    |
| Flow and book alignment | 50 · (1 + sum(q · ε · I) / sum(q)) over known-side, depth-valid trades                 |

The book is read only at trades: the quote changes between trades are not stored (see
[engine](engine.md#data-limits-mbp-1)).

**Compute nonlinear values before averaging.** Compute each trade's ratio, product, and
eligibility, then add it to the sum. The mean of B/(B+A) differs from mean(B)/(mean(B)+mean(A)),
and a mean of second means is an equal-second statistic, unlike pooling the trades. For each
mean keep the numerator and the eligible count; for a size-weighted one, sum(q · x) and the
eligible sum(q). Unknown-side trades count in book-only statistics and are left out only where
the formula needs a sign.

**Redundancy.** For a positive spread, 100 · (w − b) / (a − b) equals J exactly, so keeping both
as model inputs adds nothing. When trades execute at the best ask or bid, effective spread
equals the quoted spread.

## 6. Merging into minutes and windows

A minute, a ten-second row, or a rolling window is built from aligned second rows, never from
the trades again. A window needs every in-session child row; a missing one makes the parent
missing.

| Statistic              | Correct merge                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Trade OHLC             | First observed open, maximum high, minimum low, last observed close; NULL if no trades |
| Volume and counts      | Add side volumes, counts, delta, and `pv`; recompute VWAP from the sums                |
| Means and ratios       | Add numerators and denominators, then divide; never average child ratios               |
| Central moments        | Merge count, mean and M2: d = mean₂ − mean₁; M2 = M2₁ + M2₂ + d² · n₁n₂/(n₁+n₂)       |
| Sampled midpoint OHLC  | Merge endpoints and extremes with their times                                          |
| CVD extremes           | Concatenate the prefix paths with offsets (below); net delta alone is not enough        |
| Price and flow paths   | Add the within-child transition sums plus one bridge between each pair of children      |
| RSI and recursive ones | Recompute on the parent cadence; preserve state for streaming                           |

**Exact CVD prefix merge.** For consecutive children A then B, each relative to its own start:

```text
delta_parent      = delta_A + delta_B
prefix_max_parent = max(prefix_max_A, delta_A + prefix_max_B)
prefix_min_parent = min(prefix_min_A, delta_A + prefix_min_B)
cvd_high_parent   = cvd_open_parent + prefix_max_parent
cvd_low_parent    = cvd_open_parent + prefix_min_parent
```

Stored rows hold exactly these (`delta_high`, `delta_low`), so the CVD open, high, low, and
close of any window follow without rereading trades. The path fields `drawdown`, `drawup`, and
`extreme_order` merge with the high and low.

## 7. Normalization

Raw values are kept in meaningful units; model inputs must be scale-free
(`strategy_core.features.Unit`: basis points, ATR multiples, ratios, 0 to 100 indexes, log ratios,
seconds). Each transform must say what its number means: a percentile, an imbalance, and an RSI
all use 0 to 100 and measure different things.

- A native bounded value (RSI, a volume share) stays as it is. A signed imbalance in [−1, 1]
  maps to 50 · (1 + I).
- NULL plus a validity count marks an undefined value; it is never replaced by a neutral 50.
- Fitted transforms (percentiles, tanh scaling) belong to model training, fitted on the training
  folds only. Never normalize with a future high or low, full-session volume, or ranks over the
  whole dataset.
- A value in ATRs divides by the ATR floored at the spread
  ([AGENTS.md](../../AGENTS.md#normalized-features-required)).

## 8. Stored columns by metric

Column names as stored. Per-second columns are on `bar_1s`, and the same names on the other bar
tables; features are in the window tables (`candle_*`, `stats_*`, `vol_*`). Code:
`strategy_core/metrics.py` (per second), `window_metrics.py` (over a window), `indicators.py`
and `features.py` (features).

| Metric                         | Stored columns                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- |
| OHLC, volume, count, VWAP sum  | OHLC, `first_at_ns`, `last_at_ns`, volume, trades, `pv`                           |
| Side flow and CVD              | Buy and sell volume and trades, `delta_high`, `delta_low`, `session_cvd`, `cvd`   |
| Trade sizes                    | `size_sq`, `max_size`; features `size_hhi`, `max_size_ratio`, `size_side_ratio`   |
| Price path and side changes    | `path_abs`, `upticks`, `downticks`, `side_pairs`, `side_switches`, `first_side`, `last_side`, `drawdown`, `drawup`, `extreme_order`; features `path_*`, `uptick_ratio`, `side_switch_ratio` |
| Sweeps beyond the opposite best| `sweep_buy_volume`, `sweep_sell_volume`; `sweep_ratio`, `sweep_delta_ratio`       |
| Book coverage and last book    | `quote_trades`, `depth_trades`, `order_trades` and volumes, `last_bid`, `last_ask`, last sizes, `quote_at_ns`, `depth_at_ns`; `trade_age_s`, `book_age_s`, `depth_age_s` |
| Spread and midpoint            | `spread_sum`, `spread_max`, `mid2_open`, `mid2_high`, `mid2_low`; `spread_bps`, `spread_max_bps`, `mid_rsi`, `rel_spread` |
| Imbalance, depth, tilt         | `imbalance_sum`, `imbalance_last`, `bid_depth_sum`, `ask_depth_sum`, `tilt_sum`; `imbalance_mean`, `imbalance_vw`, `depth_imbalance`, `tilt_bps`, `book_imbalance`, `rel_depth` |
| Order counts                   | `bid_orders_sum`, `ask_orders_sum`, `order_bid_size_sum`, `order_ask_size_sum`, `order_imbalance_sum`; `order_imbalance`, `order_size_log_ratio` |
| Trade and book together        | `eff_spread_sum`, `alignment_sum`, `buy_take_sum`, `sell_take_sum`; `eff_spread_bps`, `alignment`, `take_ratio` |
| Source quality                 | `bad_book_trades`, `late_trades`, `status`; `quote_ratio`, `bad_book_ratio`; per-session reports in `market.ingest_slice` |
| Candle shape and momentum      | `range_bps`, `body_bps`, `body_ratio`, wick ratios, `vwap_bps`, `ret_5_atr`, `ret_15_atr` |
| Trend and oscillators          | `rsi`, `ema9_atr`, `ema21_atr`, `ema50_atr`, `macd_*`, `ppo_bps`, `adx`, `plus_di`, `minus_di`, `stoch_k`, `stoch_d`, `cci` |
| Volatility, bands, regression  | `atr_bps`, `vol_bps`, `bb_z`, `bb_width_bps`, `donchian_*`, `aroon_up`, `aroon_down`, `linreg_slope_atr`, `linreg_r2`, `chop`, `er` |
| Price-volume and flow ratios   | `delta_ratio`, `delta_ratio_5`, `delta_ratio_15`, `count_delta_ratio`, `cvd_high_ratio`, `cvd_low_ratio`, `rel_volume`, `rel_trades`, `cmf`, `mfi`, `flow_price_corr` |
| Window statistics              | `stats_*`: `rv_bps`, `rv_atr`, `ret_std_bps`, `ret_skew`, `ret_autocorr`, `vr_5`, `up_minute_ratio`, `drawdown_atr`, `drawup_atr`, `high_pos`, `low_pos`, `session_vwap_atr`, `prior_*_atr`, `cvd_close_corr` |
| Volatility family              | `vol_*`: `atr5_bps`, `atr50_bps`, `atr_*_log`, `bull_atr_bps`, `bear_atr_bps`, `bull_bear_skew`, `*_adverse_atr_bps`, `*_excursion_atr`, `*_dist_atr`, `*_age_s`, `atr_tod_log`, `day_*`, `tr_atr`, `parkinson_bps`, `gk_bps`, `spread_atr` |
| Session context                | `session_elapsed_s`, `session_ret_bps`, `session_high_bps`, `session_low_bps`, `session_delta_ratio` |

Some of these names are for the `1m@1s` candle only, or are renamed per timeframe; the column
registry is exact. Swings, structure, and their columns are described in
[pivot-structure-design](pivot-structure-design.md) and [series-structure-spec](series-structure-spec.md).

### Not stored

Each can be added later by rebuilding from the DBN files ([ingestion](ingestion.md#adding-a-stage-or-a-metric)).

- **Per second (needs the trades):** side VWAPs and their gap, price variance and notional;
  size quantiles, large-trade activity, Gini, and entropy; signed size moments and large-trade
  delta; CVD drawdown and drawup; aggressor runs, sign autocorrelation, per-trade RSI, step
  volume; event timing; volume at price and footprints; spread dispersion and by-side splits,
  execution location shares, price improvement; quote transitions and the pressure proxy;
  timestamp diagnostics.
- **On the candle (from stored rows):** StochRSI, Williams %R, CMO, TRIX, KAMA, Keltner,
  parabolic SAR, Supertrend, OBV, the accumulation/distribution line, the Chaikin oscillator,
  PVT, force index, ease of movement, the volume oscillator, return kurtosis, floor-trader
  pivot levels, candlestick patterns, and generic transforms.
- **Not available from MBP-1:** depth beyond the best bid and ask, queue position, hidden
  liquidity, buyer and seller identity, open interest.

## 9. Tests the definitions must pass

The numeric fixture and the edge cases are in `lib/strategy-core/tests/` (`test_metrics.py`,
`test_rows.py`, `test_minutes.py`, `test_stages.py`).

**Numeric reference second.** Tick size 0.25, initial session CVD 100, three ordered trades.

| Offset  | Side | Trade       | Bid and ask     | Bid and ask size |
| ------- | ---- | ----------- | --------------- | ---------------- |
| 0.100 s | B    | 10 @ 100.25 | 100.00 / 100.25 | 300 / 100        |
| 0.200 s | A    | 20 @ 100.00 | 100.00 / 100.25 | 100 / 300        |
| 0.300 s | B    | 30 @ 100.50 | 100.25 / 100.50 | 400 / 100        |

| Expected output        | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Trade OHLC             | 100.25, 100.50, 100.00, 100.50                                              |
| Volume                 | Total 60; buy 40; sell 20; unknown 0; delta +20; record count 3             |
| Price-volume sum       | 6,017,500,000,000 in raw 1e-9 price units × contracts                       |
| Trade VWAP             | 100.2916666667                                                              |
| CVD path               | Relative prefixes 0, +10, −10, +20; session OHLC 100, 120, 90, 120          |
| Spread                 | Mean and maximum 1 tick                                                     |
| Sampled midpoint OHLC  | 100.125, 100.375, 100.125, 100.375; range 1 tick                            |
| Book score             | Per trade 75, 25, 80; mean 60; last 80; volume-weighted mean 60.8333333333  |
| Mean displayed sizes   | Bid 266.6666666667; ask 166.6666666667; their ratio, 61.5384615385, is not the mean book score 60 |
| Alignment              | Raw size-weighted ε · I = 0.55; mapped score 77.5                           |
| Last weighted midpoint | 100.45; tilt +0.3 tick                                                      |
| Effective spread       | 1 tick for each trade and for the volume-weighted mean                      |

**Edge and invariance cases:**

- Unknown side: add `N` size 5. Total and unknown volume rise by 5; classified delta stays +20.
- Boundaries and duplicates: a trade exactly at the slot's end enters the next slot. Distinct
  trades with equal timestamps all count.
- Chunking and restarts: a whole session, disjoint chunks, and second-by-second processing give
  identical statistics and recursive state.
- Validity: a trade with a missing or crossed book still counts toward OHLCV and CVD; zero
  denominators give NULL.
- Rollups: a minute equals direct aggregation of its trades, field by field. Vary the child trade
  counts so that a mean of means fails.
- RSI: seed from N changes; increasing series 100, decreasing 0, flat 50 after warm-up; exact
  checkpoint restoration.
- Causality: processing only the prefix up to T gives the same features through T as processing
  the whole stream.
- Scale invariance: multiplying all prices, or all sizes, leaves every feature unchanged.
