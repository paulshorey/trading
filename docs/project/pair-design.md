# Paired products: reading two markets at once

Not built. This is a design: no pair stage, pair table, or partner setting exists in the code.
On November 6, 2026, Paul decided that stages may read two products at once, starting with
the pairs GC + SI and ES + NQ
([research, section 8](../research/pivots/2026-11-05-order-flow-predictors.md#8-decisions)).
The details below follow from that decision and from the pipeline rules
([feature pipeline](feature-pipeline.md)). Only GC and SI data are on this machine.

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

The builder checks that the two calendars are equal from the phase origin (January 1, 2010,
where `slot_ordinal` counting starts) through the last session it builds, and that every
joined row has the same `end_ns` in both legs. It refuses a pair otherwise.
No row is ever matched by clock time.

## Directed pairs

Pair rows describe the **partner** relative to the **target**, the product being traded:
`GC|SI`, `SI|GC`, `ES|NQ`, and `NQ|ES`. A model that trades GC reads GC's own stages plus
the `GC|SI` rows. Storing both directions doubles the rows, which is small next to the second
tables ([decision 5](../archive/plan-1h-and-pivots-original.md#6-decisions)), and gives every feature one meaning
from the trader's side.

## Rolls and warm-up

GC and SI roll on different months, so each combination of contracts is built and stored
separately, keyed `(target_contract_id, partner_contract_id, slot_ordinal, end_ns)`:

- A combination is built for every session where it is the front pair, and for its lead
  sessions before that, starting at the later of the two contracts' first lead session. A
  roll of either leg starts a new combination, already warmed by its lead sessions.
  Delivery months are never mixed.
- The pair stage's warm-up is derived from its parameters, like every stage's: the longest leg
  input's warm-up plus the pair warm-up. Forty sessions is the floor, not a cap.
- `market.continuous_pair_1m` (and later `_1s`) takes every session's rows from the
  combination (front target, front partner).

## Read rules for pair stages

These extend the [read rules](feature-pipeline.md#tiers-calculations-in-dependency-order):

1. A pair stage reads only single-product stages of the same resolution, at the same
   `slot_ordinal`, of the two contracts of its combination. A value fixed inside a row (such
   as a frozen swing threshold) is read from row `o − 1`.
2. Pair row `o` is published when both legs' row `o` has closed, under the same
   trade-assignment timing. Live, both products arrive on one Databento subscription.
3. Missing partner data makes every partner feature NULL. A quiet (covered, no-trade)
   partner row is not missing: it keeps every value its own stages define, plus the partner's
   status and age. Missing data is never filled in or inferred.
4. Single-product stages never read pair stages. A pair stage becomes stale when either
   leg's input stage changes.

## Code shape

- `PairChunk(target, partner)`: two `MarketChunk`s covering the same `(start, end]`.
- `PairStage`: like `Stage`, with inputs named by leg (`target:candle_1h_1m`,
  `partner:vol_1m`).
- `PairPipeline`: runs each leg's existing `Pipeline`, then the pair stages. The `Engine`
  takes an optional partner; a second-resolution decision reads `pair_1m` as the latest
  completed pair minute, with its age. Execution and fills still concern the target only.
- Run specs gain `partner: SI`. `uv run research verify SPEC` checks that per-second and
  whole-session chunking give identical pair rows. `uv run research ingest pairs GC:SI ES:NQ`
  builds pair rows from stored leg rows and refuses if a leg's input stages are not current.
- Scale invariance: a test multiplies each leg's prices by different factors (and each leg's
  sizes separately); every pair feature must stay unchanged.

## First stage: `pair_1m`

Minute rows from both legs' `bar_1m` (for trade counts and the partner's last row with
trades), `candle_1h_1m`, `stats_1h_1m`, and `vol_1m`. Every value is
normalized by each leg's own ATR or is a ratio. Every ATR-normalized column is NULL, with
a "flat volatility" state, whenever the target's or the partner's ATR is zero (stored as 0,
not NULL, for a fully flat lookback):

| Column                | Definition (details below the table)                                         | Unit    |
| --------------------- | ---------------------------------------------------------------------------- | ------- |
| `partner_ret_atr`     | Partner's `1h@1m` window return over the partner's ATR                       | ATR     |
| `rel_ret_atr`         | Target's common-sample return in target ATR minus the partner's in its ATR   | ATR     |
| `ret_corr_1h`         | Correlation of the two legs' minute returns over their common sample         | ratio   |
| `beta_resid_atr`      | Target's return not explained by the partner, on the common sample           | ATR     |
| `nonconf_low_atr`     | Target near its window low: the partner's distance above its own low         | ATR     |
| `nonconf_high_atr`    | Mirror for highs                                                             | ATR     |
| `partner_delta_ratio` | Partner's window (buy − sell) ÷ (buy + sell)                                 | ratio   |
| `partner_status`      | Partner row status (complete, quiet, missing)                                | context |
| `partner_age_s`       | Scheduled-open seconds since the partner's latest trade (`bar_1m.last_at_ns`) | seconds |

- **Common sample.** The minute returns ending at the same `slot_ordinal` that both legs define
  inside the window (at most 59; each leg's returns start at its first observed close, as in
  `stats_1h_1m`). `rel_ret_atr`, `ret_corr_1h`, and `beta_resid_atr` are NULL below 30 common
  returns; `ret_corr_1h` has an "insufficient overlap" state then and a "flat" state when
  either leg's common returns have zero variance.
- **`rel_ret_atr`** is the sum of the target's common-sample minute returns in target ATR minus
  the same for the partner in partner ATR, so both legs cover the same minutes.
- **`beta_resid_atr`**: each leg's minute returns are divided by its own ATR (both in bps) on the
  common sample. β = cov(target, partner) ÷ var(partner) (least squares with an intercept).
  The residual is the sum of the target's common normalized returns − β × the sum of the
  partner's (the intercept is not subtracted). NULL, with a "flat" state, when the partner's
  normalized returns have zero variance.
- **`nonconf_*_atr`:** set when the target is within 0.1 ATR of its window low (high), in
  partner ATR; NULL otherwise.
- **`partner_delta_ratio`** is NULL when the window has no sided volume. `partner_age_s` resets
  at gaps and session opens.

The 0.1-ATR band and the use of window extremes (rather than confirmed swings) are a first
version; the partner's swing state replaces them (step 3 below).

## Order of work

1. The framework (pair registry and calendar check, `PairChunk`, `PairStage`, `PairPipeline`,
   engine and spec support, verify, ingest, the combination builder), stage `pair_1m`, its
   migration and continuous view, and the scale-invariance test for pairs. It touches the
   pipeline and the engine but no single-product stage.
2. `pair_1s`: the same features on `1m@1s` rows.
3. Partner swing state and events, from the rule-based swings of the partner: confirmations,
   higher lows and lower highs, breaches and reclaims, and true non-confirmation at
   confirmed swings. This replaces the first version's 0.1-ATR band and window extremes.
