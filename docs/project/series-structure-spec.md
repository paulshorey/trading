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
| RSI | `candle_<window>.rsi`: the RSI of the window that ends with the row, read to a millionth of a point (so floating-point noise never decides whether two equal values differ) |
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

## Plan for the RSI signal used to confirm swings

**Step 5, proposed for the next experiment.** At a constant price, the fast 0.5-ATR
detector confirmed 60 pivots in 30 minutes. They all occurred at two phases. Each phase's
own RSI was steady. This happened both with no trades and with one flat-price trade every
second. A valid RSI swing signal must settle when all 60 phase histories settle.
[Reproduction and seed](https://github.com/paulshorey/trading/pull/103#issuecomment-7182430941).

1. **Compare two definitions.** Keep the current interleaved RSI as the control. Test the
   equal-weight mean of the latest RSI from each of the 60 phases as the candidate. At
   ordinal `o`, those are exactly the values at `o − 59 … o`. Each step replaces one
   phase's old value with its new value. If that phase was steady, its contribution to
   the mean stays the same. This gives the detector one series that is still on the 0–100
   RSI scale. The observations in the mean are 0–59 steps old, so confirmation delay is
   the main cost to measure.
2. **Specify the streaming calculation.** Use the same rule independently on each contract
   and timeframe. Average the existing RSI values expressed in integer millionths of a
   point, with a 60-row ring and an integer sum. Publish the mean only when all 60 slots
   are valid. A missing value ends the swing segment. Scheduled closures consume no slots.
   Feed the mean into the existing series ATR and zigzag, with the current floor of 2.5
   points, all four multipliers, and thresholds frozen from the preceding row. Use a
   separate variant identity for the experiment.
3. **Test signal meaning before scoring a model.** Reproduce both flat-price cases and
   require zero candidate pivots after a full phase cycle at steady phase values. Repeat
   with different starting phases on all three timeframes. On a sustained rise followed
   by a sustained fall, confirm the high only after the reversal threshold is crossed.
   Test a coverage gap, a session close/reopen, price rescaling, checkpoint restoration,
   and whole-session versus one-step replay against a plain reference.
4. **Measure the trade-off on development data.** Start with the original 39 GC/SI trade
   dates (March 2–April 24, 2026). For each product, timeframe and multiplier, report
   confirmed highs and lows per date, pivot phase during flat stretches, and elapsed
   scheduled-open time from the extreme to confirmation. Match same-kind candidate and
   control pivots one-to-one within one window and report their confirmation-time
   differences, the match rate and both unmatched counts. Recurrent flat-price pivots
   reject a definition. Inspect the delay and missed moves before choosing a variant for
   divergence. Lower pivot counts alone do not establish an improvement.
5. **Evaluate the chosen definition.** Freeze the choice before rerunning the yardstick.
   Compare the same model and eligible decisions with the original RSI swings, with the
   replacement, and with RSI swings omitted. Hold price and CVD features fixed. Use the
   existing purged walk-forward folds, bracket horizon and paired whole-date bootstrap.
   Report coverage separately and replay a non-flat policy with costs, by product and
   side. Reserve September 1, 2026 onward for the final evaluation. Version and rebuild
   the affected RSI stages after the definition is accepted, then build the divergence
   inputs against that version.
