# Platform roadmap

Goal: reproducible short-horizon futures strategies, from historical research through
live trading, on one engine. The research question is whether a model can use the price path
at multiple resolutions to select short-horizon trades with positive expectancy after costs.

This page is the map: what is computed, in what order, and how far it has come. Details
are in the [feature pipeline](feature-pipeline.md) (rules every stored value follows), the
[plan for stages and swing structure](plan-1h-and-pivots.md), the
[pivot/structure contract](pivot-structure-design.md), the [pair design](pair-design.md),
and the [handoff](handoff.md) (current state and how to continue).

## Two ideas everything rests on

1. **Sliding windows.** A candle covers a higher timeframe but is recomputed at every step
   of a lower one: `1m@1s` is the last 60 one-second rows, every second; `1h@1m` is the last
   60 one-minute rows, every minute. Windows count rows of scheduled trading time, never
   clock time ([sliding windows](../sliding-windows/README.md)).
2. **Layers.** History is processed in passes, like floors of a building: each layer reads
   only the layers below it, and a layer is finished for a moment in time before anything
   above reads it. A value never uses information from after its own row.

Indicators that advance by one candle period read the previous window of the same phase.
The swing detector uses the sequence of released trades so it can tell which barrier was
hit first inside a candle. Fast and slow swing scales use their respective completed
ATR and publish state at second and minute closes. A second-level decision can read the
latest completed minute, including its age.

## The layers

Base rows and indicator stages use a scheduled grid per contract. Swing events and labels
are sparse. Prediction stages are proposed and will need a versioned model per forecast.

| Layer             | What it holds                                                                                                              | Examples                                                                                         | Stages                                                            | State                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------- |
| 0. Trades         | Exact per-second and per-minute statistics, updated with each trade                                                        | OHLCV by aggressor side, CVD and its extremes, sweeps, the price path, the book as trades saw it | `bar_1s`, `bar_1m`                                                | Done                                                |
| 0b. Book          | The same grid from every change to the best bid and ask                                                                    | Queue imbalance, order-flow imbalance, spread over time, depletion and refill                    | `book_1s`                                                         | Planned; the data is on disk and reaches the engine |
| 1. Indicators     | Rolling candles and what is computed from price and volume                                                                 | ATR family, RSI, EMA, MACD, ADX, realized volatility, session levels                             | `candle_1m_1s`, `candle_1h_1m`, `stats_1h_1m`, `vol_1s`, `vol_1m` | Done                                                |
| 2. Swings         | Turning points of the price path, sized by layer-1 volatility                                                              | Confirmed highs and lows at 0.5, 1, and 2 ATR; the open leg and its progress; breaches           | `pivot_1s`, `pivot_1m` (+ `pivot_event`); `pivot_rsi_*` planned   | Price implemented; RSI awaits disk and a research case              |
| 3. Reversal model | Probability of reaching the frozen reversal barrier within the candidate horizon | P(reversal) at the candidate decision row            | `pivot_label` (outcomes), then `model_reversal_*`                 | Labels and benchmark implemented; model deferred                         |
| 4. Structure      | Patterns across the latest reversals and the current one                                                                   | Higher lows, lower highs, breaks of structure, pullback quality, divergences                     | `signal_1s`, `signal_1m`                                          | Designed ([contract](pivot-structure-design.md))    |
| 5. Final model    | One model on every stored feature of layers 0–4, for one product and its partner                                           | Trade or no trade, direction, expected outcome after costs                                       | training pipeline, `ml.*` tables                                  | After layers 2–4                                    |

**Pairs.** Layers 0–4 are computed for each product alone. Pair stages then read two
products that move together at the same row (`GC` with `SI`, `ES` with `NQ`): relative
strength, spread and ratio moves, lead and lag, and each partner's layer-2 to layer-4
state ([pair design](pair-design.md)). The final model reads both.

### Layers 3 and 4: predictions that later layers read

Layer 2 confirms a swing only after price has reversed by the full threshold, which is
late. Layer 3 would estimate the chance of reaching the reversal barrier from the
current candidate before invalidation or timeout. The remaining probability covers both
outcomes. The confirmed swing retains its actual confirmation time. A later structure
model could use this forecast alongside the previous confirmed highs and lows.

A model's output is only a valid input for a later layer if the model could not have seen
the future of the row it scores. The rule (proposed November 15, 2026; details in the
[feature pipeline](feature-pipeline.md#model-stages)):

- A model stage is trained **walk-forward**. Its stored prediction for a session comes
  from a model fitted only on sessions that ended earlier, with a gap at least as long as
  the label horizon. The first sessions of the history have no prediction (NULL).
- Each stored prediction records the model that produced it. A retrained model adds a new
  version; nothing is overwritten in place.
- Layer 4 and the final model train only on rows that have these out-of-sample
  predictions, so they learn from predictions of the quality they will get live.

The proposed layer 4 can build on the deterministic layer-2 swings and
their provisional (not yet confirmed) relations, as the
[contract](pivot-structure-design.md#provisional-higher-lows-and-lower-highs-are-causal-candidate-features)
specifies. The model's probability then joins as one more input, and the benchmark decides
whether it improves on the rule.

## Next research decision

**Decision, November 18, 2026.** The first model will take or skip a provisional higher-low
long or lower-high short based on expected net trade value. A reversal probability can be
tested later as an input. The model and its candidate inspector are planned.

A provisional higher low is observable when the current low sits above the previous
confirmed low and price has begun to recover. Three different questions can follow.

| Decision | What would count as success |
| --- | --- |
| Will the candidate reach the reversal barrier in time? | A calibrated probability improves on a model fitted to decision-time displacement alone on the same candidates. This is what the current benchmark can test. |
| Will this low become the next confirmed higher low? | Match the next confirmed low to the candidate and its frozen comparator on the same contract and scale. Count a replaced extreme separately. Mirror for lower highs. This needs a distinct target. |
| Should the system enter here? | A policy that takes or skips the candidate improves after-cost results in one portfolio. The existing simulator supports the bracket replay. Wiring pivot candidates into this comparison is proposed. |

Start with one fast swing scale on GC and SI. Freeze the candidate at its first eligible
decision close, including its extreme identity, side and latest completed hourly row.
Freeze the bracket, costs, sizing and eligibility rule before reading outcomes.

1. Replay a would-be entry for every candidate, including ones a policy skips. Use the
   engine's arrival-time book, bracket exits and commission. For a filled trade with an
   observed exit, the training outcome is net P&L divided by the decision-time initial risk
   per contract (R); an unfilled entry has zero outcome. Exclude and count incomplete
   follow-up, and count fallback-priced exits separately. Keep hypothetical trades out of
   the portfolio ledger.
2. Fit expected net R on earlier folds, purging training outcomes whose decision-to-resolution
   interval overlaps the scoring block. Apply the same purge to threshold selection, using
   training history only. Convert expected R to dollars with the candidate's initial risk
   for display and the take decision. Compare staying flat, taking every eligible candidate,
   a displacement-only rule, and the learned policy on the same candidate stream. Test the hourly filter on
   and off and add an out-of-fold reversal probability only as a separate comparison.
3. Replay each policy with the same capital, position limits and cooldown. Report net
   portfolio dollars, drawdown, fills and opportunities skipped while occupied, by month
   and product. Stress order latency and one tick of additional adverse execution.

Log every variant, including unsuccessful ones, before examining the
reserved period. Repeated selection on the same history can make an ordinary strategy
appear profitable. [Bailey et al., *The Probability of Backtest Overfitting*](https://escholarship.org/uc/item/4w1110bb)

One control tests the value of the sliding clock itself. Run the same policy on completed
minute boundaries and again on every eligible second, with one portfolio and the same
risk limits. Report how many extra entries the faster clock enabled and what they earned
after costs. Adjacent one-minute windows share 59 seconds. Counting the extra rows alone
cannot establish that earlier action helped.

For the barrier forecast, the next proposed input is the book at each candidate. Freeze
a short list of normalized inputs and their lookbacks before extracting them. Gould and
Bonart found queue imbalance predicted the next mid-price move for ten Nasdaq stocks.
Whether that information lasts through retail order arrival and a minutes-long futures
trade is an empirical question. [Gould and Bonart](https://arxiv.org/abs/1512.03492)

## Done

- uv-managed Python workspace with numpy, numba, Databento, and exchange calendars.
- One year of Databento MBP-1 for GC, SI, PL, ES, YM, and RTY, verified ([data](data.md)).
- DBN catalog with checksums, per-date contract resolution, volume-based front-month
  rolls, and per-session data-quality reports.
- Layers 0 and 1 as stages with their own versions, checkpoints, and derived warm-ups.
- Layer 2 for price: six swing scales, each a stage of its own, with their events.
- One engine for whole-session backtests and second-by-second rehearsals, verified
  identical; fills at the MBP-1 book the order meets, ATR brackets, one portfolio.
- Per-signal would-be-trade outcomes (ML rows) and a UI to inspect runs and trades.
- Local PostgreSQL 18 database `trading` with numbered migrations and a file registry.

## Next

1. Rebuild the stored rows from MBP-1 for GC and SI: done November 16
   ([results](handoff.md#rebuilt-from-mbp-1-november-16-2026)).
2. Swings of the price path (PR D): done November 16
   ([results](handoff.md#pr-d-results-swings)). Swings of RSI (`pivot_rsi_*`) reuse the same
   detector and wait for disk space ([handoff](handoff.md#open-questions)).
3. Outcome labels and the benchmark (PR F): done November 17
   ([results](handoff.md#pr-f-results-labels-and-benchmark)). The stored swings find turning
   points sooner than fixed extrema, slope sign, or CUSUM at a like false-alarm rate. Logistic
   regression and a boosted model on the stored features rank early candidates no better than
   the position of price alone (AUC about 0.60 for both), so no model is stored yet.
4. **Context inputs for the reversal model: tested November 17, no gain**
   ([results](handoff.md#context-input-results-november-17-2026)). Other swing scales, the
   hourly window, and the partner product do not help either model, so no signal stage and
   no model stage is stored. Next is the [after-cost portfolio experiment](#next-research-decision).
   The candidate-only book test remains a secondary reversal-forecast experiment.
5. **Book and pair stages.** Budget permanent storage after a candidate-level experiment
   demonstrates incremental value for the selected target.
6. **Final model**: purged walk-forward training on pooled examples from front-contract
   sessions ([rules](handoff.md#training-across-contracts-decided-november-2-2026)); a
   final holdout of the newest data, evaluated once.
7. **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the
   same engine; record each day and replay it as a backtest to confirm identical decisions.
8. **Live trading**: a broker execution adapter with order reconciliation, risk limits,
   pause and resume, manual overrides, and a log of automated and human decisions.
