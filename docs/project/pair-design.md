# Paired products: reading two markets at once

Status: design, not implemented. On November 6, 2026, Paul decided that stages may read two
products at once, starting with the pairs GC + SI and ES + NQ
([research, section 8](../research/pivots/2026-11-05-order-flow-predictors.md#8-decisions)).
The technical details below are derived from that decision and from the existing pipeline
rules ([feature pipeline](feature-pipeline.md)).

## Why

Every stage today reads one contract. Gold's own prices cannot tell whether silver confirms
a new low, whether gold is moving ahead of or behind silver, or whether silver's sellers
are still active. Those are separate information, not reworkings of gold's prices
([inventory F1–F3](../research/pivots/2026-11-05-order-flow-predictors.md#f-other-markets)).
A **pair stage** computes such features from both products' stored rows, for the same
scheduled second or minute, without changing any single-product stage.

## Rows line up exactly

A pair is allowed only when both products' exchange calendars give identical scheduled-open
slots, so that `slot_ordinal` `o` is the same second (or minute) in both:

- GC (`CMEGlobex_GC`) and SI (`CMEGlobex_SI`): identical opens and closes on all 4,364
  sessions from 2010 through November 2026 (checked November 6, 2026).
- ES and NQ share one equity-index calendar.

The builder checks this for every session it builds and refuses a pair whose slots differ.
No row is ever matched by clock time.

## Directed pairs

Pair rows describe the **partner** relative to the **target**, the product being traded:
`GC|SI`, `SI|GC`, `ES|NQ`, and `NQ|ES`. A model that trades GC reads GC's own stages plus
the `GC|SI` rows. Storing both directions doubles the rows. That is small next to the second
tables, and disk is not a constraint ([decision 5](plan-1h-and-pivots.md#6-decisions)). In
exchange, every feature has a single meaning from the trader's side.

## Rolls and warm-up

GC and SI roll on different months, so the pair's contracts change whenever either product
rolls. Each combination of contracts is built and stored separately, keyed
`(target_contract_id, partner_contract_id, slot_ordinal, end_ns)`, just as single-product
rows are keyed by contract:

- A combination is built for every session where it is the front pair, and for its lead
  sessions before that. It starts at the later of the two contracts' first lead session.
- Within a combination, each leg's values come from one delivery month. A roll of either
  leg starts a new combination, which was already warmed by its lead sessions. Delivery
  months are never mixed.
- The pair stage's own warm-up is derived from its parameters, like every stage's. A test
  checks that the longest leg input's warm-up plus the pair warm-up fits within the
  40-session lead.
- `market.continuous_pair_1m` (and later `_1s`) takes every session's rows from the
  combination (front target, front partner), mirroring the single-product continuous views.

## Read rules for pair stages

These extend the [read rules](feature-pipeline.md#tiers-calculations-in-dependency-order):

1. A pair stage reads only single-product stages of the same resolution, at the same
   `slot_ordinal`, of the two contracts of its combination. Rule 2 still holds: a value
   fixed inside a row (such as a frozen pivot threshold) is read from row `o − 1`.
2. Both legs publish row `o` at its close, under the same trade-assignment timing, so pair
   row `o` is published when both legs' row `o` has closed. Live, both products arrive on
   one Databento subscription, and the pair row waits for the slower leg.
3. A missing or quiet partner row gives NULL partner features, with the partner's status
   and age. A missing partner is never filled in or inferred.
4. Single-product stages never read pair stages, so a single-product rebuild never depends
   on another product. A pair stage becomes stale when either leg's input stage changes.
5. Across delivery months of one product: still never.

## Code shape

- `PairChunk(target, partner)`: two `MarketChunk`s covering the same `(start, end]`.
- `PairStage`: like `Stage`, but with inputs named by leg (`target:candle_1h_1m`,
  `partner:vol_1m`). `process(pair_chunk, target_products, partner_products)` returns the
  pair rows.
- `PairPipeline`: runs each leg's existing `Pipeline`, then the pair stages in order. The
  `Engine` takes an optional partner. Strategy features are the target's features plus the
  pair stage's features. Execution and fills still concern the target only.
- Run specs gain `partner: SI`. `uv run research verify SPEC` checks that per-second and
  whole-session chunking give identical pair rows, as for single products.
- Ingest: `uv run research ingest pairs GC:SI ES:NQ` builds pair rows from stored leg rows.
  The plan refuses if a leg's input stages are not current for the sessions it needs.
- Scale invariance: a new test multiplies each leg's prices by different factors (and each
  leg's sizes separately). Every pair feature must stay unchanged.

## First stage: `pair_1m`

Minute rows from both legs' `candle_1h_1m`, `stats_1h_1m`, and `vol_1m`. Every value is
normalized by each leg's own ATR or is a ratio:

| Column                            | Definition                                                                                                                       | Unit  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `partner_ret_atr`                 | Partner's `1h@1m` window return ÷ partner's ATR                                                                                  | ATR   |
| `rel_ret_atr`                     | Target's window return in target ATR − partner's in partner ATR                                                                  | ATR   |
| `ret_corr_1h`                     | Correlation of the two legs' 60 minute returns in the window                                                                     | ratio |
| `beta_resid_atr`                  | Target's window return minus β × partner's (β from the window's minute returns), ÷ target ATR                                    | ATR   |
| `nonconf_low_atr`                 | When the target is within 0.1 ATR of its window low: partner's distance above its own window low, in partner ATR; NULL otherwise | ATR   |
| `nonconf_high_atr`                | Mirror for highs                                                                                                                 | ATR   |
| `partner_delta_ratio`             | Partner's window (buy − sell) ÷ volume                                                                                           | ratio |
| `partner_status`, `partner_age_s` | Partner row status and the age of its latest trade                                                                               | key   |

The 0.1-ATR band and the use of window extremes (rather than confirmed pivots) are a first
version. After PR D, P3 replaces them with the partner's pivot state.

## Pull requests

- **P1:** the framework (pair registry and calendar check, `PairChunk`, `PairStage`,
  `PairPipeline`, engine and spec support, verify, ingest, the combination builder), stage
  `pair_1m`, its migration and continuous view, and the scale-invariance test for pairs.
- **P2:** `pair_1s`, the same features on `1m@1s` rows.
- **P3, after PRs D and E:** partner pivot state and events: confirmations, higher lows and
  lower highs, breaches and reclaims, and true non-confirmation at confirmed pivots.

P1 touches the pipeline and the engine but no single-product stage, so it can be built
alongside PR D. Whichever merges second renumbers its migration before applying it to
`trading`.
