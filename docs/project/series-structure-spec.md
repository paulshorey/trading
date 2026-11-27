# Swings and structure of RSI and of CVD: spec

Frozen November 24, 2026, before the stages were built. Build-order item 11 of the
[roadmap](roadmap.md#build-order), step 5 of the process, [decision 41](roadmap.md#decisions).

## In plain words

Price has a zigzag on every timeframe: a high is confirmed when price has fallen a set
number of ATRs from it. The same zigzag is now computed on two more series, RSI and CVD,
and each is measured in its own ATR. The result is three market structures a timeframe:
price, RSI, and CVD, each with its confirmed highs and lows, its trend, and its `structure`
code. The model reads all three and decides what their agreement or disagreement is worth.

## What a series is

Everything is computed on the aggregated rows of a timeframe, never on single trades:

| Series | Its value at a row |
| --- | --- |
| RSI | The mean of `candle_<window>.rsi` over the last 60 rows, which holds each of the 60 phases' latest RSI once ([why](#the-rsi-series-the-mean-over-the-60-phases-decided-november-26-2026)). Each value is read in whole millionths of a point, so floating-point noise never decides whether two equal values differ and the sum is exact |
| CVD | `bar_<rows>.cvd`: buying minus selling volume from the contract's first row through this row |

One row gives one value, at the row's close. On `1m@1s` that is a value every second, on
`10m@10s` every ten seconds, on `1h@1m` every minute. A row without data has no value and
ends the zigzag's segment, as it does for price.

CVD is read by its changes only, never its level. The level is a count from wherever the
counting began: a backtest that starts after a contract's first stored session counts from
zero there, so its level differs from the stored one by a constant. Every feature here is a
difference inside one segment (a swing, a distance, a threshold), so it is the same either
way; a test shifts the level and compares. The stored levels (`ext`, `high_level`,
`low_level`, and an event's `level`) are context for a chart and are never model inputs.

(The zigzag of price is the one exception in the system: it reads the trades inside a row in
order, so that it knows which level price reached first, and still publishes once a row. It
was built that way before this spec and is not changed here.)

## Each series has its own ATR

Computed exactly as price's ATR is, with the series in place of price: for the window of 60
rows ending at a row, the true range is the highest minus the lowest value of the series in
the window, widened to the value one window earlier; the ATR is the Wilder average of 14
such ranges, per phase. A swing of RSI is measured in ATRs of RSI and a swing of CVD in ATRs
of CVD. Price's ATR is not used.

Measured on GC and SI, March 2 to April 24, 2026 (39 trade dates, front sessions):

| Timeframe | RSI: ATR (points) | RSI: mean change a row | GC CVD: ATR (contracts) | SI CVD: ATR |
| --- | ---: | ---: | ---: | ---: |
| `1m@1s` | 7.2 / 6.7 | 0.5 / 0.4 | 24 | 8 |
| `10m@10s` | 7.5 / 7.4 | 0.6 / 0.6 | 111 | 43 |
| `1h@1m` | 7.4 / 7.4 | 0.6 / 0.6 | 355 | 149 |

(The RSI columns are of the series first built, the stored RSI read row by row. Of the mean
over the phases, which replaced it, the ATR is about 3.1 points and the change a row 0.06.)
RSI's ATR is about 7 points on every timeframe and both products (GC / SI above). CVD's
grows with the timeframe and differs by product, which is why it must be its own.

## The threshold

A running high is confirmed by a fall of `theta` from it, frozen when the high is set.

| Setting | Value |
| --- | --- |
| Multiples | 0.5, 1, 2, and 3 of the series' own ATR: the multiples price uses, so a swing of one series can be compared with a swing of another at the same multiple |
| Why the same multiples | Counted with a plain zigzag on the dates above, the three series make about as many swings at the same multiple. Confirmed highs a trade date for GC at 0.5, 1, 2, 3 ATRs: on `1m@1s`, price 895, 292, 81, 37, RSI 1,115, 333, 76, 35, CVD 480, 193, 71, 38; on `10m@10s`, price 120, 31, 7.8, 3.7, RSI 118, 34, 7.4, 3.1, CVD 55, 20, 6.6, 3.6; on `1h@1m`, price 21, 5.6, 1.5, 1.3, RSI 19, 5.8, 1.3, 0.6, CVD 8.3, 3.1, 1.1, 0.6. SI is alike |
| The smallest swing | An ATR decays toward zero when a market stops moving, and a threshold of nearly nothing would then confirm a swing on the first ordinary change. Price's threshold is at least 2 spreads for that reason. RSI: at least 2.5 points, about twice the change a row makes nine times in ten (1.1 to 1.4 points on all six). CVD: at least 3 typical trades, a typical trade being the volume over the trade count of the latest window that had trades. Both bind rarely where the market is active: at 0.5 ATR the RSI floor binds on about 1% of rows |
| The ATR that swing values are measured in | The series' ATR, floored at half its smallest swing (1.25 RSI points; 1.5 typical trades), as price's is floored at one spread against a threshold floor of two |
| Inputs of a row's threshold | The ATR and the floor as of the previous row: a row's own window already holds its value |

**Changed November 26, with the RSI series:** RSI's smallest swing is 0.25 points and its
normalizing ATR is floored at 0.125, measured again by the same rule
([below](#the-rsi-series-the-mean-over-the-60-phases-decided-november-26-2026)).

## What is stored

New stages, one per timeframe, series, and multiple: 24 in all, in `pivot_rsi_<rows>` and
`pivot_cvd_<rows>`, with their events in `market.pivot_event`. Each has the columns of a
price scale that make sense for it: `progress`, the distances and legs in its own ATRs, the
ages, `dir`, `trend`, the class of the last high and low, the provisional relations, the
break ages, and `structure`. A level of RSI is an input (an index from 0 to 100); a level of
CVD is a count of contracts and is context only. The flow of a leg, which price scales
store, is left out.

On `1m@1s` the rows are stored at the end of every ten-second row, where slower timeframes
and the decision dataset read them; the engine computes every second.

Nothing stored is rebuilt: the stages are new.

## The test of these inputs (frozen before the run)

The [yardstick](yardstick-spec.md) is rerun on the same dates, rows, target, folds, and
models as its run 9, with the 708 new features beside the 741 it had (1,449 in all).

| Item | Value |
| --- | --- |
| Decision row, target, eligibility, folds | Unchanged: one row a minute, the move ahead in R at the 1.5 slow ATR bracket, test months May to August 2026 |
| Compared | `trees` on all 1,449 features against `trees` on the 741 without the new ones (`trees_without_series`), fitted in the same run |
| Measure | The difference of their pooled rank correlations over the test rows, with a 95% interval from resampled trade dates, both forecasts scored on the same resample (`yardstick.paired_difference`) |
| Success | The interval of the difference is above zero ([what counts](yardstick-spec.md#what-counts)) |
| Also reported | The yardstick's slopes by month; the horizon map with the new features as a kind of their own (`series`) beside price's swings |
| Baseline | Run 9: `trees` 0.044 (-0.030 to 0.116) |

**Expected before the run:** no measurable gain. The swings of RSI and of CVD restate the
price path and the flow the model already reads, and 86 test dates resolve only a large
difference. The stages stay whatever the result: they are step 5 of the process, and the
codes that compare the three structures, which are the point of them, are not built yet.

### Result (November 25, 2026)

| Forecast (run 11 rescored, 86 test dates) | Pooled rank correlation | Squared error against `flat` |
| --- | --- | --- |
| `trees`, all 1,449 features | 0.042 (-0.033 to 0.121) | 9% higher |
| `trees_without_series`, the 741 | 0.044 (-0.033 to 0.116) | 12% higher |
| Difference, paired by trade date | -0.002 (-0.057 to 0.052) | |
| `trees_coarse` | 0.011 (-0.065 to 0.090) | 10% higher |
| `ridge` | 0.042 (-0.037 to 0.118) | 53% higher |

After review, the intervals above were recomputed by ranking the sampled rows within
each of 1,000 whole-date draws. The original saved report used fixed ranks. All four
point estimates reproduced on the run 11 cache (`33c7ef473d92ff73`). All 432,185 eligible
rows passed the decision-time swing readiness check. The corrected paired difference is
−0.00235 (95% interval −0.05664 to 0.05219).

**The new inputs add no measurable skill**, as expected before the run. The forecast without
them reproduces run 9 (0.044), so the comparison is on the same footing. By product `trees`
is 0.082 for GC and 0.000 for SI; by month -0.101, 0.097, 0.151, and 0.069. All four
calibration slopes are zero in every month, so the yardstick is still the flat forecast and
the policy was not replayed. Evidence: `~/yardstick-series.json`.

**The horizon map was not rerun.** With 1,449 features and a seventh kind of input it takes
more than two hours; the first attempt (run 10, left unfinished in `research.run`) was
stopped by the session's time limit on the last of its five horizons, before anything was
saved. Run 11 used `--no-horizons`. To get the map, run `research yardstick GC SI` from a
terminal, where nothing limits it.

## Not in this step

The codes that compare the three structures (agreement, divergence at the latest highs and
lows, a level one has broken that another holds). The model already receives the three
structures; the comparison codes follow as their own stage.

## The RSI series: the mean over the 60 phases (decided November 26, 2026)

**The flaw.** `candle_<window>.rsi` is 60 separate histories, one per phase, and each can
rest at its own level. Read row by row as one series, it steps up and down as the rows
rotate through the phases, whether or not price moves. The window's range of that series
is its ATR, so a threshold of 0.5 or 1 ATR lies inside the rotation and confirms swings no
phase made. A review reproduced it at a constant price: the fast 0.5 ATR scale confirmed 60
pivots in 30 minutes, all at two phases, with no trades and with one flat trade a second
([reproduction](https://github.com/paulshorey/trading/pull/103#issuecomment-7182430941)).
In the rows first stored, 5% to 11% of the RSI pivots at 0.5 and 1 ATR had their extreme
exactly 60 rows after the previous one of their kind, on every timeframe, against under 1%
for price and CVD. About 60% of the window range of that series was rotation: 7.5 points,
against 3.0 for the mean over the phases.

**The series now.** At row `o`, the mean of the stored RSI over rows `o − 59 … o`: each
phase's latest value once. Replacing one phase's old value with its new one moves the mean
by a sixtieth of that phase's change, so it moves only when a phase's RSI does. It has no
value until 60 rows in a row have one; a missing row ends the segment; closures have no
rows and take no place in it. It is still on RSI's scale of 0 to 100.

**Measured before the choice** (GC and SI, March 2 to April 24, 2026; a plain zigzag on the
stored RSI; `/` separates GC and SI; the three timeframes agree to within a few percent, so
`10m@10s` is shown). Control is the series first built. A second candidate, the mean plus
the newest row's full change since the same phase, was rejected: it is noisier than the
control (a change a row of 1.5 points at the 90th percentile, against 1.3).

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

**The model test, frozen before its run.** The same rows, target, folds, and model as run
11. Three forecasts are compared on the rows all three scored, paired by trade date
(`yardstick.paired_difference`): `trees` with these RSI swings; `trees` with the RSI swings
first built (run 11's data, fitted again to keep each row's forecast); and
`trees_without_rsi_swings`, with price's and CVD's swings kept. Success for the RSI swings
is an interval of "with" less "without" above zero. Expected: no measurable difference
among the three; the fix is about what the signal means, and the model test only checks it
did no harm. No policy is replayed while the yardstick's slope is zero.

**Result (November 27; run 12, 86 test dates, 223,579 test rows scored by all three).**

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
bracket horizon, on 86 trade dates. `trees` is 0.067
for GC and -0.002 for SI; by month -0.134, 0.011, 0.174, 0.136. `ridge` fell to 0.003
(-0.074 to 0.078) from 0.042, inside its interval. `trees_coarse` is 0.015 (-0.071 to
0.096). All four calibration slopes are zero in every month, so the yardstick is still the
flat forecast and no policy was replayed. Each row's forecasts are kept in
`data/models/yardstick/run-12/forecasts.npz`. Evidence: `~/yardstick-rsi-mean.json`.

**Replaying an earlier run.** Run 11's models read the RSI scales first built, which this
code no longer computes, and they are never given the renamed ones in their place.
`research policy 11` now stops before it starts and says so (`policy.incompatible`), and
points here. To replay run 11, check out commit `6916ed8`, the code it was fitted with: its
source digest equals the `code_sha256` of run 11's row in `research.run`. A model is judged
by the columns it reads, not by every name of its dataset: a fit leaves out a column that
had no value in training. Runs 9 and 12
replay. From now on an artifact records its commit, whether the tree had uncommitted
changes, and the dataset file its rows came from.

**Stored** (ingest run 8, all 12 contracts `current`). On the dates above, no RSI pivot at
any size or timeframe has its extreme exactly 60 rows after the previous one of its kind
(0.0%; 5% to 11% before at 0.5 and 1 ATR), and the swing counts equal those measured before
the build. The new scales are `<stream>_rsi_mean_atr_<k>`; the first ones,
`<stream>_rsi_atr_<k>`, are retired. Their rows (61.3 million, and 4.6 million events) were
deleted on November 27 with Paul's agreement; the names stay registered and are never
reused.
