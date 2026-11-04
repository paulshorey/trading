# Feature pipeline: tiers, stages, and database rules

Proposed November 3, 2026, for PR A onward. This is the frame every stored value fits
into, chosen so that adding, changing, or retiring metrics later never needs another
rewrite of the codebase or database. The [plan](plan-1h-and-pivots.md) gives the order of
work, and the [pivot/structure contract](pivot-structure-design.md) gives the
swing-structure semantics.

## Tiers: calculations in dependency order

Many training inputs need other inputs first. Market structure needs ATR to size its
swings, and trend signals need both indicators and structure. The pipeline therefore
computes in **tiers**, like floors of a building: each floor rests only on the ones
below it, and every floor is finished before anything reads from it.

| Tier | Contents                                                                                                          | Stages (per resolution)                            |
| ---- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0    | Exact base rows from trades: OHLCV, aggressor flow, book at trades, price-path extremes                           | `bar_1s`, `bar_1m`                                 |
| 1    | Rolling candles and standard indicators (RSI, EMA, MACD, ATR, …), and the volatility family (ATR variants)        | `candle_1m_1s`, `candle_1h_1m`, `vol_1s`, `vol_1m` |
| 2    | Market structure: swing detection sized by tier-1 volatility, confirmed pivots, HH/HL/LH/LL, trend, breaches      | `pivot_1s`, `pivot_1m` (+ `pivot_event`)           |
| 3    | Signals combining tiers 1 and 2: higher-low sequences, pullback quality, divergences, sweeps, cross-scale context | `signal_1s`, `signal_1m`                           |
| —    | Labels: future outcomes for training and evaluation, never inputs                                                 | `pivot_label` (later: trade outcomes)              |

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

## Stages

A stage declares its name, tier, inputs, columns (with units), checkpoint state, version,
module files, and variants, and implements `process(inputs) -> tables`. The backtest and
live engine run the same graph in tier order, one chunk at a time; ingest runs it from
the DBN files and writes the stale stages. Details are in [plan section 4](plan-1h-and-pivots.md#4-extensibility-stages).

```text
market ─► bar_1s ─► candle_1m_1s ─► vol_1s ─► pivot_1s ─► signal_1s
            │                          │          ▲            ▲
            ▼                          ▼          │            │
          bar_1m ─► candle_1h_1m ─► vol_1m ─► pivot_1m ─► signal_1m
                                                  │
                                                  ▼
                                             pivot_label
```

The pivot stages also read `market` (the trade path), and `signal_1s` reads minute-tier
values as of their availability.

## Database properties

These choices are fixed now, because changing them later would mean rewriting every
table. Everything else is designed to change.

| Property                   | Rule                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row grid                   | One row per scheduled-open slot and contract, keyed `(contract_id, slot_ordinal, end_ns)`; monthly partitions on `end_ns`                                                                                                                                                                                              |
| One table per stage        | Each stage owns its tables and replaces a session's rows (and events) in one transaction                                                                                                                                                                                                                               |
| Variants are rows          | A family computed over a parameter grid (pivot scales; later ATR periods or threshold normalizers) adds `variant_id` to the key, with parameters in a registry table. A new variant adds rows, not columns: no migration, and existing variants stay current                                                           |
| Feature registry           | `market.feature` lists every column: stage, tier, resolution, unit, description, parameters, the builder that introduced it, and status (active, deprecated). It is generated from the code registry, and a test keeps it equal to the schema                                                                          |
| Names never change meaning | A different definition gets a new name (or a new variant); the old one is deprecated, then dropped by a migration once nothing reads it. Models record the names and stage identities they were trained on                                                                                                             |
| NULL means undefined       | Never zero for "unknown"; validity flags and ages say why                                                                                                                                                                                                                                                              |
| Times                      | Rows carry `end_ns`; events carry the extreme time, the confirmation time, and `available_at`; ages count scheduled-open rows (wall time only in separately named columns)                                                                                                                                             |
| Deterministic event IDs    | Derived from (contract, stage, variant, kind, confirmation ordinal, sequence within that row), where the sequence counts the scale's events in the row in trade release order (one second can confirm a high, a low, and another high). A rebuild reproduces the same IDs, so labels keep pointing at the right events |
| Warm-up                    | Each stage declares how many sessions its values need before they are fully defined (`warmup_sessions`, including the warm-up of every input it summarizes); the contract lead is the largest, and a test fails if a stage needs more than the lead                                                                    |
| Provenance                 | `market.stage_slice`, keyed by stage, variant, contract, and session, holds the builder identity, its inputs' identities, the checkpoint, the report, and the source files. A training dataset records the stage identities and feature list it used, so it can be rebuilt exactly                                     |
| Labels apart               | Future-looking labels live in their own stages and tables, are never joined into feature tables, and carry their full definition (a label ID)                                                                                                                                                                          |

## What a change costs

| Change                                                | What happens                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New variant of an existing family (a new pivot scale) | Insert its registry row; build only that variant. Summaries across variants keep their declared variant set until a new version includes it, which rebuilds the summary |
| New metric in an existing stage                       | Migration adds the column; that stage and its descendants rebuild                                                                                                       |
| New stage or tier                                     | Migration adds its table; build it; nothing else changes                                                                                                                |
| Changed formula                                       | The stage identity changes; the stage and its descendants rebuild (renamed if the meaning changed)                                                                      |
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
  already known to be needed (price-path drawdown and drawup; [plan section 7](plan-1h-and-pivots.md#7-volatility-tier-atr-family)).
