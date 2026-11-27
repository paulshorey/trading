# What the experiments found

The one place that records what each experiment asked, what was fixed beforehand, and what
it found. The current rules are in the [yardstick spec](yardstick-spec.md) and the
[swings of RSI and CVD](series-structure-spec.md). Questions are ordered newest first, and
so are the findings inside each.

**Staying flat is still the rule to beat.** The decision model has shown no skill at the
bracket's horizon, its calibrated forecast is the flat forecast, and it opens no position.
Every experiment so far rests on one year of GC and SI and 86 test trade dates (May to
August 2026, development dates only).

## Summary

| Question | Answer in one line | Trade dates | Run |
| --- | --- | ---: | --- |
| Do the RSI swings built as the mean over the phases add skill? | No detectable gain | 86 | 12 |
| Do the first RSI swings and the CVD swings add skill? | No detectable gain | 86 | 11 |
| How should the RSI series be read? | As the mean over the last 60 rows: no rotation noise | 39 | none |
| How were the swing thresholds chosen? | The same ATR multiples as price; floors from typical changes | 39 | none |
| Can the forecast be made no worse than `flat`? | Yes, because the slope is zero: the yardstick forecasts zero | 86 | 4 to 9 |
| Is anything predictable at the bracket horizon? | No: pooled skill's interval includes zero | 86 | 1 to 3 |
| Is anything predictable at other horizons? | A little at one minute (about 0.015), gone by fifteen | 86 | 1 |
| Does any policy earn after costs? | No: all eight cells lose; none differs from zero except `turn` with market orders, which is below | 86 | 2 |
| Does entering at a swing candidate earn? | No: it loses about one spread; entering against the slow trend is worse | 87 | replays |
| Was the first skill measure sound? | No: it rewarded any forecast that fades the session's move | 86 | 1 to 3 |

See also: [roadmap](roadmap.md) for the plan and what each result means for it, and
[build-log](build-log.md) for how things were built.

## Do the swings of RSI and CVD add skill?

**What was asked.** Does a decision model read better with the swings of RSI and of CVD, in
their own ATR, beside price's swings? Definition: [series-structure-spec.md](series-structure-spec.md).

**Fixed beforehand.** The [yardstick](yardstick-spec.md) rerun on the same dates, rows,
target, folds, and models as run 9, with the 708 new features beside the 741 it had (1,449
in all).

| Item | Value |
| --- | --- |
| Decision row, target, eligibility, folds | Unchanged: one row a minute, the move ahead in R at the 1.5 slow ATR bracket, test months May to August 2026 |
| Compared | `trees` on all 1,449 features against `trees` on the 741 without the new ones (`trees_without_series`), fitted in the same run |
| Measure | The difference of their pooled rank correlations over the test rows, with a 95% interval from resampled trade dates, both forecasts scored on the same resample (`yardstick.paired_difference`) |
| Success | The interval of the difference is above zero ([what counts](yardstick-spec.md#what-counts)) |
| Also reported | The yardstick's slopes by month; the horizon map with the new features as a kind of their own (`series`) beside price's swings |
| Baseline | Run 9: `trees` 0.044 (-0.030 to 0.116) |

Expected before the run: no measurable gain. The swings restate the price path and the flow
the model already reads, and 86 test dates resolve only a large difference.

### Run 12 (November 27, 2026): the RSI series as the mean over the phases

**What was asked.** The same rows, target, folds, and model as run 11. Three forecasts are
compared on the rows all three scored, paired by trade date: `trees` with these RSI swings;
`trees` with the RSI swings first built (run 11's data, fitted again to keep each row's
forecast); and `trees_without_rsi_swings`, with price's and CVD's swings kept. Success: an
interval of "with" less "without" above zero. Expected: no measurable difference; the
change is about what the signal means, and the test only checks it did no harm.

**Result** (86 test dates, 223,579 test rows scored by all three).

| Forecast | Pooled rank correlation | Squared error against `flat` |
| --- | --- | --- |
| `trees`, with these RSI swings | 0.032 (-0.048 to 0.112) | 12% higher |
| `trees`, with the RSI swings first built (run 11's rows, fitted again) | 0.042 (-0.033 to 0.121) | |
| `trees_without_rsi_swings` | 0.028 (-0.052 to 0.106) | 12% higher |
| `trees_without_series` (neither RSI's nor CVD's swings) | 0.044 (-0.033 to 0.116) | 12% higher |

| Difference, paired by trade date | Value (95% interval) |
| --- | --- |
| These RSI swings less none | 0.004 (-0.042 to 0.045) |
| These less the first built | -0.010 (-0.059 to 0.037) |
| The first built less none | 0.014 (-0.035 to 0.066) |
| RSI's and CVD's swings less neither | -0.012 (-0.056 to 0.029) |

**What this does and does not show.** No improvement is detectable, as expected: every
interval spans zero, and each is about 0.09 wide, so a real difference of a few hundredths
either way is not excluded. The test covers one kind of row and one horizon: forecasts at
the last second of a minute, where both slower timeframes have just completed a row, of the
move to the bracket's barriers. On most seconds at which the model would decide live, the
slower timeframes' values are older; that has not been tested. The comparison at shorter
horizons (the horizon map) was not run with these inputs, and no policy was replayed after
costs, the forecast being zero. So: no detectable gain on minute-end forecasts at the
bracket horizon, on 86 trade dates.

Other numbers: `trees` is 0.067 for GC and -0.002 for SI; by month -0.134, 0.011, 0.174,
0.136. `ridge` fell to 0.003 (-0.074 to 0.078) from 0.042, inside its interval.
`trees_coarse` is 0.015 (-0.071 to 0.096). All four calibration slopes are zero in every
month, so the yardstick is still the flat forecast and no policy was replayed.

**Evidence.** Run 12 in `research.run`; `~/yardstick-rsi-mean.json`; each row's forecasts in
`data/models/yardstick/run-12/forecasts.npz`.

### Run 11 (November 25, 2026): the first RSI swings and the CVD swings

**Result** (run 11 rescored, 86 test dates).

| Forecast | Pooled rank correlation | Squared error against `flat` |
| --- | --- | --- |
| `trees`, all 1,449 features | 0.042 (-0.033 to 0.121) | 9% higher |
| `trees_without_series`, the 741 | 0.044 (-0.033 to 0.116) | 12% higher |
| Difference, paired by trade date | -0.002 (-0.057 to 0.052) | |
| `trees_coarse` | 0.011 (-0.065 to 0.090) | 10% higher |
| `ridge` | 0.042 (-0.037 to 0.118) | 53% higher |

After review, the intervals above were recomputed by ranking the sampled rows within each of
1,000 whole-date draws. The original saved report used fixed ranks. All four point
estimates reproduced on the run 11 cache (`33c7ef473d92ff73`). All 432,185 eligible rows
passed the decision-time swing readiness check. The corrected paired difference is -0.00235
(95% interval -0.05664 to 0.05219).

**What this shows.** The new inputs add no measurable skill, as expected. The forecast
without them reproduces run 9 (0.044), so the comparison is on the same footing. By product
`trees` is 0.082 for GC and 0.000 for SI; by month -0.101, 0.097, 0.151, and 0.069. All four
calibration slopes are zero in every month, so the yardstick is still the flat forecast and
the policy was not replayed.

**The horizon map was not rerun.** With 1,449 features and a seventh kind of input it takes
more than two hours; the first attempt (run 10, left unfinished in `research.run`) was
stopped by the session's time limit on the last of its five horizons, before anything was
saved. Run 11 used `--no-horizons`. To get the map, run `research yardstick GC SI` from a
terminal, where nothing limits it.

**Evidence.** `~/yardstick-series.json`.

### Replaying an earlier run

Run 11's models read the RSI scales first built, which the code no longer computes, and
they are never given the renamed ones in their place. `research policy 11` stops before it
starts and says so (`policy.incompatible`). To replay run 11, check out commit `6916ed8`,
the code it was fitted with: its source digest equals the `code_sha256` of run 11's row in
`research.run`. A model is judged by the columns it reads, not by every name of its
dataset: a fit leaves out a column that had no value in training. Runs 9 and 12 replay.
An artifact records its commit, whether the tree had uncommitted changes, and the dataset
file its rows came from.

## How should the RSI series be read?

**What was asked.** Which series of RSI values should the zigzag run on? Decided November 26,
2026, after a review found the first one flawed.

**The flaw.** `candle_<window>.rsi` is 60 separate histories, one per phase, and each can
rest at its own level. Read row by row as one series, it steps up and down as the rows
rotate through the phases, whether or not price moves. The window's range of that series is
its ATR, so a threshold of 0.5 or 1 ATR lies inside the rotation and confirms swings no
phase made. A review reproduced it at a constant price: the fast 0.5 ATR scale confirmed 60
pivots in 30 minutes, all at two phases, with no trades and with one flat trade a second
([reproduction](https://github.com/paulshorey/trading/pull/103#issuecomment-7182430941)).
In the rows first stored, 5% to 11% of the RSI pivots at 0.5 and 1 ATR had their extreme
exactly 60 rows after the previous one of their kind, on every timeframe, against under 1%
for price and CVD. About 60% of the window range of that series was rotation: 7.5 points,
against 3.0 for the mean over the phases.

**The series chosen.** At row `o`, the mean of the stored RSI over rows `o - 59 ... o`: each
phase's latest value once. Replacing one phase's old value with its new one moves the mean
by a sixtieth of that phase's change, so it moves only when a phase's RSI does.

**Measured before the choice** (GC and SI, March 2 to April 24, 2026, 39 trade dates; a
plain zigzag on the stored RSI; `/` separates GC and SI; the three timeframes agree to
within a few percent, so `10m@10s` is shown). Control is the series first built. A second
candidate, the mean plus the newest row's full change since the same phase, was rejected: it
is noisier than the control (a change a row of 1.5 points at the 90th percentile, against
1.3).

| | Control | Mean over the phases |
| --- | ---: | ---: |
| Own ATR, points | 7.7 / 7.6 | 3.1 / 3.1 |
| Change a row, 90th percentile, points | 1.35 / 1.36 | 0.124 / 0.124 |
| Pivots repeating 60 rows apart, at 0.5 and 1 ATR | 5.7%, 5.3% / 6.1%, 5.4% | 0.0% |
| Confirmed highs a date at 0.5, 1, 2, 3 ATRs (GC) | 120, 34, 7.5, 3.3 | 26, 17, 10, 6.4 |
| Rows from the extreme to its confirmation, median (GC) | 10, 31, 140, 365 | 33, 52, 107, 170 |

Matched one to one with a control pivot of the same kind within one window, the mean's
pivots at 0.5, 1, 2, and 3 ATRs find a partner 100%, 94%, 64%, and 46% of the time (GC,
`10m@10s`; SI and the other timeframes alike). The matched extreme is 15 to 30 rows later,
half a window, which is the cost of averaging rows up to 59 old. The confirmation is about
30 rows later at 0.5 and 1 ATR, the same at 2, and about 100 rows earlier at 3, because the
mean's ATR is smaller. The control's extra pivots at 0.5 ATR (four in five) have no partner
in the mean.

**The smallest swing, measured again.** The rule of the first spec, twice the change a row
makes nine times in ten, gives 0.25 points (0.245 to 0.252 on all six). The 2.5 points of
the control would bind on 99.8% of rows at 0.5 ATR and make that scale a fixed threshold;
0.25 binds on none in an active market. Values in ATRs divide by the ATR floored at 0.125.

**Checked in tests.** Both reproductions, from two starting phases: no RSI scale confirms
anything once every phase has settled and one cycle has passed. On every timeframe, 60
steady phases give one constant value from any starting phase. The reference zigzag, any
chunking, checkpoints, price and size scaling, and a gap are tested as before.

**Stored** (ingest run 8, all 12 contracts `current`). On the dates above, no RSI pivot at
any size or timeframe has its extreme exactly 60 rows after the previous one of its kind
(0.0%; 5% to 11% before at 0.5 and 1 ATR), and the swing counts equal those measured before
the build. The new scales are `<stream>_rsi_mean_atr_<k>`; the first ones,
`<stream>_rsi_atr_<k>`, are retired. Their rows (61.3 million, and 4.6 million events) were
deleted on November 27 with Paul's agreement; the names stay registered and are never
reused.

## How were the swing thresholds of RSI and CVD chosen?

**What was asked.** What ATR does each series have, and do the same multiples of it as
price's give comparable swing counts? Measured on GC and SI, March 2 to April 24, 2026 (39
trade dates, front sessions), before the stages were built.

| Timeframe | RSI: ATR (points) | RSI: mean change a row | GC CVD: ATR (contracts) | SI CVD: ATR |
| --- | ---: | ---: | ---: | ---: |
| `1m@1s` | 7.2 / 6.7 | 0.5 / 0.4 | 24 | 8 |
| `10m@10s` | 7.5 / 7.4 | 0.6 / 0.6 | 111 | 43 |
| `1h@1m` | 7.4 / 7.4 | 0.6 / 0.6 | 355 | 149 |

The RSI columns are of the series first built, the stored RSI read row by row. Of the mean
over the phases, which replaced it, the ATR is about 3.1 points and the change a row 0.06.
RSI's ATR is about 7 points on every timeframe and both products (GC / SI above). CVD's
grows with the timeframe and differs by product, which is why it must be its own.

**Why the same multiples as price.** Counted with a plain zigzag on the dates above, the
three series make about as many swings at the same multiple. Confirmed highs a trade date
for GC at 0.5, 1, 2, 3 ATRs:

| Timeframe | Price | RSI (first series) | CVD |
| --- | --- | --- | --- |
| `1m@1s` | 895, 292, 81, 37 | 1,115, 333, 76, 35 | 480, 193, 71, 38 |
| `10m@10s` | 120, 31, 7.8, 3.7 | 118, 34, 7.4, 3.1 | 55, 20, 6.6, 3.6 |
| `1h@1m` | 21, 5.6, 1.5, 1.3 | 19, 5.8, 1.3, 0.6 | 8.3, 3.1, 1.1, 0.6 |

SI is alike.

**The smallest swing.** An ATR decays toward zero when a market stops moving, and a
threshold of nearly nothing would then confirm a swing on the first ordinary change. Price's
threshold is at least 2 spreads for that reason. For RSI, the first floor was 2.5 points,
about twice the change a row makes nine times in ten (1.1 to 1.4 points on all six); it was
replaced by 0.25 with the mean series (above). For CVD: at least 3 typical trades. Both
bind rarely where the market is active: at 0.5 ATR the first RSI floor bound on about 1% of
rows.

## Can the forecast be made no worse than `flat`?

**What was asked.** `trees` forecasts moves of -0.95 to +0.76 R while knowing almost
nothing: its squared error is 12% above a forecast of zero, and its rule opens on 95% of
rows. Until the forecast is at least as good as `flat`, a policy built on it trades noise,
and no input can be judged by what the policy earns.

**The suspected cause.** Rows of one session share almost all of their target, and some
inputs are nearly constant through a session. A tree that may make a leaf of 500 rows can
give a single session its own leaf and learn that session's outcome.

**Fixed beforehand (November 24, 2026).** Two remedies, each fitted on training rows only
(current definitions in the [spec](yardstick-spec.md#models)): `coarse`, a leaf must hold at
least as many training rows as ten trade dates have on average; `shrunk`, the forecast is
multiplied by a slope between 0 and 1, fitted from out-of-block forecasts on the training
dates (the first run cut them in four blocks in time order, forecast each by a model fitted
on the other three less the date next to the block on each side, and set a negative slope to
zero). Variants: `trees_coarse`, `trees_shrunk`, `trees_coarse_shrunk`, beside `trees`. The
policy of Part B was to be replayed with `trees_coarse_shrunk`, all eight cells. The
horizon map and `ridge` were not rerun as such (the command refits `ridge` with every run,
and its numbers did not change).

**What counts.** The variant does its job if its squared error is not above `flat`'s: the
mean excess per trade date has an interval that includes zero or lies below it. Skill is
still the pooled rank correlation above zero with its interval; nothing here was expected
to create skill, only to stop the forecast claiming it. Expected: a slope of a tenth or
less, so the policy opens few positions or none; `coarse` alone narrows the forecasts but
leaves them too wide.

### Runs 4 and 5 (November 24, 2026): the first slope

`~/yardstick-calibrated.json` and `~/policy-calibrated.json`. **The slope is zero in all
four months, for both kinds of trees.** The yardstick then forecast zero, opened no position
in any of the sixteen replays, and equalled staying flat.

| Model | Pooled rank correlation | Squared error against `flat` | Forecast, 1st to 99th percentile |
| --- | --- | --- | --- |
| `trees` | 0.052 (-0.026 to 0.129) | 12% higher | -0.95 to +0.76 R |
| `trees_coarse` | 0.040 (-0.040 to 0.119) | 9% higher | -0.75 to +0.62 R |
| `trees_shrunk` | none: a constant | equal | 0 |
| `trees_coarse_shrunk` | none: a constant | equal | 0 |

1. **The shrink does its job, and more bluntly than expected.** The spec expected a slope of
   a tenth or less; it is zero. Checked before clipping on the first and last month's
   training rows: -0.04 and -0.06, and from -0.38 to +0.52 on single blocks. What the trees
   learn in one stretch of dates does not carry to another, even inside the training data.
2. **Larger leaves alone are not enough.** `coarse` narrows the forecasts a little and its
   error is still 9% above `flat`'s, with an interval above zero.
3. **The yardstick is honest.** It says nothing where it knows nothing, so it stays flat and
   loses nothing, where the first version lost 31 R trading noise. From here an input shows
   itself first as a slope above zero on held-out training dates, then as skill on the test
   months, and only then as trades.
4. **Nothing here touches the one-minute finding**, which was measured on other targets.

### Run 7 (after review): the slope fitted forward in time

A review of the run above found that its slope could not have been computed on the dates it
was applied to: the first block of training dates was forecast by a model fitted on the later
blocks. The slope was changed to be fitted the way it would be in use (current rule in the
[spec](yardstick-spec.md#models)); this was a change made after a result was seen. Four
slopes are reported for each test month: forward or two-sided, by date or by row. The
two-sided, by-row slope is the first run's, kept as `trees_coarse_shrunk`. `trees_shrunk` is
no longer refitted: its slope was zero in every month of run 4. Runs from 7 on report
`trees` unshrunk and calibrate `trees_coarse` only.

**Result** (run 7, on the rows rebuilt after the review; `~/yardstick-review.json`). All
four slopes are zero in every month, so neither the direction of the fit nor the weighting
changes anything, and the yardstick is still the flat forecast.

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

### Run 9: one row a session fewer

`~/yardstick-review2.json`. The row exactly one hour before the forced exit was eligible,
while the engine opens nothing with an hour or less left; eligibility now needs more than an
hour. 432,185 eligible rows, from 432,513. All four slopes are again zero in every month.
`trees` 0.044 (-0.030 to 0.116), 12% above `flat`; `trees_coarse` 0.029 (-0.049 to 0.111),
10% above; `ridge` 0.031 (-0.044 to 0.107). The horizon map was not rerun, and the policy
was not replayed: every forecast is zero.

## Is anything predictable, and does a policy earn? The first run

**What was asked.** The first version of the decision model: at every second, forecast the
move ahead in R, and turn the forecast into buy, sell, or nothing by comparing it with the
trade's cost. A horizon map asks whether anything is predictable at 1, 5, 15, and 60
minutes, and from which kind of input.

**Fixed beforehand.** The settings in the [spec](yardstick-spec.md). Expected: no skill at
the bracket's horizon; if the horizon map shows anything, it is at 1 minute, from flow and
the book at trades, too small against the spread for a market order; the policy opens few
positions or none, so the closing rules can hardly be told apart.

**Result (November 24, 2026).** GC and SI, January 2 to August 31, 2026; test months May to
August, 86 trade dates. Recorded as runs 1 to 3 in `research.run` (3 is the forecast with
the corrected measure, 2 the policy). Evidence: `~/yardstick-gc-si-2.json`,
`~/policy-gc-si.json`, and their logs. **The model has no skill at the bracket's horizon and
every policy cell loses.**

**Rows.** 470,100 rows, one a minute over 171 sessions a product, with 741 features (the
engine now holds 1,449). 432,513 are eligible: 22,230 are within an hour of the forced exit,
12,850 in the five flagged sessions of each product, 2,442 have a spread above a quarter of
R, and 65 no usable book. Every eligible row has a target: price reached 1.5 slow ATRs above
first in 35%, below first in 39%, and neither before the close in 26%.

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

**What this shows.**

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
   `opposite` was the same as `hold` within +-0.4 R. With no skill in the forecast there is
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
leaf can still fit single sessions. This led to the [calibration variants](#can-the-forecast-be-made-no-worse-than-flat).

**Not as specified.** An engine runs one product, so each product had its own portfolio and
daily limit; the spec said one position at a time across the products.

## Does entering at a swing candidate earn? (November 2026, before the model)

Before the decision model existed, everything tested was a rule that enters at a swing candidate, and none beat staying
flat ([build log](build-log.md), [record of the replays](../archive/replay.md)):

- **Entering at a fast or a middle swing candidate loses about one spread**, at a
  one-minute bracket and at an hourly one, with a market order or with a limit resting at
  the candidate's extreme. No rule on the slow swings changes that.
- **No model told which early reversals complete** better than the distance price had
  already moved, and candidates reversed about as often as a random walk would
  ([decision 29](roadmap.md#decisions)).
- **One pattern repeated:** entering against the `slow_atr_1` trend was worse than entering
  with it, by $20 to $240 an attempt, in both halves of the period and for fast and middle
  candidates alike. It removes losses and leaves a result near zero.

These replays and the design they tested were withdrawn on November 23, 2026; the code is
removed.

## A flaw in the first skill measure

Found on November 24, after the first run and before any result was reported. The spec first
measured skill as the rank correlation between forecast and label within each trade date,
averaged over dates. The first run gave `trees` 0.135 (95% interval 0.069 to 0.197), above
zero for both products and in all four months: by the rule written then, skill.

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
nothing. The rule is in [AGENTS.md](../../AGENTS.md#research-principles).

**Two more corrections after run 11 (review).**

- Each bootstrap draw samples whole trade dates with replacement. Both forecasts and the
  target are ranked over the sampled rows, including ties and repeated dates. Previous
  reports kept ranks fixed across draws.
- The dataset still requires all stage slices to exist and all fixed warm-ups to have
  elapsed. A swing scale becomes ready when it has confirmed both a high and a low in its
  current segment. Each decision checks all scales at that minute. A later gap can end a
  segment and subsequent rows remain ineligible until both sides confirm again.
