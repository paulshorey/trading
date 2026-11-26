# The first decision model: spec

**Proposed November 23, 2026, revised for Paul's decisions 35 to 39, and run on November
24.** The settings below were frozen before the run, with one exception that is marked: the
skill measure was replaced after the first run showed it to be biased
([what happened](#a-flaw-in-the-first-skill-measure)). The [results](#results-november-24-2026)
are at the end. It is build-order item 9 of the [roadmap](roadmap.md#build-order) and
step 6 of the process; Part B needs the engine of item 7 and the 3 ATR scale of item 8.

## In plain words

The first version of the one trained model. At every second it forecasts one number: how
far price will go from here before the day's close, counted in the trade's own risk, up
(positive) or down (negative). A rule turns the forecast into buy, sell, or nothing by
comparing it with what a trade costs. By default a position is held to its stop, target,
or time limit; two rules that close it earlier, when the forecast turns, are run beside that. It will probably do nothing almost always and earn nothing, because its inputs are the
ones that have shown nothing so far. Its job is to be the measuring stick: every later input
is judged by whether this model forecasts better with it, on the same rows.

## Part A: the forecast

| Setting | Value |
| --- | --- |
| Decision rows | Every `1m@1s` row (every second) of a warm front session, January 2 to August 31, 2026 (171 trade dates a product), with every timeframe's features as of that second ([decision 38](roadmap.md#decisions)). Training reads one row a minute (the second that ends the minute): neighbours share 59 of 60 window rows and almost all of their label |
| Eligibility | Decided at the row, counted by reason: the latest completed `1h@1m` row has an ATR; more than one hour remains before the forced exit (the engine opens nothing with an hour or less left); no file of the session is flagged; the engine holds a usable book whose spread is at most a quarter of the stop distance ([decisions 21, 23, 27](roadmap.md#decisions)) |
| Label `y` | The move ahead, in R. Reference price: the mid-price of the book the engine holds at the decision. One R is 1.5 ATRs of the latest completed `1h@1m` row, fixed at the row: the distance to the stop and to the target ([decision 39](roadmap.md#decisions)). Trades are read in order from the decision until the session's forced exit: `+1` if price reaches one R above the reference first, `-1` if it reaches one R below first, else the move of the mid-price at the forced exit in R, which lies between them. A row whose follow-up loses data coverage is unknown: left out and counted. Costs are not in the label, so it is symmetric: what a short would see is `-y` |
| Why this label | It is in the unit every result is read in. It is bounded, so a plain squared error needs no outlier rule. One model serves both sides, so a year that trended cannot as easily teach it one side only. It is also exactly what the default trade earns, held to its stop, its target, or the close |
| Features | Every feature the engine holds at the row (637 today), read as the engine reads them. No price level, contract, or product identity |
| Models | `flat`: the forecast is 0. `ridge`: linear, on features ranked and scaled on the training rows. `trees`: scikit-learn's histogram gradient boosting with fixed settings (300 trees, learning rate 0.05, 15 leaves, at least 500 rows a leaf, seed 0). Nothing is tuned |
| Splits | Test months May to August 2026 (`periods.TEST_MONTHS`). The model that scores a month is fitted on all earlier sessions of both products except the last one before the month. On six years: by quarter, as [frozen](roadmap.md#how-results-are-judged-on-six-years) |
| Skill | The rank correlation between forecast and label over all the test rows together, with a 95% interval from resampled trade dates. Also the squared error against `flat`'s. Reported pooled, by product, and by month. (Changed after the first run: the measure first written here took the correlation within each trade date, which is [biased](#a-flaw-in-the-first-skill-measure)) |

**The horizon map** (a diagnostic, no policy). The same `trees` model is fitted to the move of
the mid-price over the next 1, 5, 15, and 60 minutes, in ATRs, and to the label above, once on all features and
once on each group alone (price path, volume and flow, the book at trades, volatility,
swings and structure, session and time). It answers what has never been asked here: is
anything predictable from these inputs, at which horizon, and from which kind of input.
That is 35 fits, reported as a table of the skill above. None is a candidate policy.
(Since the swings of RSI and of CVD were added they are a kind of their own, `series`, beside
price's swings, and the run also fits `trees` without the newest kind and reports the paired
difference in skill: [the test](series-structure-spec.md#the-test-of-these-inputs-frozen-before-the-run).)

## Part B: the policy, after costs

It runs in the engine of [build-order item 7](roadmap.md#build-order), every second.

| Setting | Value |
| --- | --- |
| Position and decisions | The position is long, flat, or short. At every eligible decision row the policy decides buy, sell, or nothing, and the position moves one step ([decision 35](roadmap.md#decisions)). A sell while long closes the long with a market order and cancels its orders; a sell at a later row, while flat, opens a short. Buys mirror this |
| Cost `c` | The round trip's cost in R at the row: the spread plus both commissions, over the stop distance |
| Opening | While flat: buy if the forecast is above `c`, sell if it is below `-c`. A position is opened only when the move forecast is larger than what the trade costs |
| Trend gate | A buy opens a long only when no timeframe's `trend` on its 3 ATR zigzag is down, and a sell opens a short only when none is up ([decision 38](roadmap.md#decisions)). The gate never blocks a closing decision. The share of seconds it leaves open is reported, and the default policy is also run without it, as its control |
| Closing, rule `hold` | No closing decision. The default and the headline result ([decision 37](roadmap.md#decisions)): the simple, traditional trade, and exactly the one the label describes |
| Closing, rule `turn` | While long: sell when the forecast is at or below 0 (mirror for a short). The cost of closing is paid sooner or later by every position, so it is no reason to stay in one that the forecast no longer favours. Reopening needs the forecast beyond `c` again, so a forecast hovering near zero cannot trade in and out |
| Closing, rule `opposite` | While long: sell only when the forecast is below `-c`, the level that would open a short. The position rides through weak forecasts and leaves on a clear turn |
| Bracket, under every rule | A stop one R against the entry, a target one R in favour, and the session's forced exit. No time limit. It never blocks a decision: a closing decision acts whatever it says |
| Entry `cross` | A market order |
| Entry `passive` | A limit order at the best bid for a buy (best ask for a sell) of the book it meets, cancelled after 5 seconds ([decision 28](roadmap.md#decisions)). Unfilled, the next second decides again. The threshold stays `c` for both entries, so they are compared on the same decisions |
| Passive fills | Base: the order joins the back of the displayed size and fills when that much has traded at its price since it arrived, or a trade prints through it. Stressed: only a trade through it. MBP-1 cannot say which is nearer the truth; paper trading will |
| Executions and costs | `base` and `stressed` (250 ms, one extra tick on marketable orders, the strict fill rule); full-size and micro costs |
| Risk | Variables of the run ([decision 36](roadmap.md#decisions)): 0.5% of the account risked between entry and stop, and no new position on a trade date once 2% is lost (four losing trades). Results are in R, as if a position could be sized exactly. Beside them, for an account of $100,000 in whole micro contracts: the result in percent, and the trades skipped because one contract risks more than the allowance |
| Portfolio | One position at a time across the products. Results for buys and sells apart, by product, by month |
| Sensitivity | The opening threshold at 0.5, 2, and 4 times `c`, reported beside the result. The threshold `c` is the result; the others only show how it depends on that choice |

That is three closing rules and two entries with the gate, and `hold` with both entries
without it: eight policy cells, each under two executions.

## What counts

- **Skill:** the pooled rank correlation of `trees` is above zero with its interval, and it
  is above zero for each product.
- **A policy** (the `hold` rule is the headline): net R per trade date above zero with its interval on the test months, under
  both executions, with a mean at or above zero for each product, for buys, for sells, and
  at micro costs.
- **`turn` or `opposite`** is better than `hold` when the difference in net R per trade date,
  paired by date on the same openings, has its interval above zero.
- **An input added later** earns its place when the skill with it is above the skill without
  it, the difference paired by trade date with its interval above zero. The policy result
  confirms it; with 87 test dates it is too coarse to decide alone.

This is the exposed year: a pass here is a hypothesis for the untouched years. Every later
variant is counted with these eight cells.

## Expected before the run

No skill at the bracket's horizon. If the horizon map shows anything, it is at 1 minute, from
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
- **Other multiples of the slow ATR** for the bracket (1 and 2).
- **A stricter gate** that needs every timeframe's trend to agree with the side, not only
  none against it: Paul's choice if the first gate lets too many bad trades through.

## A flaw in the first skill measure

Found on November 24, after the first run and before any result was reported. The spec
first measured skill as the rank correlation between forecast and label within each trade
date, averaged over dates. The first run gave `trees` 0.135 (95% interval 0.069 to 0.197),
above zero for both products and in all four months: by the rule written above, skill.

It is not. The label is the move from a row to a later point of the same session. Within one
session that move falls as the current price rises, for any path: the later point is the
same for every row, so a row at a higher price has less of the move left. A measure taken
date by date therefore rewards any forecast that fades the session's move so far, whether or
not it knows anything. Three checks, on the same test rows:

| Forecast | Within each date (the first measure) | Over all rows (the corrected one) |
| --- | --- | --- |
| Minus the session's return so far (one feature, no model) | 0.646 (0.599 to 0.692) | -0.071 (-0.143 to 0.009) |
| `trees` | 0.135 (0.069 to 0.197) | 0.052 (-0.026 to 0.129) |
| Random numbers | -0.002 (-0.006 to 0.002) | -0.003 (-0.007 to 0.002) |

A forecast with no model behind it scores five times what the model did. The model's own
squared error was 12% above the flat forecast's, which the first measure contradicted. A
test on a simulated random walk now keeps both numbers apart
(`test_skill_is_not_fooled_by_a_forecast_that_fades_each_sessions_move`).

The corrected measure ranks all rows together and takes its interval from resampled trade
dates. This is a change made after seeing a result, so it is recorded as one: the first
measure's number is kept in the report (`within_date_rank_correlation_biased`) and decides
nothing. The rule is now in [AGENTS.md](../../AGENTS.md#research-principles).

PR #103 corrected two parts of the yardstick after run 11.

- Each bootstrap draw samples whole trade dates with replacement. Both forecasts and the
  target are ranked over the sampled rows, including ties and repeated dates. Previous
  reports kept ranks fixed across draws.
- The dataset still requires all stage slices to exist and all fixed warm-ups to have
  elapsed. A swing scale becomes ready when it has confirmed both a high and a low in its
  current segment. Each decision checks all scales at that minute. A later gap can end a
  segment and subsequent rows remain ineligible until both sides confirm again.

## Results (November 24, 2026)

GC and SI, January 2 to August 31, 2026; test months May to August, 86 trade dates. Recorded
as runs 1 to 3 in `research.run` (3 is the forecast with the corrected measure, 2 the
policy). Evidence: `~/yardstick-gc-si-2.json`, `~/policy-gc-si.json`, and their logs. **The
model has no skill at the bracket's horizon and every policy cell loses.** Staying flat
remains the rule to beat.

**Rows.** 470,100 rows, one a minute over 171 sessions a product, with 741 features. 432,513
are eligible: 22,230 are within an hour of the forced exit, 12,850 in the five flagged
sessions of each product, 2,442 have a spread above a quarter of R, and 65 no usable book.
Every eligible row has a target: price reached 1.5 slow ATRs above first in 35%, below first
in 39%, and neither before the close in 26%.

**The forecast** (rank correlation over the 223,749 test rows, 95% interval):

| Model | Pooled | GC | SI | Squared error against `flat` |
| --- | --- | --- | --- | --- |
| `ridge` | 0.029 (-0.048 to 0.106) | 0.023 | 0.035 | 30% higher |
| `trees` | 0.052 (-0.026 to 0.129) | 0.067 (-0.030 to 0.168) | 0.039 (-0.059 to 0.140) | 12% higher |

By month `trees` is -0.046, 0.027, 0.151, and 0.131: the last two have intervals above zero,
the pooled one does not. The forecasts are far too confident: they range from -0.95 to +0.76
R (1st to 99th percentile) where a forecast that knows this little should stay near zero,
and their error is worse than saying nothing.

**The horizon map** (the same model on the mid-price's move over each horizon; rank
correlation, interval in brackets where it excludes zero):

| Inputs | 1 minute | 5 minutes | 15 minutes | 60 minutes | The bracket |
| --- | --- | --- | --- | --- | --- |
| All 741 | 0.013 [0.009, 0.018] | 0.010 | 0.005 | -0.010 | 0.052 |
| Price path (132) | 0.014 [0.010, 0.019] | 0.008 | 0.013 | 0.024 | 0.029 |
| Volume and flow (64) | 0.016 [0.012, 0.021] | 0.009 [0.001, 0.017] | 0.007 | 0.014 | 0.000 |
| Book at trades (53) | 0.015 [0.010, 0.019] | 0.009 [0.002, 0.017] | 0.001 | 0.002 | 0.032 |
| Volatility (81) | 0.013 [0.007, 0.018] | 0.011 [0.001, 0.022] | 0.008 | -0.002 | -0.019 |
| Swings and structure (372) | 0.012 [0.007, 0.016] | 0.006 | 0.000 | -0.006 | 0.011 |
| Session and time (39) | 0.000 | -0.002 | 0.008 | 0.005 | 0.046 |

**The policy** (one portfolio a product, each with the daily limit of 4 R; net R after
commission over the four test months; base execution, with stressed beside it):

| Closing rule | Entry | Gate | Trades | Net R | Net R a trade date (95%) | Buys | Sells | Net R, stressed |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| `hold` | market | on | 537 | -31.1 | -0.36 (-1.01 to +0.23) | -33.2 | +2.1 | -34.2 |
| `hold` | passive | on | 540 | -21.4 | -0.25 (-0.89 to +0.37) | -27.3 | +6.0 | -29.0 |
| `turn` | market | on | 2,638 | -50.4 | -0.59 (-1.11 to -0.06) | -34.9 | -15.5 | -76.6 |
| `turn` | passive | on | 2,055 | -26.6 | -0.31 (-0.81 to +0.23) | -25.3 | -1.3 | -37.4 |
| `opposite` | market | on | 2,007 | -28.9 | -0.34 (-0.87 to +0.21) | -24.3 | -4.6 | -47.3 |
| `opposite` | passive | on | 1,669 | -13.5 | -0.16 (-0.67 to +0.37) | -19.5 | +6.0 | -21.1 |
| `hold` | market | off | 881 | -19.1 | -0.22 (-0.89 to +0.49) | -19.2 | +0.1 | -30.9 |
| `hold` | passive | off | 882 | -13.8 | -0.16 (-0.87 to +0.55) | -20.2 | +6.3 | -22.7 |

What this shows:

1. **No skill at the bracket's horizon.** The pooled correlation's interval includes zero for
   both models and both products, and the squared error is worse than a forecast of zero. Two
   good months out of four is what the rule for a lead forbids reading into.
2. **Something is predictable one minute ahead, from every kind of input but the clock, and
   it is gone by fifteen minutes.** A correlation of about 0.015 at one minute, down to 0.01
   at five from flow, the book, and volatility, and nothing after. This is the first positive
   finding of the project and it is the one the literature predicts. It is far too small to
   trade at the market: the spread is a third of a one-minute move. Its use is in timing an
   entry and in choosing between crossing and resting, which is where the book between
   trades should be judged.
3. **Every policy cell loses, and none is told apart from zero** except `turn` with market
   orders, which is below it. The headline cell, `hold` with market orders and the gate, lost
   31 R on 537 trades: its trades end at the target 210 times, the stop 234, and the close
   93. The loss is larger than costs alone (about 0.02 R a trade) because the buys lost.
4. **Buys lost and sells did not, again.** In every cell the buys lost 19 to 35 R and the
   sells were between -16 and +6. These four months fell. A model that leans short in a
   falling market is not skill, which is why results are read by side.
5. **Closing early did not help.** `turn` traded five times as often as `hold` and was worse
   by 0.23 R a trade date with market orders (0.49 under stress, interval below zero);
   `opposite` was the same as `hold` within ±0.4 R. With no skill in the forecast there is
   nothing for a closing rule to act on, so this says little about the rules themselves.
6. **Resting at the touch cost less than crossing** in every pair, by 5 to 24 R over the
   period, with 2,600 to 11,900 orders expiring unfilled. The differences are inside the
   noise of 86 dates.
7. **The gate left a quarter to a third of the rows open** (25% for longs, 33% for shorts)
   and did not help: `hold` lost 31 R with it and 19 R without. Buying only when no trend
   was down lost the most. One falling period cannot judge it.
8. **Micro costs and a real account.** At micro costs the headline cell lost 33.5 R. For an
   account of $100,000 risking 0.5% in whole micro contracts it lost 6.0%, and all 279 of its
   SI trades were too large to take: one SIL contract risks more than $500 at this stop.

**What the run got wrong in advance.** The spec expected the policy to open few positions.
Its forecast was beyond the cost on 95% of the rows, because the forecasts are overconfident.
Rows of one training session share almost all of their target, so a tree with 500 rows a
leaf can still fit single sessions. Named for the next variant: rows a session or leaf sizes
counted in sessions, and a forecast shrunk toward zero on training data before it is
compared with a cost.

**Not as specified.** An engine runs one product, so each product had its own portfolio and
daily limit; the spec said one position at a time across the products.

## A forecast that is no worse than `flat` (variant frozen November 24, 2026, before its run)

**The problem.** `trees` forecasts moves of -0.95 to +0.76 R while knowing almost nothing: its
squared error is 12% above a forecast of zero, and its rule opens on 95% of rows. Until the
forecast is at least as good as `flat`, a policy built on it trades noise, and no input can be
judged by what the policy earns.

**The suspected cause.** Rows of one session share almost all of their target, and some
inputs are nearly constant through a session. A tree that may make a leaf of 500 rows can
give a single session its own leaf and learn that session's outcome.

**Two remedies, each fitted on training rows only**

| Setting | Value |
| --- | --- |
| `coarse` | A leaf must hold at least as many training rows as ten trade dates have on average, so no leaf can belong to one session. Everything else as `trees` |
| `shrunk` | The forecast is multiplied by a slope between 0 and 1. The training dates are cut into four blocks in time order; each block is forecast by a model fitted on the other three, less the one date next to the block on each side. The slope is the least-squares fit, through zero, of the target on those out-of-block forecasts: how much of a forecast's size survives outside the sessions it was fitted on. Below zero it is set to zero, which is the flat forecast |
| Variants | `trees_coarse`, `trees_shrunk`, and `trees_coarse_shrunk`, beside `trees` as run |
| The yardstick from here on | `trees_coarse_shrunk`. The policy of Part B is replayed with it, all eight cells, nothing else changed. (Amended after the run: the yardstick is now `trees_coarse_calibrated`, [below](#the-slope-fitted-forward-in-time-changed-after-the-run-november-24-2026)) |
| Not rerun | The horizon map and `ridge`. (As run: the command refits `ridge` with every run, as the reference beside the trees, and its numbers are recorded with each run; they did not change) |

**What counts.** The variant does its job if its squared error is not above `flat`'s: the mean
excess per trade date has an interval that includes zero or lies below it. Skill is still
the pooled rank correlation above zero with its interval; nothing here is expected to create
skill, only to stop the forecast claiming it.

**Expected before the run.** The slope is small, a tenth or less. The shrunk forecast is then
beyond the cost on few rows, and the policy opens few positions or none. `coarse` alone
narrows the forecasts but leaves them too wide.

### Results of the variant (November 24, 2026)

Runs 4 (the forecast) and 5 (the policy) in `research.run`; `~/yardstick-calibrated.json`
and `~/policy-calibrated.json`. **The slope is zero in all four months, for both kinds of
trees.** The yardstick now forecasts zero, opens no position in any of the sixteen replays,
and equals staying flat.

| Model | Pooled rank correlation | Squared error against `flat` | Forecast, 1st to 99th percentile |
| --- | --- | --- | --- |
| `trees` | 0.052 (-0.026 to 0.129) | 12% higher | -0.95 to +0.76 R |
| `trees_coarse` | 0.040 (-0.040 to 0.119) | 9% higher | -0.75 to +0.62 R |
| `trees_shrunk` | none: a constant | equal | 0 |
| `trees_coarse_shrunk` (the yardstick) | none: a constant | equal | 0 |

1. **The shrink does its job, and more bluntly than expected.** The spec expected a slope of
   a tenth or less; it is zero. Checked before clipping on the first and last month's
   training rows: -0.04 and -0.06, and from -0.38 to +0.52 on single blocks. What the trees
   learn in one stretch of dates does not carry to another, even inside the training data.
2. **Larger leaves alone are not enough.** `coarse` narrows the forecasts a little and its
   error is still 9% above `flat`'s, with an interval above zero.
3. **The yardstick is now honest.** It says nothing where it knows nothing, so it stays flat
   and loses nothing, where the first version lost 31 R trading noise. From here an input
   shows itself first as a slope above zero on held-out training dates, then as skill on the
   test months, and only then as trades.
4. **Nothing here touches the one-minute finding**, which was measured on other targets.

### The slope, fitted forward in time (changed after the run, November 24, 2026)

A review of the run above found that its slope could not have been computed on the dates it
was applied to: the first block of training dates was forecast by a model fitted on the
later blocks. The yardstick's slope is now fitted the way it would be in use, and this is
recorded as a change made after a result was seen.

| Setting | Value |
| --- | --- |
| Blocks | The training dates in four blocks in time order. The first is never forecast. Each later block is forecast by a model fitted on the blocks before it only, less the one date next to it (the code asserts a full trade date between the last date fitted and the first forecast) |
| Weight | Each trade date counts once: the two sums of the least-squares slope are means within a date, then summed over dates. The squared-error measure the slope serves weighs dates equally, so a date with twice the rows should not count twice |
| The yardstick | `trees_coarse_calibrated`: `trees_coarse` times this slope |
| Kept as recorded | `trees_coarse_shrunk`, with the first run's slope: blocks on both sides, every row counting once |
| Reported | For each test month, all four slopes: forward or two-sided, by date or by row |
| No longer refitted | `trees_shrunk`. Its slope was zero in every month of run 4, so it was the flat forecast. Runs from 7 on report `trees` unshrunk and calibrate `trees_coarse` only |

**Result** (run 7, on the rows rebuilt after the review; `~/yardstick-review.json`). All
four slopes are zero in every month, so neither the direction of the fit nor the weighting
changes anything here, and the yardstick is still the flat forecast.

| Test month | Forward, by date (the yardstick) | Forward, by row | Two-sided, by date | Two-sided, by row (first run) |
| --- | ---: | ---: | ---: | ---: |
| May | 0 | 0 | 0 | 0 |
| June | 0 | 0 | 0 | 0 |
| July | 0 | 0 | 0 | 0 |
| August | 0 | 0 | 0 | 0 |

The policy with run 7's models (run 8) opens no position in any of the sixteen replays, as
before. The unshrunk models are unchanged by the review's corrections to the target and to
the stored rows: `trees` 0.051 (-0.027 to 0.126) with a squared error 12% above `flat`'s,
`trees_coarse` 0.027 (-0.051 to 0.107) and 10% above.

**One row a session fewer** (run 9, `~/yardstick-review2.json`). The row exactly one hour
before the forced exit was eligible here, while the engine opens nothing with an hour or
less left; eligibility now needs more than an hour. 432,185 eligible rows, from 432,513.
All four slopes are again zero in every month. `trees` 0.044 (-0.030 to 0.116), 12% above
`flat`; `trees_coarse` 0.029 (-0.049 to 0.111), 10% above; `ridge` 0.031 (-0.044 to 0.107).
The horizon map was not rerun, and the policy was not replayed: every forecast is zero.

## What has to be built

1. The label (`strategy-core`, beside `labels.py`), with tests.
2. The decision dataset: rows, features as the engine computes them, labels, eligibility.
3. The walk-forward trainer and its report: `research yardstick GC SI`.
4. Runs and their variants stored in `research.*`, so every variant is counted.
5. For Part B, the engine of item 7 and a strategy that reads the stored forecast. The same
   forecast computed live must equal the stored one (`research verify`).
