# After-cost replay

`uv run research replay GC SI` answers one question before any model with new inputs is
fitted: what does acting on the stored fast candidates earn after costs? It applies the
[replay rules](roadmap.md#after-cost-replay) and is the yardstick every later input set is
judged by ([decision 6](roadmap.md#design-decisions-november-19-2026)). It reads stored
rows and the DBN files and stores nothing (`backtest_runner/replay.py`).

## What it does

For every candidate of a fast label variant (`market.pivot_label_1s`, six variants) on a warm
front session of the development period, it sends a would-be market entry at the candidate's
decision row: **sell at a candidate high, buy at a candidate low**. The entry and its exits
run through the engine's simulator (`labels.attempt`, `Simulator`), so the order meets the
book the exchange showed when it arrived and the bracket is fixed at the fill. Each candidate
is simulated on its own, whether or not a policy would take it.

Every candidate gets one of these states, under each bracket and execution setting:

| State | Meaning | Trade result | Value of attempting |
| --- | --- | --- | --- |
| `closed` | A trade closed at prices the book showed | its R and dollars | the same |
| `late` | The order arrived at or after the forced exit | none | zero: known, no trade |
| `entry_no_book` | The order met no usable book | none | unknown |
| `exit_no_book` | The exit was priced without a book, at a fallback | none | unknown |
| `uncovered` | Data coverage ends between entry and exit | none | unknown |
| `pending`, `censored` | The data ended first | none | unknown |

R is profit in ticks over the entry-to-stop distance, before commission. Commission ($2.50 a
contract a side) is subtracted in dollars. `avg_decision_spread_r` and `avg_entry_slip_r` say
what the entry cost in the same unit: the spread the engine held when it decided, and the
fill against that book's mid-price.

## Settings, frozen before any outcome was read

| Setting | Value |
| --- | --- |
| Brackets | `fast`: target 1.5 and stop 1.0 ATR of the candidate's own `1m@1s` row, held at most 180 s (the engine's default, as the control). `slow`: the same multiples of the ATR of the latest completed `1h@1m` row, held at most 3 hours |
| Executions | `base`: the backtest defaults (100 ms close delay, 50 ms order latency). `stressed`: 250 ms order latency and one more tick against every marketable order (`adverse_ticks`) |
| Eligibility | Both ATRs are defined, and the decision row's end plus the longest hold plus 60 s is not after the forced exit (300 s before the close). Decided at the decision row, never by the outcome; the same candidates under both brackets |
| Groups | Every candidate, and the provisional ones (`prov = 1`) |
| Test months | May to August 2026, as in the benchmark; a product's last session before a month is left out of its training rows |
| Displacement rule | Per month and product: a linear fit of the value of attempting (R before commission) on displacement, on earlier known values; take a candidate when the predicted value is above its own commission in R. Chosen at base costs; the stressed replay keeps the same choices |
| Portfolio | One position at a time across the products, one contract a trade, the engine's 10 s cooldown, orders taken as `Engine.execute` takes them. A fallback-priced exit stays in the ledger, flagged; net dollars and drawdown are also given with each flagged exit charged one further stop distance |

A middle hold, other multiples, and a per-product portfolio were not run. Any further variant
is added here before it is run, with its result, whether or not it helps.

### Agreement with the slower timeframe (frozen November 19, 2026, before its run)

The question: is a fast candidate worth taking when the slower timeframe points the same way?
On the slow bracket only, every eligible candidate is split by rules that read one slow swing
scale (`market.pivot_1m`: `slow_atr_0p5`, `slow_atr_1`, `slow_atr_2`) at the latest completed
minute, the same row the bracket's hourly ATR comes from. Each rule gives a direction, up or
down or none. A candidate is **with** the rule when that direction is its entry's side (a buy
at a candidate low while the slow direction is up), **against** it when it is the opposite
side, and in neither group when the rule gives no direction.

| Rule | The slow direction |
| --- | --- |
| `leg` | The open leg's direction (`dir` while `state = 2`): up after a confirmed slow low |
| `trend` | The stored `trend`: up after a higher high and a higher low, down after the mirror |
| `fresh` | `leg`, only while the pivot that started the leg was confirmed at most 3,600 scheduled-open seconds before the decision row (one `1h@1m` window): the slower timeframe has recently reversed |

That is 3 scales by 3 rules, each with its `against` group as the control: 18 groups for
every label variant, candidate group and execution setting. No rule is fitted, so each is
reported on the whole development period, on January to April, and on the test months (May
to August), where it also runs as one portfolio. A rule counts only if the value of attempting
its `with` group is above zero, with its 95% interval, in both parts of the period and under
both execution settings; with 18 groups per cell, one positive cell alone is expected by
chance and counts for nothing.

Not built: the [sliding-clock control](roadmap.md#after-cost-replay) (the same policy on
minute boundaries). It needs candidates detected on a minute clock, which are not stored.

## Results (November 19, 2026)

GC and SI, January 2 to August 31, 2026: 171 warm front sessions each, 2,783,418 candidates
over the six label variants, 175 s with 6 workers. Evidence: `~/replay-gc-si.json` and
`~/replay-gc-si.log` on the development Mac.

**Every candidate taken, development period** (R before commission, mean per closed trade;
`spread` is the spread at the decision in R):

| Label | Eligible | Fast R | Fast R, stressed | Fast spread | Slow R | Slow R, stressed | Slow spread | Slow win rate | Slow net $ per attempt (95%) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fast_atr_0p5_q25` | 929,770 | -0.204 | -0.290 | 0.224 | -0.023 | -0.032 | 0.026 | 0.459 | -76 (-111 to -31) |
| `fast_atr_0p5_q50` | 607,302 | -0.211 | -0.298 | 0.230 | -0.025 | -0.035 | 0.026 | 0.458 | -81 (-114 to -37) |
| `fast_atr_1_q25` | 422,142 | -0.237 | -0.334 | 0.264 | -0.028 | -0.038 | 0.028 | 0.457 | -91 (-121 to -55) |
| `fast_atr_1_q50` | 260,833 | -0.248 | -0.348 | 0.276 | -0.031 | -0.041 | 0.029 | 0.457 | -103 (-131 to -70) |
| `fast_atr_2_q25` | 150,527 | -0.276 | -0.385 | 0.309 | -0.029 | -0.040 | 0.031 | 0.458 | -91 (-118 to -66) |
| `fast_atr_2_q50` | 88,511 | -0.293 | -0.406 | 0.325 | -0.029 | -0.040 | 0.032 | 0.458 | -93 (-126 to -62) |

**One portfolio on the slow bracket, test months** (87 trade dates, one contract; the
interval is of mean daily net dollars, whole trade dates resampled):

| Label | Group | Candidates | Take-all fills | Net $ | Drawdown $ | Daily net $ (95%) | Net $, stressed | Rule takes | Rule fills | Rule net $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fast_atr_0p5_q25` | all | 430,265 | 913 | -35,955 | 79,865 | -1,728 to +861 | -25,300 | 0 | 0 | +0 |
| `fast_atr_0p5_q25` | provisional | 205,356 | 919 | -147,590 | 159,135 | -3,194 to -255 | -117,765 | 0 | 0 | +0 |
| `fast_atr_0p5_q50` | all | 286,145 | 916 | -82,810 | 115,750 | -2,689 to +834 | -107,465 | 0 | 0 | +0 |
| `fast_atr_0p5_q50` | provisional | 136,205 | 899 | -31,825 | 73,965 | -2,008 to +1,311 | -67,955 | 0 | 0 | +0 |
| `fast_atr_1_q25` | all | 202,932 | 930 | -122,880 | 151,720 | -2,762 to -40 | -236,605 | 0 | 0 | +0 |
| `fast_atr_1_q25` | provisional | 97,478 | 898 | -35,875 | 90,965 | -2,051 to +1,311 | -81,495 | 0 | 0 | +0 |
| `fast_atr_1_q50` | all | 127,542 | 916 | -30,475 | 130,575 | -2,114 to +1,383 | -150,360 | 0 | 0 | +0 |
| `fast_atr_1_q50` | provisional | 61,535 | 931 | -158,400 | 183,745 | -3,355 to -126 | -163,165 | 18 | 15 | -16,400 |
| `fast_atr_2_q25` | all | 74,959 | 907 | -15,180 | 102,230 | -1,908 to +1,532 | -20,120 | 0 | 0 | +0 |
| `fast_atr_2_q25` | provisional | 36,344 | 861 | -186,870 | 210,820 | -3,456 to -822 | -190,845 | 101 | 65 | +7,000 |
| `fast_atr_2_q50` | all | 44,515 | 904 | +56,630 | 99,835 | -880 to +2,178 | +37,770 | 144 | 99 | -9,465 |
| `fast_atr_2_q50` | provisional | 21,654 | 866 | -129,415 | 170,220 | -3,023 to +24 | -172,405 | 277 | 167 | -39,690 |

What this shows:

1. **Acting on a fast candidate alone has no edge, at either horizon.** The mean result is
   close to minus one spread in both brackets: about -0.20 to -0.29 R against a spread of
   0.22 to 0.33 R on the fast bracket, and -0.023 to -0.031 R against 0.026 to 0.032 R on the
   slow one. Before costs the side of a candidate is a coin flip.
2. **The fast bracket cannot pay.** A quarter of its risk is spread. Its take-all portfolio
   lost $1.1 to $2.7 million over the four test months on one contract (for example
   39,931 fills and -2,692,090 for `fast_atr_1_q25`). This confirms the decision
   that the faster timeframe only times an entry.
3. **The slow bracket cuts the cost to about 3% of risk, and what is left is still
   negative**: $76 to $103 lost per attempt, with every 95% interval below zero. In one
   portfolio that is about 900 trades in four months and a loss in eleven of twelve cells;
   most daily intervals include zero, because 900 trades of three hours are few.
4. **The displacement rule's answer is to stay flat.** Its fit never predicts a value above
   commission for most variants, and where it takes a few candidates (18 to 277 of tens of
   thousands) the result is noise, from -39,690 to +7,000. Staying flat is therefore the rule
   a learned policy must beat.
5. **Unknown outcomes are rare and counted.** Of the candidates' 2,783,418 rows,
   324,257 were ineligible because the three-hour hold did not fit the session and 76 had
   no ATR. Among the eligible, the slow bracket had 7,177 exits priced without a book
   (0.3%) and 116 entries that met no usable book; none was late, uncovered or
   censored. No slow portfolio held more than one flagged trade.

What it does not show: whether a candidate is worth taking with the book, divergences or
indicators of indicators as inputs. Those are the next items of the
[build order](roadmap.md#build-order), and each is judged here: an input set earns its place
when a policy using it has a value of attempting above zero on the slow bracket, on the same
candidates, under both execution settings.

## Agreement results (November 19, 2026)

The same 2,783,418 candidates, split by the [agreement rules](#agreement-with-the-slower-timeframe-frozen-november-19-2026-before-its-run).
Evidence: `~/replay-agreement-gc-si-v2.json` and `.log`. **No rule passed**: of the 18 groups
in each of the 12 cells (label variant and candidate group), none has a value of attempting
with a 95% interval above zero in both parts of the period, under either execution setting.

`fast_atr_0p5_q25`, every candidate, base execution: mean net dollars per attempt (the other
eleven cells read the same way; the stressed setting is about $28 lower throughout):

| Scale | Rule | With: Jan–Apr | With: May–Aug | Against: Jan–Apr | Against: May–Aug | With portfolio, May–Aug (fills) |
| --- | --- | --- | --- | --- | --- | --- |
| `slow_atr_0p5` | `leg` | -143 | -99 | -8 | -54 | -97,690 (917) |
| `slow_atr_0p5` | `trend` | -1 | -85 | -148 | -66 | -2,620 (875) |
| `slow_atr_0p5` | `fresh` | -113 | -84 | -62 | -75 | -98,380 (889) |
| `slow_atr_1` | `leg` | -126 | -106 | -24 | -46 | -38,745 (908) |
| `slow_atr_1` | `trend` | -26 | +23 | -142 | -175 | +128,765 (818) |
| `slow_atr_1` | `fresh` | +94 | -155 | -205 | -20 | -55,895 (694) |
| `slow_atr_2` | `leg` | -118 | -28 | -33 | -125 | -9,805 (910) |
| `slow_atr_2` | `trend` | +119 | -74 | -303 | -78 | -58,695 (841) |
| `slow_atr_2` | `fresh` | +261 | -8 | -463 | -49 | -15,720 (340) |

What this shows:

1. **Agreement defined by a rule on the slow swings does not make a fast candidate pay.** The
   best groups sit near zero, not above it: `slow_atr_1` `trend` is -26 then +23 an attempt,
   with intervals of about ±$300 and ±$140.
2. **The rules that looked best from January to April did not hold.** `slow_atr_2` `fresh`
   (the slower timeframe has just reversed the entry's way) was +$135 to +$271 an attempt in
   the first part and -$8 to -$74 in the second over the six label variants; `slow_atr_1`
   `fresh` changed sign the same way in the table above. Chosen on the first part, either would have lost in the second.
3. **One pattern held in both parts, and it is a loss avoided, not a gain.** Entering against
   the `slow_atr_1` trend was $106 to $253 an attempt worse than entering with it, in both
   parts and in all 12 cells but two provisional ones in the first part (-1 and +36). The
   slow trend therefore carries some information about direction; alone it removes losing
   trades and leaves a result near zero. No interval was computed for this difference, which
   was not a predeclared test, so it is a lead for the model's inputs and not a finding.
4. **Following the open leg is worse than fading it at the two smaller scales**: `leg` `with`
   lost $45 to $218 more than `against` in every cell and both parts at `slow_atr_0p5`, and
   $40 to $195 more at `slow_atr_1`. A fast pullback inside a slow leg did not resume it more
   often than not.
5. **Four months cannot resolve an edge of this size.** Three-hour trades overlap, so the
   test months hold about 87 independent dates; the interval of a group's mean is ±$140 to
   ±$300 an attempt, against a cost of about $80. More history
   ([decision 9](roadmap.md#design-decisions-november-19-2026)) is what narrows it.

**Correction before the merge.** The first run added the seconds since the minute row to a
leg's age in clock time, so a candidate in the minute after a closure had the closure added and
was dropped from `fresh`. Review caught it; the age now counts rows, as the rule above says.
The rerun changed only the `fresh` groups, by at most 245 candidates of a group and $8 an
attempt, and no conclusion (first run: `~/replay-agreement-gc-si.json`).

So the two-timeframe agreement signal of the goal is not available from pivot rules alone.
It remains to be tested inside the decision model (build-order item 8), with the slow
trend among its inputs.

## The middle timeframe's candidates (spec frozen November 23, 2026, before its run)

Build-order item 6: step 4 of the process (candidates as events) judged by step 6's measure,
`uv run research replay GC SI --timeframe mid`. The fast replay above is unchanged and stays
the default, so that its settings can be rerun as they are on the older years
([decision 13](roadmap.md#decisions-of-november-20-2026)).

**Question.** Is a `10m@10s` swing candidate worth acting on with the slow bracket, after
costs: every candidate, and the candidates the slower timeframe agrees with?

**Decision row.** The row of `market.pivot_label_10s` at which a candidate of a label variant
is first known (`mid_atr_0p5`, `mid_atr_1`, `mid_atr_2`, each at `q25` and `q50`: six
variants), on a warm front session of January 2 to August 31, 2026. Side: sell at a candidate
high, buy at a candidate low. **Horizon:** at most 3 hours after the fill; the cost there is
the spread, about 3% of the stop. **Baseline:** staying flat, which is zero.

| Setting | Value |
| --- | --- |
| Bracket | `slow` only: target 1.5 and stop 1.0 ATR of the latest completed `1h@1m` row (the minute row `ordinal // 6`), held at most 3 hours, fixed at the fill |
| Entries | `market`: as above. `limit` (cell `slow+limit`): a limit order at the candidate's extreme (`ext_px`), sent at the decision. If the book it meets is already at or through its price, it fills there, never worse than its price. Otherwise it rests and fills at its price when a trade prints through it (strictly beyond: there is no queue model). It is cancelled 2,400 scheduled seconds after it arrives (240 middle rows, the label's horizon), or earlier at the last time a 3-hour hold still fits the session. An order that never fills is `expired`: known, no trade, value zero |
| Executions | `base` and `stressed`, as above (the extra tick applies to marketable orders: market entries, stops, timed exits) |
| Costs | `full`: GC and SI tick values, $2.50 a contract a side. `micro`: the same fills in ticks at the tick values of MGC ($1) and SIL ($5), and $1.25 a contract a side. The micro books are not in the data, so this is a stress, not a simulation |
| Eligibility | As above (the slow ATR is defined and the 3-hour hold fits), and [decision 23](roadmap.md#decisions-of-november-20-2026): no file of the session is flagged (`degraded`), the engine holds a usable book at the decision, and that book's spread is at most 0.25 of the stop distance. Decided at the decision row; each reason is counted |
| Groups | Every candidate, and the provisional ones; each also for buys and sells apart, by product |
| Periods | The whole development period, January to April, and May to August, each reported apart |
| Portfolio | One position at a time across the products, one contract a trade, 10 s cooldown. A resting limit order occupies the portfolio until it fills and exits or expires. **Daily loss cap** ([decision 19](roadmap.md#decisions-of-november-20-2026)): $3,000 a trade date at full costs and $300 at micro costs. An order is placed only if the session's net loss so far plus its stop distance in dollars stays inside the cap, and none is placed once the loss has reached it. The report counts the orders refused and the sessions in which it bound. Policies that fit nothing run as one portfolio in each half of the period |
| Agreement | The rules above (`leg`, `trend`, `fresh` on `slow_atr_0p5`, `slow_atr_1`, `slow_atr_2`, read at the latest completed minute), on both entries |
| Displacement rule | As above, per cell, chosen at base execution and full costs |

**What counts.** A group counts as a lead only if its value of attempting (net dollars, full
costs) is above zero with its 95% trade-date interval in both halves of the period, under
both executions, and its mean is above zero for each product, for buys and for sells, and at
micro costs. There are 6 label variants, 2 candidate groups, and 2 entries, each with take-all
and 9 `with` groups: 240 policy cells. A few positive cells are expected by chance and count
for nothing. This is the exposed year, so even a lead is a hypothesis for the untouched years
([how results are judged](roadmap.md#how-results-are-judged-on-six-years)).

**Expected before the run:** taking every candidate at the market loses about one spread, as
the fast candidates did; the limit entry fills only when price comes back through the
candidate's extreme, which is also when the candidate is failing, so its fills are expected to
be worse than the market entry's, not better.

**Not run:** a bracket sized by the middle timeframe's own ATR, other multiples or waits, a
limit at any other price, and the sliding-clock control.

## Results for the middle timeframe (November 23, 2026)

GC and SI, January 2 to August 31, 2026: 171 warm front sessions each, 473,731 candidates over
the six label variants, about 4 minutes with 6 workers. Evidence: `~/replay-mid-gc-si.json`
and `.log` on the new Mac. **No group passed**: of the 240 policy cells, none has a value of
attempting with its 95% interval above zero in both halves, under either execution setting.
Staying flat remains the rule to beat.

**Every candidate taken, whole period** (per attempt, base execution, full costs; R before
commission; the limit's value counts an unfilled order as zero):

| Label | Eligible | Market: R | Market: R, stressed | Spread in R | Market: net $ (95%) | Limit: filled | Limit: R per fill | Limit: net $ (95%) | Market: net $, micro |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| `mid_atr_0p5_q25` | 184,953 | -0.027 | -0.037 | 0.029 | -83 (-111 to -53) | 89% | -0.022 | -57 (-84 to -31) | -15 |
| `mid_atr_0p5_q50` | 113,083 | -0.029 | -0.039 | 0.030 | -93 (-123 to -62) | 82% | -0.021 | -56 (-87 to -24) | -17 |
| `mid_atr_1_q25` | 61,833 | -0.030 | -0.041 | 0.031 | -94 (-140 to -48) | 82% | -0.026 | -64 (-121 to -6) | -18 |
| `mid_atr_1_q50` | 34,684 | -0.032 | -0.042 | 0.031 | -106 (-149 to -67) | 69% | -0.024 | -46 (-99 to +6) | -20 |
| `mid_atr_2_q25` | 17,602 | -0.038 | -0.048 | 0.032 | -128 (-235 to -24) | 70% | -0.034 | -66 (-154 to +27) | -24 |
| `mid_atr_2_q50` | 9,171 | -0.039 | -0.052 | 0.032 | -154 (-232 to -82) | 46% | -0.037 | -77 (-163 to +3) | -30 |

What this shows:

1. **A middle candidate taken at the market loses about one spread**, as a fast one did:
   -0.027 to -0.039 R against a spread of 0.029 to 0.032 R, with a win rate of 45%.
   Every interval is below zero. The prediction written before
   the run held.
2. **The limit entry gets a better price and the same result.** It fills 0.06 to 0.40 R
   better than the mid-price at the decision, and its fills still lose 0.021 to 0.037 R each:
   the price comes back through the candidate's extreme mostly when the candidate is failing.
   Per attempt it loses less ($46 to $77 against $83 to $154), partly because 11% to 54% of
   the orders never fill. No interval is above zero. This also held as predicted.
3. **No agreement rule passed, and the patterns of the fast replay repeat.** The
   `slow_atr_2` `fresh` groups earned $510 to $722 an attempt from January to April and lost
   $71 to $110 from May to August (`mid_atr_0p5_q25` and `mid_atr_1_q25`, both entries).
   Entering with the `slow_atr_1` trend was better than entering against it in 22 of the 24
   cells in the first half (by $20 to $184) and in all 24 in the second (by $36 to $242). The
   `with` group itself stays near zero: four of the 216 `with` cells have a positive mean in
   both halves and both executions, three of them this rule on the limit entry, at $2 to $44
   an attempt and with intervals that include zero. These are the same dates and the same
   slow trend as the fast replay, so this repeats that lead and does not confirm it.
4. **Buys did worse than sells, and the difference is not resolved.** Over the period a buy
   at a candidate low lost $182 to $271 an attempt at the market and a sell at a candidate
   high was between -$33 and +$13, for GC and for SI and in each half. The intervals by side
   are about ±$200 and most include zero, because all the buys of a trade date win or lose
   together. A falling market would explain it from May to August (the front contracts ended
   about 3% and 9% lower) but not from January to April, when both ended higher. It is
   recorded as an observation; results stay split by side so that a policy cannot hide in it.
5. **The daily loss cap decides what the take-all portfolio is.** Taking every candidate, the
   cap bound in 71 to 81 of the 84 and 87 trade dates of each half and refused most orders
   (of the 93,321 candidates of `mid_atr_0p5_q25` in the first half, 240 became orders, 64,144
   were refused by the cap, and the rest arrived while a position was open). The portfolio
   made 115 to 415 trades in a half, and its net result ranged from -$73,815 to +$88,240 with
   daily intervals that include zero in 44 of 48 cells; three of the other four are losses,
   and the one gain (`mid_atr_0p5_q50`, limit entry, January to April) was +$8,370 with an
   interval around zero in the second half. From January to April almost every fill was GC (230
   against 10 for SI in the first row). Measured afterwards: the median hourly ATR was $20.50
   for GC and $0.76 for SI, so the stop risks about $2,050 on a GC contract and $3,800 on SI,
   more than the cap by itself. The cap as decided therefore also sets the product mix
   ([review](roadmap.md#review-of-november-23-2026), point 3). This is a question for
   the decision model's sizing (item 8), not changed here.
6. **Micro costs change the scale, not the sign.** Commission is 0.8% of risk on the micros
   against 0.2% on the full-size contracts; every label's value of attempting stays below
   zero with its interval (-$15 to -$30 an attempt).
7. **The displacement rule again mostly stays flat** (0 to 5,097 candidates taken of tens of
   thousands), and where it trades the result is noise: -$47,205 to +$57,340.
8. **What was left out is counted.** Of 208,376 `mid_atr_0p5_q25` candidates: 18,085 where
   the hold did not fit the session, 5,085 in the five flagged sessions of each product, 226
   with a spread above a quarter of the stop, 22 without a usable book, 5 without an ATR.
   Among the eligible, 613 exits (0.3%) were priced without a book and one entry met none.

What it does not show: anything about a candidate chosen by the book, net flow, divergences,
or a model. With 171 trade dates the interval of a group's mean is ±$30 to ±$100 an attempt
for the large groups and ±$200 by side, against a cost near $80.

**Check of the unchanged fast replay.** `research replay GC SI` was rerun the same day with
this code on the rebuilt database (`~/replay-fast-new-machine.json`): 2,783,418 candidates,
and every number of the two tables of November 19 above is reproduced exactly.
