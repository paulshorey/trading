# Feature pipeline: tiers, stages, and database rules

Proposed November 3, 2026, for PR A onward. This is the frame every stored value fits
into, chosen so that adding, changing, or retiring metrics later never needs another
rewrite of the codebase or database. The [plan](plan-1h-and-pivots.md) gives the order of
work, and the [pivot/structure contract](pivot-structure-design.md) gives the
swing-structure semantics.

## Principle: windows, not candles

A fixed candle is an arbitrary slice of time, and its open, close, and wick shapes are
artifacts of where the slice began and ended. If price fell far and then climbed back to
its open just before the close, that says nothing about whether the low will be visited
again: the low is still a level the market reached. This is why the system evaluates
rolling windows at high resolution (`1h@1m`, `1m@1s`) instead of fixed candles.

Metrics therefore describe the **price path** inside a window, not a candle shape:

- The window's **high and low are levels**: the current price's distance to them (in
  ATR), how long ago each was set, and which came first.
- **Excursions along the path**: the largest drop from any price to a later, lower one
  (drawdown) and the largest rise (drawup), measured exactly from the trades.
- A window's "close" is simply the **current price**, and its "open" is only where the
  path started 60 rows ago. Changes over the window are returns, not candle bodies.

No new body or wick features are added. The existing wick features (`upper_wick_ratio`,
`lower_wick_ratio`) stay in the registry as the `shape` family, marked for removal unless
ablation shows they add information. `close_loc` (the current price between the window's
low and high) is a level feature, and `body_bps` and `body_ratio` are the window's return
in bps and as a share of its range, so they stay.

## Tiers: calculations in dependency order

Many training inputs need other inputs first. Market structure needs ATR to size its
swings, and trend signals need both indicators and structure. The pipeline therefore
computes in **tiers**, like floors of a building: each floor rests only on the ones
below it, and every floor is finished before anything reads from it.

| Tier | Contents                                                                                                          | Stages (per resolution)                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0    | Exact base rows from trades: OHLCV, aggressor flow, book at trades, price-path extremes                           | `bar_1s`, `bar_1m`                                                       |
| 1    | Rolling candles and standard indicators (RSI, EMA, MACD, ATR, …), window statistics, and the volatility family    | `candle_1m_1s`, `candle_1h_1m`, `stats_1h_1m`, `vol_1s`, `vol_1m`        |
| 2    | Market structure of price (sized by tier-1 volatility) and of RSI: confirmed pivots, HH/HL/LH/LL, trend, breaches | `pivot_1s`, `pivot_1m`, `pivot_rsi_1s`, `pivot_rsi_1m` (+ `pivot_event`) |
| 3    | Signals combining tiers 1 and 2: higher-low sequences, pullback quality, divergences, sweeps, cross-scale context | `signal_1s`, `signal_1m`                                                 |
| —    | Labels: future outcomes for training and evaluation, never inputs                                                 | `pivot_label` (later: trade outcomes)                                    |

Tiers are dependency levels; stages are the unit of code, versioning, and storage. A
tier can hold several stages, and new tiers can be added on top without touching the
ones below.

**Read rules** (they are what keeps every stored value causal):

1. A stage reads only lower tiers, plus its own earlier state. It never reads its own
   tier's other stages unless the graph declares the edge, and it never reads labels.
2. **Same resolution:** a stage at row `o` may read lower-tier values of row `o`, since
   both are published at the same row close. A value fixed at a moment _inside_ a row,
   such as a swing threshold frozen when an extreme trades, reads row `o − 1`: row `o`
   would include trades after the extreme.
3. **Across resolutions:** only through an as-of join on availability
   (`available_at <= decision_at`): a second row sees the latest _completed_ minute,
   with its age. A minute row may read the second row at its own end (ordinal `60m`).
4. **Across contracts:** never. Every stage is computed within one contract; products
   read as one series only through the continuous views.
5. **Across products:** only in pair stages (decided November 6, 2026; not implemented),
   which read two products' stages at the same `slot_ordinal` under the rules in
   [pair-design.md](pair-design.md). Single-product stages never read them.

## Stages

A stage declares its name, tier, inputs, columns (with units), checkpoint state, version,
module files, and variants, and implements `process(inputs) -> tables`. The backtest and
live engine run the same graph in tier order, one chunk at a time; ingest runs it from
the DBN files and writes the stale stages. Details are in [plan section 4](plan-1h-and-pivots.md#4-extensibility-stages).

| Stage          | Tier | Inputs                                                                                                               |
| -------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `bar_1s`       | 0    | `market` (trades, coverage), calendar                                                                                |
| `bar_1m`       | 0    | `bar_1s`                                                                                                             |
| `candle_1m_1s` | 1    | `bar_1s`                                                                                                             |
| `candle_1h_1m` | 1    | `bar_1m`                                                                                                             |
| `stats_1h_1m`  | 1    | `bar_1m`, `candle_1h_1m` (its status, ATR, and path fields: a declared edge within tier 1)                           |
| `vol_1s`       | 1    | `bar_1s`, `candle_1m_1s` (its windows, path fields, ATR, and spread: a declared edge within tier 1)                  |
| `vol_1m`       | 1    | `bar_1m`, `candle_1h_1m` (its windows, path fields, ATR, and spread: a declared edge within tier 1)                  |
| `pivot_1s`     | 2    | `market` (trade path), `candle_1m_1s`, `vol_1s`                                                                      |
| `pivot_1m`     | 2    | `market` (trade path), `candle_1h_1m`, `vol_1m`                                                                      |
| `pivot_rsi_1s` | 2    | `candle_1m_1s` (its RSI series)                                                                                      |
| `pivot_rsi_1m` | 2    | `candle_1h_1m` (its RSI series)                                                                                      |
| `signal_1m`    | 3    | `candle_1h_1m`, `vol_1m`, `pivot_1m`, `pivot_rsi_1m`                                                                 |
| `signal_1s`    | 3    | `candle_1m_1s`, `vol_1s`, `pivot_1s`, `pivot_rsi_1s`; `pivot_1m`, `pivot_rsi_1m`, and `signal_1m` as of availability |
| `pivot_label`  | —    | `market`, `pivot_1s`, `pivot_1m`                                                                                     |

The two resolutions are independent branches below tier 3: nothing at second resolution
feeds a minute stage except through `bar_1m`, so changing a second-resolution
indicator never rebuilds the minute branch.

## Database properties

These choices are fixed now, because changing them later would mean rewriting every
table. Everything else is designed to change.

| Property                   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Row grid                   | One row per scheduled-open slot and contract, keyed `(contract_id, slot_ordinal, end_ns)`; monthly partitions on `end_ns`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| One table per stage        | Each stage owns its tables and replaces a session's rows (and events) in one transaction; for a stage with variants, the replacement covers only the variant being built, `(stage, variant, session)`, so other variants' rows and events are untouched                                                                                                                                                                                                                                                                                                                                                                        |
| Variants are rows          | A family computed over a parameter grid whose members are never combined inside the stage (pivot scales, including their threshold normalizers) adds `variant_id` to the key, with parameters in a registry table. A new variant adds rows, not columns: no migration, and existing variants stay current. Values that are combined with each other, such as ATR(5), ATR(14), ATR(50) and their ratios, are columns of one stage; a new one is a column (a migration). Combinations across variants live in a summary with a declared variant set                                                                              |
| Column registry            | `market.column_registry` lists every stored column with its **role**: `feature` (a normalized `Unit`; a model input), `context` (raw prices, volumes, and other data in source units; never a model input), or `key` (ordinals, times, IDs). Each also has its stage, SQL type, description, status (active, deprecated), and when it was first registered; the stage registry gives its tier and resolution. Units are required only for features; `key` is the index counter and row end time. It is generated from the code registry, a test keeps it equal to the schema, and ML extraction selects only `feature` columns |
| Names never change meaning | A different definition gets a new name (or a new variant); the old one is deprecated, then dropped by a migration once nothing reads it. Models record the names and stage identities they were trained on                                                                                                                                                                                                                                                                                                                                                                                                                     |
| NULL means undefined       | Never zero for "unknown"; validity flags and ages say why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Times                      | Rows carry `end_ns`; events carry the extreme time, the confirmation time, and `available_at`; ages count scheduled-open rows (wall time only in separately named columns)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Deterministic event IDs    | Derived from (the producing variant's builder identity, contract, kind, observation ordinal, sequence within that row). The observation is the row of the trade that produced the event: the confirming trade for a pivot, the breaching or reclaiming trade for a breach or reclaim. The sequence counts the scale's events in that row in trade release order (one second can confirm a high, a low, and another high). A rebuild by the same code reproduces the same IDs; changed code produces new IDs, never an old ID for a different pivot. Labels reference event IDs and are rebuilt with them                       |
| Warm-up                    | Derived from indicator parameters, never typed by hand ([warm-up](#warm-up-is-derived-never-typed))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Identity per variant       | A variant's identity is its stage's identity (code, settings other than the variant grid, columns, packages, inputs) plus the variant's own parameters. Adding a variant creates a new identity and leaves the others current; changing stage code changes every variant; removing a variant deletes its rows, events, and descendants                                                                                                                                                                                                                                                                                         |
| Provenance                 | `market.stage_slice`, keyed by stage, variant, contract, and session, holds the builder identity, its inputs' identities, the checkpoint, the report, and the source files. A training dataset records the stage identities and feature list it used, so it can be rebuilt exactly                                                                                                                                                                                                                                                                                                                                             |
| Labels apart               | Future-looking labels live in their own stages and tables, are never joined into feature tables, and carry their full definition (a label ID)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Warm-up is derived, never typed

Every contract is computed from a number of lead sessions before it becomes the front
contract, so its values are settled when the continuous series switches to it. Indicators
will change often (EMA(50) to EMA(200), a new ATR horizon, a new structure signal), so the
lead must follow them automatically. A forgotten update would silently leave unsettled
values at the start of every new contract.

**How long is "settled".** A fixed-window value (a 20-period mean, a percentile of the last
20 values) is exact once its window is full. A recursive average (an EMA, or a Wilder
average as in RSI and ATR) never fully forgets where it started; it is settled once the
starting value's weight falls below a tolerance, `0.1%` by default:
`updates = seed + ln(0.001) / ln(1 − α)`. An EMA(n) seeds with its first value
(`seed = 1`, `α = 2 / (n + 1)`); a Wilder(n) average, as in RSI and ATR, first spends `n`
values building its starting mean (`seed = n`, one more for RSI, whose changes need a
previous close; `α = 1 / n`). Same-phase hourly indicators update once per open hour, about 23 per session:

| Indicator on `1h@1m` | Updates | Sessions |
| -------------------- | ------- | -------- |
| RSI(14), ATR(14)     | 108     | 4.7      |
| EMA(50)              | 174     | 7.6      |
| ATR(50)              | 392     | 17.0     |
| EMA(200)             | 692     | 30.1     |

The same math at daily scale (one update per session) would need about 107 sessions for a
Wilder ATR(14), so daily-scale averages use fixed windows.

**Mechanism** (implemented in PR A for the current stages; pivot rules apply from PR D):

1. Every indicator reports its warm-up from its own parameters, in its own updates
   (`warmup.py`): the window length, or the tolerance formula above. Composites add along
   their chain: MACD's signal line waits for EMA(26), then EMA(9) of MACD; ADX smooths
   smoothed movements; a percentile of daily ATR will wait for the daily ATR, then its window.
2. Every stage reports its warm-up in scheduled-open seconds (`Stage.warmup()`), and the
   planner converts it to sessions with a typical session's length.
3. The required lead is the largest stage warm-up, and the lead is at least `LEAD_FLOOR`
   (40 sessions, reserved for the planned stages). `plan` reports both and the stage that
   needs most; a `--lead-sessions` below the requirement is refused. Neither is a number
   typed for an indicator.
4. When a change raises the lead (EMA(200) needs about 30 sessions), spans start earlier,
   so the planner reports `needs_rebuild` with the lead and the stage that requires it, and
   a rebuild prepends the sessions.
5. Each stage's session record (`market.stage_slice.warm`) says whether the contract had run
   at least that stage's warm-up. With the required lead, every front session is warm,
   except for contracts whose downloads start too late (the data starts November 2025):
   their sessions report `history_limited`, and ML extraction and backtests will exclude
   sessions that are not warm unless asked otherwise. Pivot stages are different: their state
   can depend on arbitrarily old swings, so no finite lead makes it history-complete. Their
   structure starts a fresh epoch at the start of the contract's span, exactly as after
   missing data, and `warm` means that epoch has confirmed at least one high and one low at
   that scale. A pivot `warm = false` at a front session is a reported state
   (`pivot_not_warm` in the session report), never a build failure.
6. A test builds the stage from two session-aligned starting points and requires every
   feature to agree within the tolerance once the later start has run the declared warm-up,
   and to still differ at half of it, so a missing or inflated warm-up fails. Pivot stages
   are excluded, since their dependence on the span start is declared above.

## What a change costs

| Change                                                | What happens                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New variant of an existing family (a new pivot scale) | Insert its registry row; build only that variant. Summaries across variants keep their declared variant set until a new version includes it, which rebuilds the summary |
| New metric in an existing stage                       | Migration adds the column; that stage and its descendants rebuild                                                                                                       |
| New stage or tier                                     | Migration adds its table; build it; nothing else changes                                                                                                                |
| Changed formula                                       | The stage identity changes; the stage and its descendants rebuild (renamed if the meaning changed)                                                                      |
| A longer indicator (EMA(50) → EMA(200))               | The derived lead may rise; if so, the planner asks for a rebuild with the reason                                                                                        |
| New tier-0 field (needs the trades)                   | Every stage rebuilds; measure it in PR A with 40 lead sessions (about 20 minutes expected for GC+SI), longer per product                                                |
| Retired metric                                        | Mark deprecated; drop the column in a later migration                                                                                                                   |

Rebuilds are cheap because stored values are always recomputed from the DBN files by the
same code, so being able to rebuild is the safety net, not a failure. The design aims to
make each change rebuild only what depends on it.

## Remaining risks to measure

- **Live latency.** Every tier must finish within the 100 ms close delay each second.
  Measure the full graph per second in PR A and again after each new tier.
- **Storage growth.** GC+SI second rows are 57.65 GB today. Pivots and the volatility and
  signal tiers may roughly double that. Disk is not a constraint (decision 5), but measure
  query and ML-extraction speed as tables grow.
- **Tier-0 additions.** These rebuild everything. PR A therefore adds the per-second fields
  already known to be needed (price-path drawdown and drawup, and the order of each second's high and low; [plan section 7](plan-1h-and-pivots.md#7-volatility-tier-atr-family)).
