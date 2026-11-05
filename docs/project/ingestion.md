# Ingestion

Status (November 4, 2026): GC and SI are stored in local database `trading` by the stage
pipeline with a 40-session lead, rebuilt on the baseline schema
([results](handoff.md#baseline-rebuild-gc-and-si)); run 3 added the minute stages
([results](handoff.md#pr-b1-results-minute-stages), [measurements](#measured)), run 4 the
hourly window statistics ([results](handoff.md#pr-b2-results-hourly-statistics)), run 5 the
minute volatility ([results](handoff.md#pr-c1-results-minute-volatility)), and run 6 the second
volatility ([results](handoff.md#pr-c2-results-second-volatility)). Metrics follow the [TBBO engineering handoff](tbbo-engineering-handoff.md);
[differences](#differences-from-the-handoff) are listed below.

The `research ingest` command reads Databento TBBO files and stores, for every contract
and every scheduled-open second and minute, one row per **stage**, computed by
`strategy-core`, the code live sessions run ([stages and tiers](feature-pipeline.md)). Each
stage has its own table, version, and per-session checkpoint:

| Table                          | One row per                     | Holds                                                                                                                      |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `market.bar_1s` (tier 0)       | second `o`                      | The second's own exact statistics: OHLC, volume by aggressor side, CVD extremes, path drawdown and drawup, book at trades  |
| `market.bar_1m` (tier 0)       | minute `m` (seconds 60m−59…60m) | The same statistics merged exactly from the minute's 60 second rows, plus observed seconds and one-second returns          |
| `market.candle_1m_1s` (tier 1) | second `o`                      | The rolling `1m@1s` candle of rows `o − 59 … o`, and 87 normalized features of it                                          |
| `market.candle_1h_1m` (tier 1) | minute `m`                      | The rolling `1h@1m` candle of minute rows `m − 59 … m`, and 77 normalized features of it (per-phase hourly indicators)     |
| `market.stats_1h_1m` (tier 1)  | minute `m`                      | 16 statistics of the same window: realized volatility, minute-return moments, path, session levels, price-flow correlation |
| `market.vol_1s` (tier 1)       | second `o`                      | 28 volatility features of the `1m@1s` window: as `vol_1m`, plus realized volatility from its one-second returns            |
| `market.vol_1m` (tier 1)       | minute `m`                      | 26 volatility features of the same window: ATR horizons, bullish/bearish and adverse ATR, extremes, time-of-day, daily ATR |

Each is keyed by `(contract_id, slot_ordinal, end_ns)`: `slot_ordinal` is the row's
[index counter](../sliding-windows/README.md#rows-and-index-counters) at its own resolution,
and `phase` is a virtual column, `slot_ordinal % 60`. Minute `m` holds the seconds with
ordinals `60m − 59 … 60m`, since calendar boundaries are whole minutes, so the second row at
`60m` ends with minute `m`. Partitions are monthly on `end_ns`. Join tables of one
resolution on `(contract_id, slot_ordinal)`, and a minute to its last second on
`second.slot_ordinal = 60 * minute.slot_ordinal`. Column descriptions and units are stored
as PostgreSQL comments (`\d+ market.candle_1h_1m`).

Rows are stored per contract. Each product also reads as **one permanent series**,
`product = 'GC'`, through the views `market.continuous_bar_1s`, `continuous_bar_1m`,
`continuous_candle_1m_1s`, `continuous_candle_1h_1m`, `continuous_stats_1h_1m`,
`continuous_vol_1s`, and `continuous_vol_1m`: every session's rows from that
session's front contract ([continuous series](#continuous-series-per-product)).

## Run it

Once, after pulling this code:

```sh
brew services start postgresql@18
uv run research db migrate              # applies pending migrations
uv run research ingest plan GC SI       # what would be built; stores no rows
uv run research ingest run GC SI        # build; progress on stderr, summary as JSON
uv run research ingest status           # series coverage, contracts, sizes, recent runs
```

`plan` reads every session's outright volumes from the DBN files once (about 15 s for a
year of GC and SI) and caches them, and computes the roll schedule without publishing it, so
a plan changes nothing that queries read. `run` does the same planning and then builds one
process per contract (`--workers`, default cores − 2). Every stage is computed in memory
from the DBN files; only the stages that are not current are written. Each session commits
its rows and checkpoints together, so `run` can be interrupted and rerun at any time: it
continues where it stopped and never adds a session twice.

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
| A different lead before each roll        | `--lead-sessions 50` (default: derived, at least 40; see below)      |
| Rows built by older code or settings     | `research ingest run GC SI --rebuild` replaces those contracts' rows |

The first stored session of a contract is where its indicator states start. Adding earlier
sessions later (older downloads, `--lead-sessions` larger, an earlier `--start`) changes
every later value, so the plan reports `needs_rebuild` and waits for `--rebuild`.
`--start` and `--end` limit which new sessions are added; a repair or rebuild always covers
the contract's whole stored chain, so no stored session is dropped.

### What the plan decides

Stored sessions are replaced one at a time, each in one transaction, so a failed or
interrupted build leaves the remaining sessions on their previous, readable rows.

| Action          | Meaning                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `new`           | Nothing stored: build every session of the span                                                                            |
| `extend`        | Stored sessions are current; build the new ones from the last checkpoints                                                  |
| `add`           | A stage has no rows yet (a new stage): build it from the span start; nothing stored is replaced                            |
| `repair`        | A stored session's files changed: rebuild it and later sessions from the checkpoint before                                 |
| `current`       | Nothing to do                                                                                                              |
| `stale`         | A stage or the source was stored by other code or settings: needs `--rebuild` (rewrites only the stages that depend on it) |
| `needs_rebuild` | New sessions before the first stored one, or its files changed: needs `--rebuild`                                          |
| `rebuild`       | With `--rebuild`: rebuild from the first session that is not current; an interrupted rebuild resumes there                 |

**Spans.** Every contract that is ever the front contract (the [roll rule](#continuous-series-per-product),
`market.roll`) is stored from `--lead-sessions` sessions before it first becomes front
through its last front session, so its indicators are warm when the continuous series
switches to it. Contracts are keyed by symbol and delivery month, since one-digit-year
symbols repeat each decade (GCZ6 is December 2016 and December 2026). Spans cover every scheduled session between the first and last downloaded
ones: a session in a gap between downloads is stored as rows without data coverage
(`status` 0), never skipped, and is rebuilt once the gap is downloaded. The first session
after a gap chooses its front contract afresh.

**Builder versions.** Each stage has its own identity in `market.builder` (column `stage`): a
SHA-256 of its `MODULES` (its calculations in `strategy-core`), the row codec (`codec.py`),
its settings and columns, numeric package versions, and the identities of its inputs. The
market source has one too (`stage` = `source`): the calendar, file, and source modules, the
trade-assignment timing, the calendar and phase origin, and the Databento and calendar
package versions. Changing a stage's code makes that stage and every stage that reads it
`stale`; the others stay current, and a new stage is simply added. Ingestion's
orchestration (`ingest.py`, `store.py`) is in no identity, since it computes and encodes no
values; the end-to-end tests prove that stored rows equal the pipeline's output.

**Records.** `market.ingest_slice` keeps one row per stored contract session: its source
builder, its source files with checksums and covered windows, its quality report (including
`history_limited`), and the row bounds the continuous series reads. `market.stage_slice`
keeps one row per stage and session: the stage builder, its checkpoint, and `warm`. Cached
session volumes carry their own digest (`scan_sha256`: `SCAN_FILES`, which include
`ingest.py`, the timing settings, and the Databento and exchange-calendar package
versions) and their session hours; they are read again from the DBN files when either
changes, so rolls always come from current code and calendars.

**Lead and warm-up.** The lead (sessions stored before a contract first becomes front) is
derived from the stages' warm-ups, which follow from their indicator parameters
([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)), and is at least 40
sessions (`LEAD_FLOOR`) to reserve room for the planned stages. `plan` reports
`lead_sessions`, `required_lead` (the stage that needs most), and `warm_sessions` per stage;
a `--lead-sessions` shorter than a stage needs is refused. A stage's session is `warm` once
the contract has run its warm-up; a contract whose downloads start too late for the full
lead is reported `history_limited`. A longer indicator that raises the required lead makes
the plan prepend sessions, which shows as `needs_rebuild`.

## Continuous series per product

`market.continuous_bar_1s`, `continuous_bar_1m`, `continuous_candle_1m_1s`,
`continuous_candle_1h_1m`, `continuous_stats_1h_1m`, `continuous_vol_1s`, and `continuous_vol_1m` give each product
one series across
contract rolls, with the columns of the stored tables plus `product`,
`trade_date`, `contract` (the source contract), `roll_basis`, and `rolled`. They are views
over the per-contract tables (`market.front_session` maps sessions to contracts), so they
take no storage. `run` publishes each session's front contract to `market.roll` only once
that contract's rows for the session are stored; until then the session keeps its previous
entry, so a failed or interrupted build never removes a readable session or points it at
missing rows.

- **One contract per session, never merged.** Delivery months trade at different prices
  (gold's months differ by the cost of carry, often hundreds of ticks), so mixing their
  trades would create false ranges and moves, and their books differ. Choosing the busiest
  contract second by second would flip between price levels near a roll.
- **The roll rule is the backtest's** (`source.next_front`): the front contract has the
  most volume in the previous complete session, switches at a session open, and only moves
  to a later delivery month. On the current data all seven products roll once per cycle and
  never back. The opening sessions of each downloaded range have no usable previous session:
  they use their own volume, even if partial, or with none the range's first front
  (`roll_basis` = `same_session`, not causal). Sessions without any volume in their range
  get no front; `plan` and `run` list them as `unresolved_sessions`.
- **One row per scheduled second (or minute).** Contracts of a product share the calendar,
  so `slot_ordinal` continues across rolls and the series has every index exactly once. A
  session's minutes are the whole minutes inside its seconds `first_ordinal … last_ordinal`:
  `(first_ordinal + 59) / 60 … last_ordinal / 60`.
- **No artificial roll moves in features.** Each row's candle and features come from its
  own contract's history; the new front contract was stored from the lead (40 sessions)
  before its roll, so its indicators are warm and no feature sees the price difference between months. Raw
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

Run 6 (November 4, 2026, PR C2) added `vol_1s` to the stored GC and SI contracts (`add`,
8 workers): 868 contract-sessions in 5 min 47 s, computing every stage and writing only the new
table, 71,559,900 rows in 24.05 GB including indexes, plus 159 MB of checkpoints. Every row equals
an independent recomputation from the stored rows ([checks](handoff.md#pr-c2-results-second-volatility)).
In live sessions the stage adds about 0.08 ms per second (`research verify`).

Run 5 (November 4, 2026, PR C1) added `vol_1m` to the stored GC and SI contracts (`add`,
8 workers): 868 contract-sessions in 1 min 55 s, computing every stage and writing only the
new table, 1,192,665 rows in 0.42 GB including indexes, plus 156 MB of checkpoints (the
time-of-day buffer). Every complete window equals an independent recomputation from the stored
rows ([checks](handoff.md#pr-c1-results-minute-volatility)). The stage sets the required lead:
37 typical sessions (the daily percentile), inside the 40-session lead.

Run 4 (November 4, 2026, PR B2) added `stats_1h_1m` to the stored GC and SI contracts (`add`,
8 workers): 868 contract-sessions in 1 min 55 s, computing every stage and writing only the
new table, 1,192,665 rows in 0.35 GB including indexes. Every complete window equals an
independent recomputation from the stored rows ([checks](handoff.md#pr-b2-results-hourly-statistics)).

Run 3 (November 4, 2026, PR B1) added the minute stages to the stored GC and SI contracts
(`add`, 8 workers): 868 contract-sessions in 2 min 29 s, about 1.4 s of wall time per
session per worker, computing every stage and writing only `bar_1m` and `candle_1h_1m`.
They hold 1,192,665 rows each (596,235 GC and 596,430 SI minutes) and use 0.62 GB and
1.05 GB including indexes. Every minute equals the second rows at ordinal `60m`
([checks](handoff.md#pr-b1-results-minute-stages)).

The baseline rebuild completed November 4, 2026: 12 contracts, 868 contract-sessions,
71,559,900 rows per table, and 257/257 front sessions per product. The initial 8-worker
run took 14 min 47 s and ended `partial` after a stalled COPY connection was terminated;
a 1-worker retry built only SIU6's remaining 84 sessions in 3 min 29 s and ended `done`.
A fresh plan is entirely `current`; exact replay, warm-up, roll, and NULL checks passed
([results and evidence](handoff.md#baseline-rebuild-gc-and-si)). Fresh partitions use
21.28 GB for `bar_1s` and 61.79 GB for `candle_1m_1s`,
83.07 GB total including indexes (decimal); no `VACUUM FULL` was needed.

On November 4, 2026, run #2 (stages, 40-session lead, `--rebuild`, 8 workers) built 12
contracts and 868 contract-sessions, 71,559,900 rows per table, in 1,423.9 s (23 min 44 s),
about 1.6 s of wall time per contract-session per worker including deletes of the replaced
rows. Compute alone is about 0.4 s per GC session for both stages. After compaction,
`bar_1s` is 20.11 GB and `candle_1m_1s` 60.73 GB including indexes, 80.84 GB total
([details](handoff.md#rebuild-with-stages-gc-and-si)).

Run #1 (November 3, 2026, one builder, 5-session lead) stored 46,503,000 rows per table in
11 min 2 s with 8 workers, using 57.65 GB including indexes; its rows were replaced by run #2
and the logs removed.

Earlier throwaway-database measurements (November 1) found about 0.35 s to compute,
0.5 s to encode, and 1.4 s including writes for one 23-hour session per worker.
An hour of `continuous_candle_1m_1s` queried in 7 ms; three sessions (248,400 rows)
in 0.17 s. Features remain `double precision`, so stored features equal in-memory and
live values exactly; the completed run did not retime those query benchmarks.

## Confirm completion after an interrupted run

Check the JSON `status`, not just the process exit code: ingestion currently exits 0 even
when the result is `partial`. Rerun the same command to resume committed session checkpoints.
If the rerun builds sessions, require `status: done`; a successful no-op instead returns
`run_id: null`, empty `results`, and no `status` field. In either case, finish with a fresh
plan reporting every contract `current`. An uncommitted session rolls back if its connection
is closed; completed sessions remain readable. A stalled
COPY was recovered this way during the [baseline rebuild](handoff.md#baseline-rebuild-gc-and-si);
bounded transfer timeouts and a nonzero exit for incomplete runs remain reliability work.

## Row rules

- **Every scheduled-open second is a row**, including seconds without trades (`status` 1)
  or without data coverage (`status` 0). Closures have no rows. A file covers its UTC day
  only inside its job's requested range, so a job that starts or ends partway through a day
  leaves the rest of that day missing, not quiet. Two jobs covering different parts of the
  same day are refused, since one file is read per day ([data/README.md](../../data/README.md)).
- **Accepted trades only.** A trade record needs a defined price and a positive, defined size
  (zero and negative prices are valid futures prices). A displayed size or order count equal
  to Databento's undefined value is not a book observation. Rejected records never reach rows or roll
  volumes; each session counts them (`rejected_trades` in `market.ingest_slice.report`).
  None of the 325 million trade records on disk was rejected (checked November 2, 2026).
- **Trade assignment** uses the engine's [timing model](engine.md#timing-model) with the
  backtest defaults (`close_delay` 100 ms, `feed_latency` 5 ms): event time, or the slot
  open when the trade arrived after its slot had closed.
- **NULL, never zero, when undefined.** Missing seconds have NULL volume; seconds without
  trades have NULL prices; a book statistic is NULL when no trade in the second had a usable
  book (the handoff's validity subsets: P quotes, D displayed sizes, C order counts, K known
  side). Features are NULL unless the candle is complete (60 covered seconds with a trade),
  with two exceptions. **Price indicators** (RSI, ATR, EMA distances, MACD, ADX, midpoint
  RSI, and the lookbacks such as stochastic, Bollinger, Donchian, Aroon) are also defined
  on an empty window (covered, no trades) with a known last trade price: the price did not
  change, so they advance with a flat candle at that price, and its flows are zero (decided
  November 3, 2026). Nothing is carried across missing data, and activity baselines
  (`rel_volume`, `rel_trades`, `rel_depth`, `rel_spread`) still use windows with trades
  only. The latest-book features (`trade_age_s`, `book_age_s`, `depth_age_s`, `book_spread_bps`,
  `book_imbalance`) are also defined for windows without trades, but never across missing
  data: after a missing second they are NULL until the next trade, because trades during
  the gap are unknown.
- **Session CVD** (`bar_1s.session_cvd`) runs from the calendar session's open and is NULL
  from the first missing second of that session on. Unknown-side volume stays out of it.
- **Exact base statistics.** Prices, spreads, the effective-spread numerator, depth sums,
  and times are integers (Databento fixed point); every field merges into minutes and
  windows by sums, extremes, first and last values, or the path rules below. Ratios are
  formed after merging. Floating-point sums are added oldest first everywhere, so a minute
  equals the rolling window that ends with it to the bit.
- **Path within the second** (`drawdown`, `drawup`, `extreme_order`): the largest drop and
  rise from a trade to any later trade, in release order, and whether the first trade at the
  low or at the high came first (0: the same trade). They show what the high and low cannot,
  such as 99, 105, 100 falling 5 in a second that closes up, and merge exactly into windows
  with the high and low.
- **Minutes** (`bar_1m`) merge their 60 second rows by these rules (`stage_bar_1m.combine_metrics`
  applies the window rules within each minute), so a minute equals the `1m@1s` window that
  ends at ordinal `60m`, field by field. A minute with any missing second is missing
  (`status` 0) and stores only its keys and status. `session_cvd` is the value at the
  minute's last second. `observed_seconds` counts seconds with trades. For realized
  volatility, `ret2_sum` and `ret_count` hold the squared log returns between consecutive
  observed second closes inside the minute, and `first_close` (the first observed second's
  close) with the previous minute's `close` gives the return between minutes.
- **The hourly candle** (`candle_1h_1m`) is computed by the `1m@1s` code on minute rows,
  with indicators per phase `m % 60`; `active_ratio` is observed seconds ÷ 3,600. It leaves
  out the session features and the latest observation with its age (`trade_age_s`,
  `book_age_s`, `depth_age_s`, `book_spread_bps`, `book_imbalance`): at a minute's end they
  repeat the second row at `60m`.
- **The hourly statistics** (`stats_1h_1m`) describe the same window with values that are not
  window sums: realized volatility from the one-second returns (`ret2_sum` plus the bridges
  between minutes, not the one into the window's first observed minute), statistics of the
  minute returns between consecutive minute closes inside the window (carried through minutes
  without trades; at least 10 needed), drawdown and drawup from the candle's path fields, where
  the high and low fell, and the close against the session VWAP and the previous session's
  levels (calendar intervals; undefined after missing data). Every feature is in hourly ATRs,
  bps, or a ratio, and NULL unless the window is complete.
- **The minute volatility** (`vol_1m`, calculations in `strategy_core/volatility.py`) is per
  phase on same-phase windows, like the ATR: ATR(5) and ATR(50) and their log ratios to ATR(14)
  (`candle_1h_1m.atr_bps`, not stored again); bullish and bearish ATR (Wilder(14) of twice the
  decline and twice the rise from `P0`, the previous same-phase close, with the ATR's inputs,
  seeding, and resets, so their mean is `atr_bps`) and their skew; long and short
  adverse-excursion ATR from the window's exact path fields, and this window's excursions in ATRs;
  the window's high and low as levels (distances in ATRs, ages in rows, which came first); ATR
  against its mean at the same session minute over the previous 20 sessions; the daily ATR (mean
  true range of the previous 14 complete sessions, within the contract), the session's true range
  so far and its high and low against it, and the daily ATR's percentile among its previous 20
  values; and this window's true range, Parkinson and Garman–Klass volatility, and spread against
  ATR. Averages are defined like the ATR (complete windows and empty ones at the carried price),
  values of the window itself and of the session so far for complete windows, the daily ATR and its
  percentile at every row of the session. ATR in price units (`atr_price`) and dollars per contract
  (`atr_usd`) are context columns for stops and sizing, never features.
- **The second volatility** (`vol_1s`, the same `volatility.py`) holds the same columns for the
  rolling `1m@1s` window, per phase `o % 60` on same-phase windows 60 rows apart, plus realized
  volatility from the window's one-second returns (`rv_bps`, `rv_atr` against the `1m@1s` ATR,
  and the count `rv_returns` as context). Its time-of-day samples are the `1m@1s` ATR at each
  minute's last second (ordinal `60m`), keyed by the minute's offset from the session's open; its
  daily scale equals `vol_1m`'s at every minute end. Ages count rows, 0–59.

## Metrics

Definitions, units, and NULL rules are in the code and the column comments:
`strategy_core/metrics.py` (per second), `window_metrics.py` (over the window), and
`indicators.py` and `features.py` (features).

| Handoff entries                                                                               | Stored as                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trade_ohlc`, `trade_volume`, `trade_record_count`, `trade_time_bounds`, `price_quantity_sum` | `bar_1s`: OHLC, high/low times, first/last times, volume, trades, `pv`                                                                                                                                            |
| `aggressor_volume`, `aggressor_record_count`, `volume_delta`, `cvd_bar_path`, `session_cvd`   | buy/sell volume and trades (unknown = rest), `delta_high`/`delta_low`, `session_cvd`                                                                                                                              |
| `trade_size_mean_std`, `trade_size_min_max`, `trade_size_concentration`                       | `size_sq`, `max_size`; features `size_hhi`, `max_size_ratio`, `size_side_ratio`                                                                                                                                   |
| `trade_price_path_variation`, `aggressor_transition_counts`                                   | `path_abs`, `upticks`, `downticks`, `side_pairs`, `side_switches`, `first_side`, `last_side`, `drawdown`, `drawup`, `extreme_order`; features `path_*`, `uptick_ratio`, `side_switch_ratio`                       |
| `beyond_opposite_best_volume_pct`                                                             | `sweep_buy_volume`, `sweep_sell_volume`; `sweep_ratio`, `sweep_delta_ratio`                                                                                                                                       |
| Quote coverage (A27), retained quote state (A28), `last_quote_observation_age_ms`             | `quote_trades`, `depth_trades`, `order_trades` and their volumes, `last_bid`/`last_ask`/sizes, `quote_at_ns`, `depth_at_ns`; `trade_age_s`, `book_age_s`, `depth_age_s`, `book_*`                                 |
| Quoted spread (A29), sampled midpoint (A30)                                                   | `spread_sum`, `spread_max`, `mid2_open`/`high`/`low`; `spread_bps`, `spread_max_bps`, `mid_rsi`, `rel_spread`                                                                                                     |
| Displayed imbalance and depth (A34, A35), weighted midpoint (A36)                             | `imbalance_*`, `bid_depth_sum`, `ask_depth_sum`, `tilt_sum`; `imbalance_mean`, `imbalance_vw`, `depth_imbalance`, `tilt_bps`, `book_imbalance`, `rel_depth`                                                       |
| Order counts (A37)                                                                            | `bid_orders_sum`, `ask_orders_sum`, `order_bid_size_sum`, `order_ask_size_sum`, `order_imbalance_sum`; `order_imbalance`, `order_size_log_ratio`                                                                  |
| Trade–quote interaction (A39)                                                                 | `eff_spread_sum`, `alignment_sum`, `buy_take_sum`, `sell_take_sum`; `eff_spread_bps`, `alignment`, `take_ratio`                                                                                                   |
| `source_quality_diagnostics`                                                                  | `bad_book_trades`, `late_trades`, `status`; `quote_ratio`, `bad_book_ratio`; per-session reports in `ingest_slice`                                                                                                |
| Candle geometry, momentum, VWAP distance (A8, A11)                                            | `range_bps`, `body_bps`, `body_ratio`, wick ratios, `vwap_bps`, `ret_5_atr`, `ret_15_atr`, engine `ret_atr`, `vwap_atr`                                                                                           |
| Trend averages and oscillators (A9, A10, A16, A17)                                            | `rsi`, `ema9_atr`, `ema21_atr`, `ema50_atr`, `macd_atr`, `macd_signal_atr`, `macd_hist_atr`, `ppo_bps`, `adx`, `plus_di`, `minus_di`, `stoch_k`, `stoch_d`, `cci`                                                 |
| Volatility, bands, breakout, recency, statistics (A13–A15, A18–A20)                           | `atr_bps`, `vol_bps`, `bb_z`, `bb_width_bps`, `donchian_*`, `aroon_up`, `aroon_down`, `linreg_slope_atr`, `linreg_r2`, `chop`, `er`                                                                               |
| Price–volume and flow (A3 rolling, A12, A22, A25)                                             | `delta_ratio`, `delta_ratio_5`, `delta_ratio_15`, `count_delta_ratio`, `cvd_high_ratio`, `cvd_low_ratio`, `rel_volume`, `rel_trades`, `cmf`, `mfi`, `flow_price_corr`                                             |
| Realized volatility, return moments, variance ratio, prior-session levels (hourly window)     | `stats_1h_1m`: `rv_bps`, `rv_atr`, `ret_std_bps`, `ret_skew`, `ret_autocorr`, `vr_5`, `up_minute_ratio`, `drawdown_atr`, `drawup_atr`, `high_pos`, `low_pos`, `session_vwap_atr`, `prior_*_atr`, `cvd_close_corr` |
| Volatility family (plan section 7, `1m@1s` window)                                            | `vol_1s`: the `vol_1m` columns below, plus `rv_bps` and `rv_atr` (realized volatility from the window's one-second returns) |
| Volatility family (plan section 7, hourly window)                                             | `vol_1m`: `atr5_bps`, `atr50_bps`, `atr_*_log`, `bull_atr_bps`, `bear_atr_bps`, `bull_bear_skew`, `*_adverse_atr_bps`, `*_excursion_atr`, `*_dist_atr`, `*_age_s`, `extreme_order`, `atr_tod_log`, `day_*`, `tr_atr`, `parkinson_bps`, `gk_bps`, `spread_atr` |
| Session context (A23)                                                                         | `session_elapsed_s`, `session_ret_bps`, `session_high_bps`, `session_low_bps`, `session_delta_ratio`                                                                                                              |

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
  return kurtosis (skewness and autocorrelation are stored for `1h@1m` only), floor-trader
  pivot levels, confirmed pivots and
  candlestick patterns, generic transforms (A26), and past-outcome context (A40). Labels
  (Appendix B) belong with the ML rows.

### Adding a metric or feature

Every stored value is computed from the DBN files, which are kept permanently
([data/README.md](../../data/README.md)), so any statistic can be added later. What a change
rebuilds is listed in the [feature pipeline](feature-pipeline.md#what-a-change-costs).

1. **Per-second statistic:** add a `Field` to `metrics.FIELDS` (how it merges: sum, max,
   min, first, last, or a path rule, and which count makes it valid) and compute it in
   `second_metrics`. Its window value follows from the merge kind.
   **Candle feature:** add it to `indicators.FEATURES` with a normalized unit and compute
   it in `CandleIndicators.update`; a price indicator also joins `PRICE_FEATURES`.
   **New stage:** a `Stage` subclass in its own module (`stage_<name>.py`) with its
   columns, inputs, `MODULES`, settings, and `warmup()`, registered in `pipeline.STAGES`.
2. The stage's column registry picks it up. Add a numbered migration with
   `ALTER TABLE ... ADD COLUMN` (or `CREATE TABLE` for a stage), and recreate the
   `market.continuous_*` views of changed tables in it (they select `table.*`).
3. Existing tests cover the new value automatically: windows against direct aggregation,
   scale invariance, chunking and checkpoints, the declared warm-up, and the registry against
   the migrated tables. Add a hand-checked case for the formula.
4. `uv run research db migrate`, then `uv run research ingest plan GC SI`: the changed stage
   and the stages that read it show `stale` (run with `--rebuild`); a new stage shows `add`.
   If a longer indicator raised the required lead, the plan says so with `needs_rebuild`.

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
9. **Continuous series.** As the handoff requires, rows are computed per contract; the
   product series is a mapping over them (one front contract per session), never an
   aggregation across contracts.

## Tests

`lib/strategy-core/tests/test_metrics.py`, `test_rows.py`, `test_minutes.py`, and `test_stages.py`: the handoff's numeric
reference second, validity subsets, windows equal to direct aggregation of their trades,
identical rows and state for whole-session and second-by-second processing, exact
checkpoint restore, scale invariance of every feature, session CVD resets, and per-phase
parity with plain references (RSI, EMA, stochastic, Bollinger, Donchian, regression,
efficiency ratio, ADX), RSI on empty windows with the carried price, path drawdown and
extreme order (hand-checked and against direct aggregation), the stage graph, derived
warm-ups, and that each declared warm-up settles every candle feature (built from two
starting points). Minutes: a hand-checked minute; every minute field equal to
`MetricWindow(60)` and to the `1m@1s` candle at ordinal `60m` in any chunking; closures,
early closes, empty and missing minutes; checkpoints inside a minute; hourly scale
invariance. `test_hour_stats.py`: every hourly statistic against references computed from
the trades (realized volatility from the one-second closes), identical bits in any chunking and
after checkpoints inside a minute, session levels by hand, scale invariance, the engine's view
(stored NULL is NaN), and the declared warm-up. `test_volatility.py`: every `vol_1m` value against
plain-Python references from the stored candle rows and the trades (per-phase Wilder averages,
the time-of-day normal, the daily scale from each session's trades), the split ATR against
`kernels.wilder_atr`, the daily scale by hand, identical bits in any chunking and after
checkpoints inside a minute, scale invariance, the engine's view, and the declared warm-up (two
starts; the production chains). `test_vol_seconds.py`: every `vol_1s` value against references
from the stored second and candle rows and the trades (realized volatility from the observed
second closes, the time-of-day samples at each minute's last second), the daily scale equal to
`vol_1m`'s at every minute end, realized volatility by hand, identical bits in any chunking and
after checkpoints inside a window, scale invariance and no name collision under `1m@1s.`, the
engine's row-by-row view, and the declared warm-up. `apps/backtest-runner/tests/test_ingest.py`: the schema and
`market.column_registry` equal the registry, binary COPY range checks, stages versioned on
their own (a stale stage is rebuilt alone, including a minute stage at its own resolution, a
missing one is added, as `stats_1h_1m`, `vol_1m`, and `vol_1s` were next to the stored stages), warm flags and the
derived lead, and an end-to-end run with two contracts and a roll:
build, rerun without changes, extend from a checkpoint (stored rows equal an in-memory
build), repair after a file changes, rebuild, and stale detection; the continuous series
has one row per second, each session from its front contract, across the roll. Rolls only
move forward (`test_runner.py`, `test_ingest.py`).

## Next

1. **Swing structure (PR D)**: directional-change pivots sized by the stored volatility tier
   (`vol_1s`, `vol_1m`) ([plan section 3](plan-1h-and-pivots.md#3-pivot-and-structure-design)).
2. Let backtests read stored rows when the builder matches the run.
3. Load Databento `definition` records into `market.contract` (expirations).
