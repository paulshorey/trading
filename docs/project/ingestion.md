# One-second ingestion

Status (November 1, 2026): implemented and tested on synthetic and real sessions in
throwaway databases. It has not been run on the `trading` database yet; see
[run it](#run-it). Metrics follow the [TBBO engineering handoff](tbbo-engineering-handoff.md);
[differences](#differences-from-the-handoff) are listed below.

The `research ingest` command reads Databento TBBO files and stores, for every contract
and every scheduled-open second, two rows computed by `strategy-core`, the code live
sessions run:

| Table                 | One row per second holds                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `market.bar_1s`       | The second's own exact statistics: OHLC, volume by aggressor side, CVD extremes, book sampled at trades |
| `market.candle_1m_1s` | The rolling `1m@1s` candle of rows `o − 59 … o`, and 87 normalized features of it                       |

Both are keyed by `(contract_id, slot_ordinal, end_ns)`: `slot_ordinal` is the row's
[index counter](../sliding-windows/README.md#rows-and-index-counters), and `phase` is a
virtual column, `slot_ordinal % 60`. Partitions are monthly on `end_ns`. Join the tables on
`(contract_id, slot_ordinal)`. Column descriptions and units are stored as PostgreSQL
comments (`\d+ market.candle_1m_1s`).

Rows are stored per contract. Each product also reads as **one permanent series**,
`product = 'GC'`, through the views `market.continuous_bar_1s` and
`market.continuous_candle_1m_1s`: every session's rows from that session's front contract
([continuous series](#continuous-series-per-product)). The rolling `1h@1m` tables are the
[next step](#next).

## Run it

Once, after pulling this code:

```sh
brew services start postgresql@18
uv run research db migrate              # applies 0002_second_rows
uv run research ingest plan GC SI       # what would be built; stores no second rows
uv run research ingest run GC SI        # build; progress on stderr, summary as JSON
uv run research ingest status           # series coverage, contracts, sizes, recent runs
```

`plan` reads every session's outright volumes from the DBN files once (about 15 s for a
year of GC and SI) and caches them with the roll schedule. `run` does the same planning and
then builds one process per contract (`--workers`, default cores − 2). Each session commits
its rows and its checkpoint together, so `run` can be interrupted and rerun at any time:
it continues where it stopped and never adds a session twice.

**After downloading new TBBO files** (a later month, or a re-delivered file), put the job
folder under `data/databento/tbbo/` as delivered, then:

```sh
uv run research catalog --verify        # checksums of every file
uv run research ingest plan GC SI       # shows extend, new, or repair per contract
uv run research ingest run GC SI
```

The plan extends the current front contract from its last checkpoint, adds contracts that
became front (with their lead sessions), and rebuilds any stored session whose files
changed, from the checkpoint before it.

**Other cases:**

| Need                                     | Command                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Another product (PL, ES, NQ, YM, RTY)    | `research ingest run PL`                                             |
| A specific contract, such as a far month | `research ingest run GC --contract GCV6` (every session it traded)   |
| Only part of the range                   | `--start 2026-06-01 --end 2026-09-30` (trade dates)                  |
| Longer warmup before each roll           | `--lead-sessions 10` (default 5)                                     |
| Rows built by older code or settings     | `research ingest run GC SI --rebuild` replaces those contracts' rows |

The first stored session of a contract is where its indicator states start. Adding earlier
sessions later (older downloads, `--lead-sessions` larger, an earlier `--start`) changes
every later value, so the plan reports `needs_rebuild` and waits for `--rebuild`.
`--start` and `--end` limit which new sessions are added; a repair or rebuild always covers
the contract's whole stored chain, so no stored session is dropped.

### What the plan decides

| Action          | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `new`           | Nothing stored: build every session of the span                                            |
| `extend`        | Stored sessions are current; build the new ones from the last checkpoint                   |
| `repair`        | A stored session's files changed: rebuild it and later sessions from the checkpoint before |
| `current`       | Nothing to do                                                                              |
| `stale`         | Stored by other code or settings (the builder hash differs): needs `--rebuild`             |
| `needs_rebuild` | New sessions before the first stored one, or its files changed: needs `--rebuild`          |
| `rebuild`       | With `--rebuild`: delete the contract's rows and build the span again                      |

**Spans.** Every contract that is ever the front contract (the [roll rule](#continuous-series-per-product),
`market.roll`) is stored from `--lead-sessions` sessions before it first becomes front
through its last front session, so its indicators are warm when the continuous series
switches to it. Spans cover every scheduled session between the first and last downloaded
ones: a session in a gap between downloads is stored as rows without data coverage
(`status` 0), never skipped, and is rebuilt once the gap is downloaded. The first session
after a gap chooses its front contract afresh.

**Builder version.** `market.builder` records a SHA-256 of the files that determine stored
values (`BUILDER_FILES` in `ingest.py`: the calculations in `strategy-core`, and the
calendar, file, source, ingestion, and storage modules), the trade-assignment timing,
feature settings, the calendar and phase origin, numeric package versions, and the column
list. Any change makes stored rows `stale`, including comment-only edits to those files:
rebuild before extending. Every session's `market.ingest_slice` row keeps the builder,
source files with checksums, the quality report, and the checkpoint. Cached session volumes
carry their own digest (`scan_sha256`, from `SCAN_FILES` and the timing settings) and are
read again from the DBN files when it changes, so rolls always come from current code.

## Continuous series per product

`market.continuous_bar_1s` and `market.continuous_candle_1m_1s` give each product one
series across contract rolls, with the columns of the stored tables plus `product`,
`trade_date`, `contract` (the source contract), `roll_basis`, and `rolled`. They are views
over the per-contract tables (`market.front_session` maps sessions to contracts), so they
take no storage and always follow the roll schedule.

- **One contract per session, never merged.** Delivery months trade at different prices
  (gold's months differ by the cost of carry, often hundreds of ticks), so mixing their
  trades would create false ranges and moves, and their books differ. Choosing the busiest
  contract second by second would flip between price levels near a roll.
- **The roll rule is the backtest's** (`source.next_front`): the front contract has the
  most volume in the previous complete session, switches at a session open, and only moves
  to a later delivery month. On the current data all seven products roll once per cycle and
  never back. The first session of the data uses its own volume (`roll_basis` =
  `same_session`, not causal).
- **One row per scheduled second.** Contracts of a product share the calendar, so
  `slot_ordinal` continues across rolls and the series has every index exactly once.
- **No artificial roll moves in features.** Each row's candle and features come from its
  own contract's history; the new front contract was stored from 5 sessions before its roll,
  so its indicators are warm and no feature sees the price difference between months. Raw
  prices (OHLC, VWAP) do jump at a roll: `contract` names the source, and `rolled` is true
  on each new contract's first session. Compute anything from raw prices within one
  contract; a window over `continuous_bar_1s` rows would mix contracts across a roll, while
  the stored candles never do.
- **Coverage.** `research ingest status` reports, per product, the front sessions stored and
  the first missing ones.

```sql
-- The last hour of GC 1m@1s features, whichever contract was front
SELECT end_ns, contract, rsi, ema21_atr, spread_bps
FROM market.continuous_candle_1m_1s
WHERE product = 'GC' AND slot_ordinal BETWEEN :o - 3599 AND :o
ORDER BY slot_ordinal;

-- One contract's same-phase candles (the inputs of a per-phase indicator). Bound the
-- range so the primary key is used; an unbounded `slot_ordinal % 60` filter scans.
SELECT slot_ordinal, close FROM market.candle_1m_1s
WHERE contract_id = :c AND slot_ordinal BETWEEN :o - 60 * 14 AND :o
  AND slot_ordinal % 60 = :o % 60
ORDER BY slot_ordinal;
```

Backtests use the same roll rule but warm a new contract by replaying `warmup_sessions`
(default 1), so their features can differ from the stored series for a while after a roll;
letting backtests read stored rows removes the difference ([next](#next)).

## Measured

On November 1, 2026, in a throwaway database with the real files (no rows were written to
`trading`):

- **Plan for GC and SI, one year:** 257 sessions each; front months GC Z5, G6, J6, M6, Q6,
  Z6 and SI Z5, H6, K6, N6, U6, Z6; 12 contracts, 564 contract-sessions, 46.5 million rows.
- **Speed:** a 23-hour session (82,800 rows) takes about 0.35 s to compute, 0.5 s to
  encode, and 1.4 s in all with the database writes, per worker. The whole year should take
  minutes with several workers; not measured.
- **Continuous series:** an hour of GC from `continuous_candle_1m_1s` in 7 ms, three
  sessions (248,400 rows) in 0.17 s of query time, around the July 30 roll from GCQ6 to GCZ6.
- **Size:** `bar_1s` 325 bytes per row and `candle_1m_1s` 951 bytes per row on disk,
  including indexes: about 27 GB per contract-year, or **about 59 GB for a year of GC and
  SI**. Features stay `double precision` (decided November 2, 2026), so stored features
  equal in-memory and live values exactly.

## Row rules

- **Every scheduled-open second is a row**, including seconds without trades (`status` 1)
  or without data coverage (`status` 0). Closures have no rows.
- **Trade assignment** uses the engine's [timing model](engine.md#timing-model) with the
  backtest defaults (`close_delay` 100 ms, `feed_latency` 5 ms): event time, or the slot
  open when the trade arrived after its slot had closed.
- **NULL, never zero, when undefined.** Missing seconds have NULL volume; seconds without
  trades have NULL prices; a book statistic is NULL when no trade in the second had a usable
  book (the handoff's validity subsets: P quotes, D displayed sizes, C order counts, K known
  side). Features are NULL unless the candle is complete (60 covered seconds with a trade);
  the latest-book features (`trade_age_s`, `book_age_s`, `depth_age_s`, `book_spread_bps`,
  `book_imbalance`) are also
  defined for windows without trades.
- **Session CVD** (`bar_1s.session_cvd`) runs from the calendar session's open and is NULL
  from the first missing second of that session on. Unknown-side volume stays out of it.
- **Exact base statistics.** Prices, spreads, the effective-spread numerator, depth sums,
  and times are integers (Databento fixed point); every field merges into minutes and
  windows by sums, extremes, or first and last values. Ratios are formed after merging.

## Metrics

Definitions, units, and NULL rules are in the code and the column comments:
`strategy_core/metrics.py` (per second), `window_metrics.py` (over the window), and
`indicators.py` and `features.py` (features).

| Handoff entries                                                                               | Stored as                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trade_ohlc`, `trade_volume`, `trade_record_count`, `trade_time_bounds`, `price_quantity_sum` | `bar_1s`: OHLC, high/low times, first/last times, volume, trades, `pv`                                                                                                            |
| `aggressor_volume`, `aggressor_record_count`, `volume_delta`, `cvd_bar_path`, `session_cvd`   | buy/sell volume and trades (unknown = rest), `delta_high`/`delta_low`, `session_cvd`                                                                                              |
| `trade_size_mean_std`, `trade_size_min_max`, `trade_size_concentration`                       | `size_sq`, `max_size`; features `size_hhi`, `max_size_ratio`, `size_side_ratio`                                                                                                   |
| `trade_price_path_variation`, `aggressor_transition_counts`                                   | `path_abs`, `upticks`, `downticks`, `side_pairs`, `side_switches`; features `path_*`, `uptick_ratio`, `side_switch_ratio`                                                         |
| `beyond_opposite_best_volume_pct`                                                             | `sweep_buy_volume`, `sweep_sell_volume`; `sweep_ratio`, `sweep_delta_ratio`                                                                                                       |
| Quote coverage (A27), retained quote state (A28), `last_quote_observation_age_ms`             | `quote_trades`, `depth_trades`, `order_trades` and their volumes, `last_bid`/`last_ask`/sizes, `quote_at_ns`, `depth_at_ns`; `trade_age_s`, `book_age_s`, `depth_age_s`, `book_*` |
| Quoted spread (A29), sampled midpoint (A30)                                                   | `spread_sum`, `spread_max`, `mid2_open`/`high`/`low`; `spread_bps`, `spread_max_bps`, `mid_rsi`, `rel_spread`                                                                     |
| Displayed imbalance and depth (A34, A35), weighted midpoint (A36)                             | `imbalance_*`, `bid_depth_sum`, `ask_depth_sum`, `tilt_sum`; `imbalance_mean`, `imbalance_vw`, `depth_imbalance`, `tilt_bps`, `book_imbalance`, `rel_depth`                       |
| Order counts (A37)                                                                            | `bid_orders_sum`, `ask_orders_sum`, `order_bid_size_sum`, `order_ask_size_sum`, `order_imbalance_sum`; `order_imbalance`, `order_size_log_ratio`                                  |
| Trade–quote interaction (A39)                                                                 | `eff_spread_sum`, `alignment_sum`, `buy_take_sum`, `sell_take_sum`; `eff_spread_bps`, `alignment`, `take_ratio`                                                                   |
| `source_quality_diagnostics`                                                                  | `bad_book_trades`, `late_trades`, `status`; `quote_ratio`, `bad_book_ratio`; per-session reports in `ingest_slice`                                                                |
| Candle geometry, momentum, VWAP distance (A8, A11)                                            | `range_bps`, `body_bps`, `body_ratio`, wick ratios, `vwap_bps`, `ret_5_atr`, `ret_15_atr`, engine `ret_atr`, `vwap_atr`                                                           |
| Trend averages and oscillators (A9, A10, A16, A17)                                            | `rsi`, `ema9_atr`, `ema21_atr`, `ema50_atr`, `macd_atr`, `macd_signal_atr`, `macd_hist_atr`, `ppo_bps`, `adx`, `plus_di`, `minus_di`, `stoch_k`, `stoch_d`, `cci`                 |
| Volatility, bands, breakout, recency, statistics (A13–A15, A18–A20)                           | `atr_bps`, `vol_bps`, `bb_z`, `bb_width_bps`, `donchian_*`, `aroon_up`, `aroon_down`, `linreg_slope_atr`, `linreg_r2`, `chop`, `er`                                               |
| Price–volume and flow (A3 rolling, A12, A22, A25)                                             | `delta_ratio`, `delta_ratio_5`, `delta_ratio_15`, `count_delta_ratio`, `cvd_high_ratio`, `cvd_low_ratio`, `rel_volume`, `rel_trades`, `cmf`, `mfi`, `flow_price_corr`             |
| Session context (A23)                                                                         | `session_elapsed_s`, `session_ret_bps`, `session_high_bps`, `session_low_bps`, `session_delta_ratio`                                                                              |

Indicators on the candle follow the [per-phase rule](../sliding-windows/design.md#4-indicators-per-phase):
recursive ones (EMA, MACD, Wilder RSI, ATR, ADX) keep one state per phase, and lookback
ones (stochastic, Bollinger, CCI, Donchian, Aroon, regression, money flow) read the
same-phase candles `o, o − 60, o − 120, …`. Periods count those candles, so RSI(14) is a
14-minute RSI updated every second. Only complete candles are inputs; a missing one makes
any lookback that includes it NULL.

Not stored yet; each can be added later by rebuilding from the DBN files:

- **Per second** (needs the trades): side VWAPs and their gap, price variance, and notional
  (A1); size quantiles, large-trade activity, Gini, and entropy (A2); signed size moments and
  large-trade delta (A3); CVD drawdown and drawup (A4); aggressor runs, sign autocorrelation,
  per-trade RSI, and step volume (A5); event timing (A6); volume at price and footprints
  (A7); spread dispersion and by-side splits, execution location shares, and price
  improvement (parts of A29 and A39); quote transitions and the pressure proxy (A38);
  timestamp diagnostics (A41).
- **On the candle** (from stored rows): StochRSI, Williams %R (a linear transform of %K),
  CMO, TRIX, KAMA, Keltner, parabolic SAR, Supertrend, ATR trailing references, OBV, the A/D
  line, the Chaikin oscillator, PVT, force index, ease of movement, the volume oscillator,
  return skewness, kurtosis, and autocorrelation, prior-session pivots, confirmed pivots and
  candlestick patterns, generic transforms (A26), and past-outcome context (A40). Labels
  (Appendix B) belong with the ML rows.

### Adding a metric or feature

Every stored value is computed from the DBN files, which are kept permanently
([data/README.md](../../data/README.md)), so any statistic can be added later:

1. **Per-second statistic:** add a `Field` to `metrics.FIELDS` (how it merges: sum, max,
   min, first, or last, and which count makes it valid) and compute it in
   `second_metrics`. Its window value follows from the merge kind.
   **Candle feature:** add it to `indicators.FEATURES` with a normalized unit and compute
   it in `CandleIndicators.update`.
2. The column registry in `strategy_core/rows.py` picks both up. Add a numbered migration
   with `ALTER TABLE ... ADD COLUMN`, and recreate the `market.continuous_*` views in it
   (they select `table.*`).
3. Existing tests cover the new value automatically: windows against direct aggregation,
   scale invariance, chunking and checkpoints, and the registry against the migrated
   tables. Add a hand-checked case for the formula.
4. `uv run research db migrate`, then `uv run research ingest run GC SI --rebuild`: the
   builder hash changed, so stored rows are `stale` until rebuilt.

## Differences from the handoff

1. **Bar clock.** Trades are assigned by event time with the engine's close delay, not
   bucketed by `ts_recv`; the handoff allows an event-time variant, and stored rows must equal
   what backtests and live sessions compute. `ts_recv` still decides lateness.
2. **Row labels.** Rows carry `end_ns` and the index counter `slot_ordinal`; the start is
   `end_ns − 1 s`. Windows and phases use only the counter.
3. **Indicator cadence.** Indicators run on the `1m@1s` candle per phase, not on consecutive
   one-second closes. A one-second-cadence RSI can be added from `bar_1s` later.
4. **Empty candles** are not indicator inputs (the engine's gap policy), instead of carrying
   the last close forward.
5. **Normalization** uses the project's units (`features.Unit`: bps, ATR multiples, ratios,
   0–100 indexes, log ratios, seconds) instead of generic 0–100 scores. Fitted transforms
   (percentiles, tanh scaling) belong to model training, fitted on training folds only.
6. **Raw files are kept.** DBN files are the permanent archive, so first-pass statistics that
   are not stored yet can be added by rebuilding; nothing is lost by omitting them now.
7. **`pv`** (price × size) is a double in quoted units, as in the engine; OHLC, volumes,
   spreads, depth, and the effective-spread numerator are exact integers.
8. **Revisions.** One stored version per contract and session; a rebuild replaces it and the
   builder records what built it. Immutable as-seen decision rows come with live sessions.
9. **Side switches** count consecutive trades within a second; price paths bridge seconds.
10. **Continuous series.** As the handoff requires, rows are computed per contract; the
    product series is a mapping over them (one front contract per session), never an
    aggregation across contracts.

## Tests

`lib/strategy-core/tests/test_metrics.py` and `test_rows.py`: the handoff's numeric
reference second, validity subsets, windows equal to direct aggregation of their trades,
identical rows and state for whole-session and second-by-second processing, exact
checkpoint restore, scale invariance of every feature, session CVD resets, and per-phase
parity with plain references (RSI, EMA, stochastic, Bollinger, Donchian, regression,
efficiency ratio, ADX). `apps/backtest-runner/tests/test_ingest.py`: the schema equals the
registry, binary COPY range checks, and an end-to-end run with two contracts and a roll:
build, rerun without changes, extend from a checkpoint (stored rows equal an in-memory
build), repair after a file changes, rebuild, and stale detection; the continuous series
has one row per second, each session from its front contract, across the roll. Rolls only
move forward (`test_runner.py`, `test_ingest.py`).

## Next

1. Run the ingest for GC and SI and check `ingest status` and the per-session reports,
   especially 2025-11-28 and the other `degraded` dates.
2. **`1h@1m` rows**: `market.bar_1m` rolled up from `bar_1s` (the metric fields merge by
   their kinds, as `bars.combine` does for OHLCV) and `market.candle_1h_1m` with the same
   features on the `BIAS` window spec, as a second builder in the same ingest.
3. Let backtests read stored rows when the builder matches the run.
4. Load Databento `definition` records into `market.contract` (expirations).
