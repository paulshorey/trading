# The first decision model: spec

**Proposed November 23, 2026 and revised the same day for Paul's decisions 35 to 37.
Nothing is built and nothing has been run.** Paul has confirmed the closing rules and the
build order; the label waits for his confirmation. Whatever he changes is changed here
before any outcome is read. It is build-order item 8 of the [roadmap](roadmap.md#build-order) and
step 6 of the process; Part B needs the engine of item 7.

## In plain words

The first version of the one trained model. At every `10m@10s` row it forecasts one number:
how far price will go from here over the next hours, counted in the trade's own risk, up
(positive) or down (negative). A rule turns the forecast into buy, sell, or nothing by
comparing it with what a trade costs. By default a position is held to its stop, target,
or time limit; two rules that close it earlier, when the forecast turns, are run beside that. It will probably do nothing almost always and earn nothing, because its inputs are the
ones that have shown nothing so far. Its job is to be the measuring stick: every later input
is judged by whether this model forecasts better with it, on the same rows.

## Part A: the forecast

| Setting | Value |
| --- | --- |
| Decision rows | Every `10m@10s` row of a warm front session, January 2 to August 31, 2026 (171 trade dates a product). Training reads one row a minute (the row that ends the minute): neighbours share 59 of 60 window rows and almost all of their label |
| Eligibility | Decided at the row, counted by reason: the latest completed `1h@1m` row has an ATR; the row's end plus 3 hours plus 60 s is not after the forced exit; no file of the session is flagged; the engine holds a usable book whose spread is at most a quarter of the stop distance ([decisions 21, 23, 27](roadmap.md#decisions)) |
| Label `y` | The move ahead, in R. Reference price: the mid-price of the book the engine holds at the decision. One R is one `1h@1m` ATR, fixed at the row: the distance to the protective stop. Trades are read in order from the decision on, for at most 3 hours: `+1` if price reaches one R above the reference first, `-1` if it reaches one R below first, else the move of the mid-price at the 3 hours in R, which lies between them. A row whose follow-up loses data coverage is unknown: left out and counted. Costs are not in the label, so it is symmetric: what a short would see is `-y` |
| Why this label | It is in the unit every result is read in. It is bounded, so a plain squared error needs no outlier rule. One model serves both sides, so a year that trended cannot as easily teach it one side only. It is also exactly what a trade held to its stop, target, or time limit earns, which gives the policy a control |
| Features | Every feature the engine holds at the row (637 today), read as the engine reads them. No price level, contract, or product identity |
| Models | `flat`: the forecast is 0. `ridge`: linear, on features ranked and scaled on the training rows. `trees`: scikit-learn's histogram gradient boosting with fixed settings (300 trees, learning rate 0.05, 15 leaves, at least 500 rows a leaf, seed 0). Nothing is tuned |
| Splits | Test months May to August 2026 (`periods.TEST_MONTHS`). The model that scores a month is fitted on all earlier sessions of both products except the last one before the month. On six years: by quarter, as [frozen](roadmap.md#how-results-are-judged-on-six-years) |
| Skill | For each test trade date and product, the rank correlation between forecast and label over that date's rows; then the mean over dates with a 95% interval from resampled dates. Also the squared error against `flat`'s. Reported pooled, by product, and by month |

**The horizon map** (a diagnostic, no policy). The same `trees` model is fitted to the move of
the mid-price over the next 1, 5, 15, and 60 minutes, in ATRs, once on all features and
once on each group alone (price path, volume and flow, the book at trades, volatility,
swings and structure, session and time). It answers what has never been asked here: is
anything predictable from these inputs, at which horizon, and from which kind of input.
That is 28 fits, reported as a table of the skill above. None is a candidate policy.

## Part B: the policy, after costs

It runs in the engine of [build-order item 7](roadmap.md#build-order).

| Setting | Value |
| --- | --- |
| Position and decisions | The position is long, flat, or short. At every eligible decision row the policy decides buy, sell, or nothing, and the position moves one step ([decision 35](roadmap.md#decisions)). A sell while long closes the long with a market order and cancels its orders; a sell at a later row, while flat, opens a short. Buys mirror this |
| Cost `c` | The round trip's cost in R at the row: the spread plus both commissions, over the stop distance |
| Opening | While flat: buy if the forecast is above `c`, sell if it is below `-c`. A position is opened only when the move forecast is larger than what the trade costs |
| Closing, rule `hold` | No closing decision. The default and the headline result ([decision 37](roadmap.md#decisions)): the simple, traditional trade, and exactly the one the label describes |
| Closing, rule `turn` | While long: sell when the forecast is at or below 0 (mirror for a short). The cost of closing is paid sooner or later by every position, so it is no reason to stay in one that the forecast no longer favours. Reopening needs the forecast beyond `c` again, so a forecast hovering near zero cannot trade in and out |
| Closing, rule `opposite` | While long: sell only when the forecast is below `-c`, the level that would open a short. The position rides through weak forecasts and leaves on a clear turn |
| Protection, under every rule | A stop one R against the entry, a target one R in favour, a 3-hour limit, and the session's forced exit. They never block a decision: a closing decision acts whatever they say |
| Entry `cross` | A market order |
| Entry `passive` | A limit order at the best bid for a buy (best ask for a sell) of the book it meets, cancelled after 5 seconds ([decision 28](roadmap.md#decisions)). Unfilled, the next decision row decides again. The threshold stays `c` for both entries, so they are compared on the same decisions |
| Passive fills | Base: the order joins the back of the displayed size and fills when that much has traded at its price since it arrived, or a trade prints through it. Stressed: only a trade through it. MBP-1 cannot say which is nearer the truth; paper trading will |
| Executions and costs | `base` and `stressed` (250 ms, one extra tick on marketable orders, the strict fill rule); full-size and micro costs |
| Risk | Variables of the run ([decision 36](roadmap.md#decisions)): 0.5% of the account risked between entry and stop, and no new position on a trade date once 2% is lost (four losing trades). Results are in R, as if a position could be sized exactly. Beside them, for an account of $100,000 in whole micro contracts: the result in percent, and the trades skipped because one contract risks more than the allowance |
| Portfolio | One position at a time across the products. Results for buys and sells apart, by product, by month |
| Sensitivity | The opening threshold at 0.5, 2, and 4 times `c`, reported beside the result. The threshold `c` is the result; the others only show how it depends on that choice |

That is three closing rules and two entries: six policy cells, each under two executions.

## What counts

- **Skill:** the mean daily rank correlation of `trees` is above zero with its interval,
  pooled, and its mean is above zero for each product.
- **A policy** (the `hold` rule is the headline): net R per trade date above zero with its interval on the test months, under
  both executions, with a mean at or above zero for each product, for buys, for sells, and
  at micro costs.
- **`turn` or `opposite`** is better than `hold` when the difference in net R per trade date,
  paired by date on the same openings, has its interval above zero.
- **An input added later** earns its place when the skill with it is above the skill without
  it, the difference paired by trade date with its interval above zero. The policy result
  confirms it; with 87 test dates it is too coarse to decide alone.

This is the exposed year: a pass here is a hypothesis for the untouched years. Every later
variant is counted with these six cells.

## Expected before the run

No skill at the 3-hour horizon. If the horizon map shows anything, it is at 1 minute, from
flow and the book at trades, and too small against the spread for a market order. The
policy opens few positions or none, so the closing rules can hardly be told apart yet.

## Named now, run later

Each is a variant of its own, written into this page before it is run.

- **Labels from the best path in hindsight.** For each session, the sequence of long, flat,
  and short that would have earned the most after a stated cost for each step, found by
  dynamic programming ([Boyarshinov and Magdon-Ismail](https://arxiv.org/abs/1009.4683);
  [Plessen and Bemporad](https://arxiv.org/abs/1709.07527)). It is the position rule of
  decision 35 with perfect foresight, so a model trained on it learns when to step, not only
  where price goes. The stated cost sets how large a move must be to count. This is the
  first variant after the yardstick: under `turn` and `opposite` a position follows decisions
  and is no longer the trade the label above describes.
- **Moving the stop to the entry price** once price has moved 0.5 or 1 R in favour (Paul's
  question of November 23). It gives up no money on paper, but for a price with no drift it
  changes which trades lose, not what they earn on average, and it is often hit by ordinary
  noise before the move resumes. It is compared with the same trades without it.
- **Mirrored training rows.** Each row is also given to the model with every directional
  feature and the label negated, which forces the model to treat rises and falls alike. It
  needs each feature declared as directional or not.
- **Other stop distances and time limits**, and the stop sized by the middle timeframe.

## What has to be built

1. The label (`strategy-core`, beside `labels.py`), with tests.
2. The decision dataset: rows, features as the engine computes them, labels, eligibility.
3. The walk-forward trainer and its report: `research yardstick GC SI`.
4. Runs and their variants stored in `research.*`, so every variant is counted.
5. For Part B, the engine of item 7 and a strategy that reads the stored forecast. The same
   forecast computed live must equal the stored one (`research verify`).
