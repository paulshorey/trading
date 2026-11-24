# The yardstick decision model: spec

**Proposed November 23, 2026. Not approved, nothing built, nothing run.** Paul reviews it
first; whatever he changes is changed here before any outcome is read. It is build-order
items 7 and 8 of the [roadmap](roadmap.md#build-order) and step 6 of the process.

## In plain words

The first version of the one trained model. At a `10m@10s` row it forecasts one number: what
a long trade with a symmetric bracket would earn from here, in units of its risk, before
costs. A short earns the opposite. A rule turns the forecast into long, short, or flat by
comparing it with what a trade costs. It will probably stay flat almost always and earn
nothing: the inputs are the ones that have shown nothing so far. Its job is to be the
measuring stick: every later input is judged by whether this model forecasts better with it,
on the same rows.

## Part A: the forecast

| Setting | Value |
| --- | --- |
| Decision rows | Every `10m@10s` row of a warm front session, January 2 to August 31, 2026 (171 trade dates a product). Training reads one row a minute (the row that ends the minute): neighbours share 59 of 60 window rows and almost all of their label |
| Eligibility | Decided at the row, counted by reason: the latest completed `1h@1m` row has an ATR; the row's end plus 3 hours plus 60 s is not after the forced exit; no file of the session is flagged; the engine holds a usable book whose spread is at most a quarter of the barrier distance (decisions [21 and 23](roadmap.md#decisions-of-november-20-2026) and [27](roadmap.md#decisions-of-november-23-2026)) |
| Label `y` | The result of a long, in R, before costs. Reference price: the mid-price of the book the engine holds at the decision. Barriers: one `1h@1m` ATR above and below it, fixed at the row. Trades are read in order from the decision on, for at most 3 hours: `+1` if the upper barrier is reached first, `-1` if the lower one is, else the move of the mid-price at the 3 hours over the barrier distance, which lies between them. A row whose follow-up loses data coverage is unknown: left out and counted. Costs are not in the label, so it is symmetric: a short's result is `-y` |
| Why this label | It is the trade the policy places, so the forecast and the result are in the replay's unit. It is bounded, so a plain squared error needs no outlier rule. One model serves both sides, so a year that trended cannot teach it one side only as easily |
| Features | Every feature the engine holds at the row (637 today), read as the engine reads them. No price level, contract, or product identity |
| Models | `flat`: the forecast is 0. `ridge`: linear, on features ranked and scaled on the training rows. `trees`: scikit-learn's histogram gradient boosting with fixed settings (300 trees, learning rate 0.05, 15 leaves, at least 500 rows a leaf, seed 0). Nothing is tuned |
| Splits | Test months May to August 2026, as in every earlier result. The model that scores a month is fitted on all earlier sessions of both products except the last one before the month. On six years: by quarter, as [frozen](roadmap.md#how-results-are-judged-on-six-years) |
| Skill | For each test trade date and product, the rank correlation between forecast and label over that date's rows; then the mean over dates with a 95% interval from resampled dates. Also the squared error against `flat`'s. Reported pooled, by product, and by month |

**The horizon map** (a diagnostic, no policy). The same `trees` model is fitted to the move of
the mid-price over the next 1, 5, 15, and 60 minutes, in ATRs, once on all features and
once on each group alone (price path, volume and flow, the book at trades, volatility,
swings and structure, session and time). It answers what has never been asked here: is
anything predictable from these inputs, at which horizon, and from which kind of input.
That is 28 fits, reported as a table of the skill above. None is a candidate policy.

## Part B: the policy, after costs

It runs in the engine, which first needs the changes of
[build-order item 8](roadmap.md#build-order).

| Setting | Value |
| --- | --- |
| Decision | At every eligible decision row the policy names a position: long, short, or flat ([decision 34](roadmap.md#decisions-of-november-23-2026)). Let `c` be the round trip's cost in R at that row: the spread plus both commissions, over the barrier distance |
| Enter | When flat: long if the forecast is above `c`, short if it is below `-c`. So a trade is placed only when it is forecast to earn more than it costs |
| Exit, policy `hold` | The bracket only: target and stop at the label's barriers, 3 hours, the session's forced exit. This is exactly the labelled trade |
| Exit, policy `flat` | The bracket, and also at the first decision row where the forecast no longer favours the position (at or below 0 for a long). The position is closed with a market order and its bracket orders are cancelled. Between 0 and `c` nothing changes, so a forecast hovering near the threshold does not trade in and out |
| Entry `cross` | A market order |
| Entry `passive` | A limit order at the best bid for a buy (best ask for a sell) of the book it meets, cancelled after 5 seconds ([decision 28](roadmap.md#decisions-of-november-23-2026)). Unfilled, the next decision row decides again. The threshold stays `c` for both entries, so they are compared on the same decisions |
| Passive fills | Base: the order joins the back of the displayed size and fills when that much has traded at its price since it arrived, or a trade prints through it. Stressed: only a trade through it. MBP-1 cannot say which is nearer the truth; paper trading will |
| Executions and costs | `base` and `stressed` (250 ms, one extra tick on marketable orders); full-size and micro costs |
| Portfolio | One position at a time across the products, one contract. Results in R first, and in dollars, for buys and sells apart, by product, by month. The daily cap is open: as decided ($3,000, $300 on micros) it refuses most trades at this bracket ([review, point 3](roadmap.md#review-of-november-23-2026)), so the policy is run with it and with a cap of 3 R a trade date, until Paul chooses |
| Sensitivity | The entry threshold at 0.5, 2, and 4 times `c`, reported beside the result. The threshold `c` is the result; the others only show how it depends on that choice |

## What counts

- **Skill:** the mean daily rank correlation of `trees` is above zero with its interval,
  pooled, and its mean is above zero for each product.
- **A policy:** net R per trade date above zero with its interval on the test months, under
  both executions, with a mean at or above zero for each product, for buys, for sells, and
  at micro costs.
- **An input added later** earns its place when the skill with it is above the skill without
  it, the difference paired by trade date with its interval above zero. The policy result
  confirms it; with 87 test dates it is too coarse to decide alone.

This is the exposed year: a pass here is a hypothesis for the untouched years. Four policy
cells (two exits, two entries) are run; every later variant is counted with them.

## Expected before the run

No skill at the 3-hour bracket. If the horizon map shows anything, it is at 1 minute, from
flow and the book at trades, and too small against the spread for a market order. The
policy places few trades or none.

## Named now, run later

Each is a variant of its own, written into this page before it is run.

- **Mirrored training rows.** Each row is also given to the model with every directional
  feature and the label negated, which forces the model to treat rises and falls alike. It
  needs each feature declared as directional or not.
- **Labels from the best path in hindsight.** For each session, the sequence of long, short,
  and flat that would have earned the most after a stated cost for each change, found by
  dynamic programming ([Boyarshinov and Magdon-Ismail](https://arxiv.org/abs/1009.4683);
  [Plessen and Bemporad](https://arxiv.org/abs/1709.07527)). The model learns that position
  directly, and the stated cost sets how large a move must be to count.
- **Other barriers and holds**, and the bracket sized by the middle timeframe.

## What has to be built

1. The label (`strategy-core`, beside `labels.py`), with the tests the swing labels have.
2. The decision dataset: rows, features as the engine computes them, labels, eligibility.
3. The walk-forward trainer and its report: `research yardstick GC SI`.
4. Runs and their variants stored in `research.*`, so every variant is counted.
5. For Part B, the engine changes of item 8.
