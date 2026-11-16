# Platform roadmap

Goal: reproducible short-horizon futures strategies, from historical research through
live trading, on one engine. The end product of the research side is **one machine-learning
model trained on many precomputed metrics**, for products that move together.

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

## The layers

Every layer is stored per contract, one row per scheduled second or minute, in PostgreSQL,
computed by the same code that live sessions run.

| Layer             | What it holds                                                                                                              | Examples                                                                                         | Stages                                                            | State                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------- |
| 0. Trades         | Exact per-second and per-minute statistics, updated with each trade                                                        | OHLCV by aggressor side, CVD and its extremes, sweeps, the price path, the book as trades saw it | `bar_1s`, `bar_1m`                                                | Done                                                |
| 0b. Book          | The same grid from every change to the best bid and ask                                                                    | Queue imbalance, order-flow imbalance, spread over time, depletion and refill                    | `book_1s`                                                         | Planned; the data is on disk and reaches the engine |
| 1. Indicators     | Rolling candles and what is computed from price and volume                                                                 | ATR family, RSI, EMA, MACD, ADX, realized volatility, session levels                             | `candle_1m_1s`, `candle_1h_1m`, `stats_1h_1m`, `vol_1s`, `vol_1m` | Done                                                |
| 2. Swings         | Turning points of the price path, sized by layer-1 volatility                                                              | Confirmed highs and lows at 0.5, 1, and 2 ATR; the open leg and its progress                     | `pivot_1s`, `pivot_1m`, `pivot_rsi_*`                             | Next (PR D)                                         |
| 3. Reversal model | A model's probability that the current move has reversed rather than paused, and the moment a reversal counts as confirmed | P(reversal) for each candidate extreme; early confirmation when it passes a threshold            | `pivot_label` (outcomes), then `model_reversal_*`                 | Designed in part; see below                         |
| 4. Structure      | Patterns across the latest reversals and the current one                                                                   | Higher lows, lower highs, breaks of structure, pullback quality, divergences                     | `signal_1s`, `signal_1m`                                          | Designed ([contract](pivot-structure-design.md))    |
| 5. Final model    | One model on every stored feature of layers 0–4, for one product and its partner                                           | Trade or no trade, direction, expected outcome after costs                                       | training pipeline, `ml.*` tables                                  | After layers 2–4                                    |

**Pairs.** Layers 0–4 are computed for each product alone. Pair stages then read two
products that move together at the same row (`GC` with `SI`, `ES` with `NQ`): relative
strength, spread and ratio moves, lead and lag, and each partner's layer-2 to layer-4
state ([pair design](pair-design.md)). The final model reads both.

### Layers 3 and 4: predictions that later layers read

Layer 2 confirms a swing only after price has reversed by the full threshold, which is
late. Layer 3 exists to say earlier, with a probability, whether the move from the latest
extreme is a reversal or a pause before continuation. Layer 4 then reads the latest
confirmed reversals together with that probability to name the pattern: higher lows,
lower highs, or neither.

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

Until the reversal model exists, layer 4 is built on the deterministic layer-2 swings and
their provisional (not yet confirmed) relations, as the
[contract](pivot-structure-design.md#provisional-higher-lows-and-lower-highs-are-causal-candidate-features)
specifies. The model's probability then joins as one more input, and the benchmark decides
whether it improves on the rule.

## Done

- uv-managed Python workspace with numpy, numba, Databento, and exchange calendars.
- One year of Databento MBP-1 for GC, SI, PL, ES, YM, and RTY, verified ([data](data.md)).
- DBN catalog with checksums, per-date contract resolution, volume-based front-month
  rolls, and per-session data-quality reports.
- Layers 0 and 1 as stages with their own versions, checkpoints, and derived warm-ups.
- One engine for whole-session backtests and second-by-second rehearsals, verified
  identical; fills at the MBP-1 book the order meets, ATR brackets, one portfolio.
- Per-signal would-be-trade outcomes (ML rows) and a UI to inspect runs and trades.
- Local PostgreSQL 18 database `trading` with numbered migrations and a file registry.

## Next

1. **Rebuild the stored rows from MBP-1** for GC and SI (the existing rows were built from
   the deleted TBBO files; MBP-1 trades reproduce them exactly).
2. **Swings (PR D)**, then structure signals (PR E) and outcome labels with the benchmark
   (PR F), in the order Paul decided on November 3. Recommended change, for Paul to
   confirm: build the labels (F) before the signals (E), because the reversal model
   needs labels and layer 4 should be able to read its output.
3. **Reversal model**: logistic regression and one gradient-boosted model on the stored
   candidates, walk-forward, stored as a model stage.
4. **Book stage `book_1s`** and **pair stage `pair_1m`**, alongside the above.
5. **Final model**: purged walk-forward training on pooled examples from front-contract
   sessions ([rules](handoff.md#training-across-contracts-decided-november-2-2026)); a
   final holdout of the newest data, evaluated once.
6. **Paper trading**: a Databento live MBP-1 source feeding one-second chunks into the
   same engine; record each day and replay it as a backtest to confirm identical decisions.
7. **Live trading**: a broker execution adapter with order reconciliation, risk limits,
   pause and resume, manual overrides, and a log of automated and human decisions.
