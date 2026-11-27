# The first decision model (the yardstick): spec

The current specification of the one trained model's first version. It is step 6 of the
[process](roadmap.md#the-process-and-where-it-stands). What each run found is in [results.md](results.md);
where this page was changed after a result was seen, a line says so.

## In plain words

At every second the model forecasts one number: how far price will go from here before the
day's close, counted in the trade's own risk, up (positive) or down (negative). A rule turns
the forecast into buy, sell, or nothing by comparing it with what a trade costs. By default a
position is held to its stop, target, or the close; two rules that close it earlier, when the
forecast turns, are run beside that. Its job is to be the measuring stick: every later input
is judged by whether this model forecasts better with it, on the same rows. So far it
forecasts zero and trades nothing ([results](results.md)).

## Part A: the forecast

| Setting | Value |
| --- | --- |
| Decision rows | Every `1m@1s` row (every second) of a warm front session, January 2 to August 31, 2026 (171 trade dates a product), with every timeframe's features as of that second ([decision 38](roadmap.md#decisions)). Training reads one row a minute (the second that ends the minute): neighbours share 59 of 60 window rows and almost all of their label |
| Features | Every feature the engine holds at the row (1,590), read as the engine reads them. No price level, contract, or product identity |
| Splits | Test months May to August 2026 (`periods.TEST_MONTHS`). The model that scores a month is fitted on all earlier sessions of both products except the last one before the month. On six years: by quarter, as [frozen](roadmap.md#how-results-are-judged) |

**Eligibility** is decided at the row and counted by reason:

- The latest completed `1h@1m` row has an ATR.
- More than one hour remains before the forced exit (the engine opens nothing with an hour or
  less left). Changed on November 24, 2026 after run 9; why: see
  [results.md](results.md#run-9-one-row-a-session-fewer).
- No file of the session is flagged.
- The engine holds a usable book whose spread is at most a quarter of the stop distance
  ([decisions 21, 23, 27](roadmap.md#decisions)).
- Every stage slice exists and every fixed warm-up has elapsed. A swing scale is ready when
  it has confirmed both a high and a low in its current segment; each decision checks all
  scales at that minute, and a later gap can end a segment and make rows ineligible until
  both sides confirm again. Changed after run 11; why: see
  [results.md](results.md#a-flaw-in-the-first-skill-measure).

**Label `y`: the move ahead, in R.**

- Reference price: the mid-price of the book the engine holds at the decision.
- One R is 1.5 ATRs of the latest completed `1h@1m` row, fixed at the row: the distance to
  the stop and to the target ([decision 39](roadmap.md#decisions)).
- Trades are read in order from the decision until the session's forced exit: `+1` if price
  reaches one R above the reference first, `-1` if it reaches one R below first, else the
  move of the mid-price at the forced exit in R, which lies between them.
- A row whose follow-up loses data coverage is unknown: left out and counted.
- Costs are not in the label, so it is symmetric: what a short would see is `-y`.

Why this label: it is in the unit every result is read in. It is bounded, so a plain squared
error needs no outlier rule. One model serves both sides, so a year that trended cannot as
easily teach it one side only. It is also exactly what the default trade earns, held to its
stop, its target, or the close.

## Models

| Model | Definition |
| --- | --- |
| `flat` | The forecast is 0 |
| `ridge` | Linear, on features ranked and scaled on the training rows |
| `trees` | scikit-learn's histogram gradient boosting with fixed settings: 300 trees, learning rate 0.05, 15 leaves, at least 500 rows a leaf, seed 0. Nothing is tuned |
| `trees_coarse` | As `trees`, but a leaf must hold at least as many training rows as ten trade dates have on average, so no leaf can belong to one session |
| `trees_coarse_calibrated` | `trees_coarse` times a slope between 0 and 1: **the yardstick** |

**The slope.** The training dates are cut into four blocks in time order. The first is never
forecast. Each later block is forecast by a model fitted on the blocks before it only, less
the one date next to it (the code asserts a full trade date between the last date fitted and
the first forecast). The slope is the least-squares fit, through zero, of the target on
those out-of-block forecasts: how much of a forecast's size survives outside the sessions it
was fitted on. Below zero it is set to zero, which is the flat forecast. Each trade date
counts once: the two sums of the least-squares slope are means within a date, then summed
over dates.

Changed on November 24, 2026 after run 4 (first a two-sided fit, every row counting once);
why: see [results.md](results.md#run-7-after-review-the-slope-fitted-forward-in-time).
`trees_coarse_shrunk` is kept as recorded with the first run's slope; `trees_shrunk` is no
longer refitted. Each run reports for every test month all four slopes (forward or
two-sided, by date or by row).

## Skill, and the horizon map

**Skill** is the rank correlation between forecast and label over all the test rows
together, with a 95% interval from resampled trade dates. Each draw samples whole trade
dates with replacement and ranks both forecasts and the target over the sampled rows. Also
reported: the squared error against `flat`'s, pooled, by product, and by month. Changed on
November 24, 2026 after run 1 (the first measure took the correlation within each trade
date); why: see [results.md](results.md#a-flaw-in-the-first-skill-measure).

**The horizon map** is a diagnostic, not a policy. The same `trees` model is fitted to the
move of the mid-price over the next 1, 5, 15, and 60 minutes, in ATRs, and to the label
above, once on all features and once on each group alone (price path, volume and flow, the
book at trades, volatility, swings and structure, session and time). It answers: is anything
predictable from these inputs, at which horizon, and from which kind of input. That is 35
fits, reported as a table of the skill above. Since the swings of RSI and of CVD were added
they are a kind of their own, `series`, as the clock inputs are (`clock`). The run also fits
`trees` without the newest kind (`yardstick.ADDED`, now `clock`) and reports the paired
difference in skill, at the bracket and at one minute. With 1,458 features
the map takes more than two hours, so `--no-horizons` skips it; run `research yardstick GC SI`
from a terminal for the full map.

## Part B: the policy, after costs

It runs in the [engine](engine.md), every second.

| Setting | Value |
| --- | --- |
| Position and decisions | The position is long, flat, or short. At every eligible decision row the policy decides buy, sell, or nothing, and the position moves one step ([decision 35](roadmap.md#decisions)). A sell while long closes the long with a market order and cancels its orders; a sell at a later row, while flat, opens a short. Buys mirror this |
| Cost `c` | The round trip's cost in R at the row: the spread plus both commissions, over the stop distance |
| Opening | While flat: buy if the forecast is above `c`, sell if it is below `-c`. A position is opened only when the move forecast is larger than what the trade costs |
| Trend gate | A buy opens a long only when no timeframe's `trend` on its 3 ATR zigzag is down, and a sell opens a short only when none is up ([decision 38](roadmap.md#decisions)). The gate never blocks a closing decision. The share of seconds it leaves open is reported, and the default policy is also run without it, as its control |
| Bracket, under every rule | A stop one R against the entry, a target one R in favour, and the session's forced exit. No time limit. It never blocks a decision: a closing decision acts whatever it says |
| Entry `cross` | A market order |
| Entry `passive` | A limit order at the best bid for a buy (best ask for a sell) of the book it meets, cancelled after 5 seconds ([decision 28](roadmap.md#decisions)). Unfilled, the next second decides again. The threshold stays `c` for both entries, so they are compared on the same decisions |
| Passive fills | Base: the order joins the back of the displayed size and fills when that much has traded at its price since it arrived, or a trade prints through it. Stressed: only a trade through it. MBP-1 cannot say which is nearer the truth; paper trading will |
| Executions and costs | `base` and `stressed` (250 ms, one extra tick on marketable orders, the strict fill rule); full-size and micro costs |
| Risk | Variables of the run ([decision 36](roadmap.md#decisions)): 0.5% of the account risked between entry and stop, and no new position on a trade date once 2% is lost (four losing trades). Results are in R, as if a position could be sized exactly. Beside them, for an account of $100,000 in whole micro contracts: the result in percent, and the trades skipped because one contract risks more than the allowance |
| Portfolio | One position at a time across the products. Results for buys and sells apart, by product, by month. The engine runs one product, so so far each product has had its own portfolio and daily limit |
| Sensitivity | The opening threshold at 0.5, 2, and 4 times `c`, reported beside the result. The threshold `c` is the result; the others only show how it depends on that choice |

**Closing rules.**

| Rule | While long (mirror for a short) |
| --- | --- |
| `hold` | No closing decision. The default and the headline result ([decision 37](roadmap.md#decisions)): the simple, traditional trade, and exactly the one the label describes |
| `turn` | Sell when the forecast is at or below 0. The cost of closing is paid sooner or later by every position, so it is no reason to stay in one that the forecast no longer favours. Reopening needs the forecast beyond `c` again, so a forecast hovering near zero cannot trade in and out |
| `opposite` | Sell only when the forecast is below `-c`, the level that would open a short. The position rides through weak forecasts and leaves on a clear turn |

That is three closing rules and two entries with the gate, and `hold` with both entries
without it: eight policy cells, each under two executions.

## What counts

- **Skill:** the pooled rank correlation of `trees` is above zero with its interval, and it
  is above zero for each product.
- **The forecast is no worse than `flat`:** the mean excess squared error per trade date has
  an interval that includes zero or lies below it. Nothing here creates skill; it stops the
  forecast claiming skill it lacks.
- **A policy** (the `hold` rule is the headline): net R per trade date above zero with its
  interval on the test months, under both executions, with a mean at or above zero for each
  product, for buys, for sells, and at micro costs.
- **`turn` or `opposite`** is better than `hold` when the difference in net R per trade date,
  paired by date on the same openings, has its interval above zero.
- **An input added later** earns its place when the skill with it is above the skill without
  it, the difference paired by trade date with its interval above zero
  (`yardstick.paired_difference`, both forecasts scored on the same resample). The policy
  result confirms it; with 86 test dates it is too coarse to decide alone.

This is the exposed year: a pass here is a hypothesis for the untouched years. Every later
variant is counted with these eight cells.

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
- **Other multiples of the slow ATR** for the bracket (1 and 2).
- **A stricter gate** that needs every timeframe's trend to agree with the side, not only
  none against it: Paul's choice if the first gate lets too many bad trades through.

## What has been built

1. The label (`strategy-core`, `targets.py` beside `labels.py`), with tests.
2. The decision dataset (`apps/backtest-runner`, `dataset.py`): rows, features as the engine
   computes them, labels, eligibility.
3. The walk-forward trainer and its report (`yardstick.py`): `research yardstick GC SI`.
4. Runs and their variants stored in `research.*`, so every variant is counted.
5. For Part B, the engine and a strategy that reads the stored forecast (`policy.py`):
   `research policy RUN`. The same forecast computed live must equal the stored one
   (`research verify`).
