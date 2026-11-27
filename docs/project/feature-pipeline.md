# Feature pipeline: tiers, stages, and database rules

This is the frame every stored value fits into: calculations run in tiers, each tier is
made of stages, and a few database rules keep every stage rebuildable. Swing and structure
semantics are in the [pivot and structure contract](pivot-structure-design.md). The
reasoning behind the volatility family and the hourly statistics is in the
[design notes](plan-1h-and-pivots.md).

## Principle: windows, not candles

A fixed candle is an arbitrary slice of time, and its open, close, and wick shapes are
artifacts of where the slice began and ended. If price fell far and then climbed back to
its open just before the close, that says nothing about whether the low will be visited
again: the low is still a level the market reached. So the system evaluates rolling
windows (`1m@1s`, `10m@10s`, `1h@1m`) instead of fixed candles, and its metrics describe
the **price path** inside a window:

- The window's **high and low are levels**: the current price's distance to them (in ATR),
  how long ago each was set, and which came first.
- **Excursions along the path**: the largest drop from any price to a later, lower one
  (drawdown) and the largest rise (drawup), measured exactly from the trades.
- A window's "close" is the **current price**, and its "open" is where the path started 60
  rows ago. Changes over the window are returns, not candle bodies.

The wick features `upper_wick_ratio` and `lower_wick_ratio` still exist in the candle
stages (family `shape`, `indicators.py`); no new body or wick features are added.
`close_loc` (the current price between the window's low and high) is a level feature, and
`body_bps` and `body_ratio` are the window's return in bps and as a share of its range.

## Tiers: calculations in dependency order

Market structure needs ATR to size its swings, so the pipeline computes in **tiers**, like
floors of a building: each floor rests only on the ones below it, and every floor is
finished before anything reads from it.

| Tier | Contents                                                                    | Stages (per timeframe)                                         |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0    | Exact base rows from trades: OHLCV, aggressor flow, book at trades, path    | `bar_1s`, `bar_10s`, `bar_1m`                                  |
| 1    | Rolling candles, indicators (RSI, EMA, MACD, ATR, …), window statistics     | `candle_1m_1s`, `candle_10m_10s`, `candle_1h_1m`               |
| 1    | Statistics and the volatility family                                        | `stats_1m_1s`, `stats_10m_10s`, `stats_1h_1m`, `vol_1s`, `vol_10s`, `vol_1m` |
| 2    | Swings and structure of price: confirmed pivots, HH/HL/LH/LL, trend, breaks | `pivot_1s`, `pivot_10s`, `pivot_1m` (+ `pivot_event`)          |
| 2    | The same for RSI and for CVD, each in its own ATR                           | `pivot_rsi_1s`, `_10s`, `_1m`; `pivot_cvd_1s`, `_10s`, `_1m`   |

Labels (future outcomes) are never inputs and none are stored today. A tier is a
dependency level; a stage is the unit of code, versioning, and storage. A tier can hold
several stages, and new tiers can be added on top without touching the ones below.

**Planned, not built:**

- `book_1s` (tier 0): rows from the book between trades (queue and order-flow imbalance,
  spread over time, depletion, refill).
- Comparison codes (tier 3): a stage that compares the structure of price, RSI, and CVD.
  They replace the earlier idea of `signal_*` stages (roadmap decision 41).
- Pair stages (two products read at the same `slot_ordinal`; [pair-design.md](pair-design.md)).

**Read rules** (they keep every stored value causal):

1. A stage reads only lower tiers, plus its own earlier state. It never reads another stage
   of its own tier unless the graph declares the edge, and it never reads labels.
2. **Same timeframe:** a stage at row `o` may read lower-tier values of row `o`, since both
   are published at the same row close. A value fixed at a moment _inside_ a row, such as a
   swing threshold frozen when an extreme trades, reads row `o − 1`: row `o` would include
   trades after the extreme.
3. **Across timeframes:** only through an as-of join on availability
   (`available_at <= decision_at`): a second row sees the latest _completed_ minute, with
   its age. A minute row may read the second row at its own end (ordinal `60m`).
4. **Across contracts:** never. Each stage is computed within one contract; products read
   as one series only through the continuous views.
5. **Across products:** only in pair stages (not built).

## Stages

A stage declares its name, tier, inputs, columns (with units), checkpoint state, version,
module files, and variants, and implements `process(inputs) -> tables`. The backtest and
live engine run the same graph in tier order, one chunk at a time; ingest runs it from the
DBN files and writes the stale stages.

| Stage                  | Tier | Inputs                                                          |
| ---------------------- | ---- | --------------------------------------------------------------- |
| `bar_1s`               | 0    | `market` (trades, coverage), calendar                           |
| `bar_10s`, `bar_1m`    | 0    | `bar_1s`, merged exactly                                        |
| `candle_<W>_<S>`       | 1    | `bar_<S>`: the rolling window of that timeframe                 |
| `stats_<W>_<S>`        | 1    | `bar_<S>`, `candle_<W>_<S>` (status, ATR, path fields)          |
| `vol_<S>`              | 1    | `bar_<S>`, `candle_<W>_<S>` (windows, path fields, ATR, spread) |
| `pivot_<S>`            | 2    | `market` (trade path), `bar_1s` (coverage), the candle and `vol_<S>` of its timeframe |
| `pivot_rsi_<S>`        | 2    | `candle_<W>_<S>` (its RSI at each row's close), `bar_<S>` (status) |
| `pivot_cvd_<S>`        | 2    | `bar_<S>` (its `cvd` and status), `candle_<W>_<S>` (volume and trade count) |

`<W>_<S>` is `1m_1s`, `10m_10s`, or `1h_1m`; `<S>` is `1s`, `10s`, or `1m`. The swings of
RSI and CVD are described in the [contract](pivot-structure-design.md#swing-sources-price-rsi-and-cvd).
In `pivot_<S>`, the slow scales read the minute rows (`bar_1m`, `candle_1h_1m`) and replay
the trades second by second.

The three timeframes are independent branches: nothing at second resolution feeds a minute
stage except `bar_1s` (through `bar_1m`, and for the swing scales, the trades), so changing
a second-resolution indicator never rebuilds the minute branch.

**Timeframes are a parameter** (`strategy_core/timeframes.py`). A timeframe `W@S` is a
`Timeframe` value (its name, its step in seconds, and the labels of its tables), and every
timeframe is built by the same classes, one per kind of stage: `stage_step_candle.py`,
`stage_step_stats.py`, `stage_step_vol.py`, `stage_step_pivot.py` (price swings), and
`stage_step_series.py` (RSI and CVD swings). `pipeline.TIMEFRAMES` lists the timeframes
that are registered and stored; adding one adds stages and changes no other stage's
identity.

Only the step rows differ by nature. Those of one second are made from the trades
(`stage_bar_1s.py`); every longer step's are merged exactly from them (`stage_step_bar.py`).
A step divides a minute, so step rows nest in minutes and never straddle a session
boundary. What else differs is declared, not copied: the session features and the latest
observation are stored on `1m@1s` only; the fast swing rows are stored sparsely; and each
timeframe has its own reclaim window.

A stage passes in-memory values to later stages of its timeframe through
`Timeframe.frame(products)`: `bars`, `metrics`, `ordinal`, `observed_seconds`, `candles`,
and `window`. A new stage is written once against that frame, for all timeframes.

**Variants are stages.** Each swing scale is a stage class of its own (`pivot_1s:fast_atr_1`,
`pivot_10s:mid_atr_1`, `pivot_1m:slow_atr_1`, …) that writes to its timeframe's shared
table under its `variant_id` (`market.variant`). It has its own builder identity,
checkpoint, and session records, with no special case in the planner: a new scale is a new
stage, and a changed one is rebuilt alone. A stage may also emit events next to its rows
(`products["events"]`), which ingestion replaces together with them.

## Model stages

No trained model sits in the middle of the stage graph ([decision 29](roadmap.md#decisions)).
The decision model is the only trained model and reads the stages; nothing reads it. If a
model's output ever becomes a stage, it must be scored walk-forward (fitted only on
sessions that ended before the block it scores, less a purge as long as its label's
horizon), stored with the model's identity, and never rewritten in place.

## Database properties

These choices are fixed, because changing them would mean rewriting every table.

- **Row grid.** One row per scheduled-open slot and contract, keyed
  `(contract_id, slot_ordinal, end_ns)`, with monthly partitions on `end_ns`. Sparse layers
  are computed on the same grid but may store only the rows that are read: the fast swing
  scales do ([rule](ingestion.md#fast-swing-rows-are-stored-sparsely)).
- **One table per stage.** Each stage owns its tables and replaces a session's rows (and
  events) in one transaction. For a stage with variants the replacement covers only the
  variant being built, `(stage, variant, session)`.
- **Variants are rows.** A family computed over a parameter grid whose members are never
  combined inside the stage (swing scales, with their threshold normalizers) adds
  `variant_id` to the key, with parameters in a registry table. A new variant adds rows,
  not columns: no migration, and existing variants stay current. Values combined with each
  other, such as ATR(5), ATR(14), ATR(50) and their ratios, are columns of one stage; a new
  one is a column (a migration).
- **Column registry.** `market.column_registry` lists every stored column with its stage,
  SQL type, description, status (active, deprecated), and when it was first registered. Its
  **role** is `feature` (a normalized `Unit`; a model input), `context` (raw prices,
  volumes, and other data in source units; never a model input), or `key` (ordinals, times,
  IDs). Units are required only for features. It is generated from the code registry, a
  test keeps it equal to the schema, and ML extraction selects only `feature` columns.
- **Names never change meaning.** A different definition gets a new name (or a new
  variant); the old one is deprecated, then dropped by a migration once nothing reads it.
  Models record the names and stage identities they were trained on.
- **NULL means undefined.** Never zero for "unknown"; validity flags and ages say why.
- **Times.** Rows carry `end_ns`; events carry the extreme time, the confirmation time, and
  `available_at`; ages count scheduled-open rows (wall time only in separately named
  columns).
- **Deterministic event IDs.** Derived from the producing variant's builder identity,
  contract, kind, observation ordinal, and the sequence within that row. The observation is
  the row of the trade that produced the event (the confirming trade for a pivot, the
  breaching or reclaiming trade for a breach or reclaim). The sequence counts the scale's
  events in that row in trade release order. A rebuild by the same code reproduces the same
  IDs; changed code produces new IDs, never an old ID for a different pivot.
- **Warm-up** is derived from indicator parameters, never typed by hand
  ([below](#warm-up-is-derived-never-typed)).
- **Identity per variant.** A variant's identity is its stage's identity (code, settings
  other than the variant grid, columns, packages, inputs) plus its own parameters. Adding a
  variant creates a new identity and leaves the others current; changing stage code changes
  every variant; removing a variant deletes its rows, events, and descendants.
- **Provenance.** `market.stage_slice`, keyed by stage, variant, contract, and session,
  holds the builder identity, its inputs' identities, the checkpoint, the report, and the
  source files. A training dataset records the stage identities and feature list it used,
  so it can be rebuilt exactly.
- **Labels apart.** Future-looking labels live in their own stages and tables, are never
  joined into feature tables, and carry their full definition.

## Warm-up is derived, never typed

Every contract is computed from a number of lead sessions before it becomes the front
contract, so its values are settled when the continuous series switches to it. Indicators
change often (EMA(50) to EMA(200), a new ATR horizon), so the lead must follow them
automatically. A forgotten update would silently leave unsettled values at the start of
every new contract.

**How long is "settled".** A fixed-window value (a 20-period mean, a percentile of the last
20 values) is exact once its window is full. A recursive average (an EMA, or a Wilder
average as in RSI and ATR) never fully forgets where it started; it is settled once the
starting value's weight falls below a tolerance, `0.1%` by default:
`updates = seed + ln(0.001) / ln(1 − α)`. An EMA(n) seeds with its first value
(`seed = 1`, `α = 2 / (n + 1)`); a Wilder(n) average first spends `n` values building its
starting mean (`seed = n`, one more for RSI, whose changes need a previous close;
`α = 1 / n`). Same-phase hourly indicators update once per open hour, about 23 per session:

| Indicator on `1h@1m` | Updates | Sessions |
| -------------------- | ------- | -------- |
| RSI(14), ATR(14)     | 108     | 4.7      |
| EMA(50)              | 174     | 7.6      |
| ATR(50)              | 392     | 17.0     |
| EMA(200)             | 692     | 30.1     |

The same math at daily scale (one update per session) would need about 107 sessions for a
Wilder ATR(14), so daily-scale averages use fixed windows.

**Mechanism:**

1. Every indicator reports its warm-up from its own parameters, in its own updates
   (`warmup.py`): the window length, or the tolerance formula above. Composites add along
   their chain: MACD's signal line waits for EMA(26), then EMA(9) of MACD; ADX smooths
   smoothed movements; a percentile of daily ATR waits for the daily ATR, then its window.
2. Every stage reports its warm-up in scheduled-open seconds (`Stage.warmup()`), and the
   planner converts it to sessions with a typical session's length.
3. The required lead is the largest stage warm-up, and at least `LEAD_FLOOR` (40
   sessions). `plan` reports both and the stage that needs most; a `--lead-sessions` below
   the requirement is refused. Neither is a number typed for an indicator.
4. When a change raises the lead, spans start earlier, so the planner reports
   `needs_rebuild` with the lead and the stage that requires it, and a rebuild prepends the
   sessions.
5. Each stage's session record (`market.stage_slice.warm`) says whether the contract had run
   at least that stage's warm-up. With the required lead, every front session is warm,
   except for contracts whose downloads start too late (the data starts November 2025):
   their sessions report `history_limited`, and ML extraction and backtests exclude
   sessions that are not warm unless asked otherwise. Swing stages are different: their
   state can depend on arbitrarily old swings, so no finite lead makes it history-complete.
   Their structure starts a fresh epoch at the start of the contract's span, exactly as
   after missing data, and the stage reports `warm` itself: every row of the session had a
   confirmed high and low of its segment, so a session with missing data is not warm. A
   swing `warm = false` at a front session is a reported state, never a build failure. Its
   `warmup()` covers only the threshold's ATR(14).
6. A test builds the stage from two session-aligned starting points and requires every
   feature to agree within the tolerance once the later start has run the declared warm-up,
   and to still differ at half of it, so a missing or inflated warm-up fails. Swing stages
   are excluded, since their dependence on the span start is declared above.

## What a change costs

| Change                                   | What happens                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| New variant of a family (a swing scale)  | Insert its registry row; build only that variant                            |
| New metric in an existing stage          | Migration adds the column; that stage and its descendants rebuild           |
| New stage or tier                        | Migration adds its table; build it; nothing else changes                    |
| Changed formula                          | The stage identity changes; the stage and its descendants rebuild           |
| A longer indicator (EMA(50) → EMA(200))  | The derived lead may rise; if so, the planner asks for a rebuild            |
| New tier-0 field (needs the trades)      | Every stage rebuilds                                                        |
| Retired metric                           | Mark deprecated; drop the column in a later migration                       |

Summaries across variants keep their declared variant set until a new version includes
it, which rebuilds the summary. Rebuilds are cheap because stored values are always
recomputed from the DBN files by the same code, so being able to rebuild is the safety net,
not a failure. The design aims to make each change rebuild only what depends on it.

## Remaining risks to measure

- **Live latency.** Every tier must finish within the 100 ms close delay each second.
  Measure the full graph per second after each new tier.
- **Storage growth.** The database is about 375 GB for one year of GC and SI. Sparse layers
  store only the rows that are read. Measure query and ML-extraction speed as tables grow.
- **Tier-0 additions** rebuild everything, so add the per-second fields a later stage will
  need at once.
