# Swings and structure of RSI and of CVD: spec

The current definition. Step 5
of the process, [decision 41](roadmap.md#decisions). What was measured to choose it, and
what the model test found, is in [results.md](results.md#do-the-swings-of-rsi-and-cvd-add-skill).

## In plain words

Price has a zigzag on every timeframe: a high is confirmed when price has fallen a set
number of ATRs from it. The same zigzag is computed on two more series, RSI and CVD, each
measured in its own ATR. The result is three market structures a timeframe: price, RSI, and
CVD, each with its confirmed highs and lows, its trend, and its `structure` code. The model
reads all three and decides what their agreement or disagreement is worth.

## What a series is

Everything is computed on the aggregated rows of a timeframe, never on single trades:

| Series | Its value at a row |
| --- | --- |
| RSI | The mean of `candle_<window>.rsi` over the last 60 rows, read in whole millionths of a point |
| CVD | `bar_<rows>.cvd`: buying minus selling volume from the contract's first row through this row |

**Why RSI is a mean.** `candle_<window>.rsi` is 60 separate histories, one per phase. Read
row by row it steps up and down as the rows rotate through the phases, even at a constant
price, and a zigzag on it confirms swings no phase made. The mean over rows `o - 59 ... o`
holds each phase's latest RSI once and moves by a sixtieth of one phase's change, so it moves
only when a phase's RSI does. It is still on RSI's scale of 0 to 100. Whole millionths mean
floating-point noise never decides whether two equal values differ, and the sum is exact.
The measurements are in [results.md](results.md#how-should-the-rsi-series-be-read).

One row gives one value, at the row's close: every second on `1m@1s`, every ten seconds on
`10m@10s`, every minute on `1h@1m`. RSI has no value until 60 rows in a row have one. A row
without data has no value and ends the zigzag's segment, as it does for price; closures have
no rows and take no place in it.

**CVD is read by its changes only, never its level.** The level counts from wherever the
counting began: a backtest that starts after a contract's first stored session counts from
zero there, so its level differs from the stored one by a constant. Every feature here is a
difference inside one segment (a swing, a distance, a threshold), so it is the same either
way; a test shifts the level and compares. The stored levels (`ext`, `high_level`,
`low_level`, and an event's `level`) are context for a chart and are never model inputs.

The zigzag of price is the one exception in the system: it reads the trades inside a row in
order, so that it knows which level price reached first, and still publishes once a row.

## Each series has its own ATR

Computed as price's ATR is, with the series in place of price: for the window of 60 rows
ending at a row, the true range is the highest minus the lowest value of the series in the
window, widened to the value one window earlier; the ATR is the Wilder average of 14 such
ranges, per phase. A swing of RSI is measured in ATRs of RSI and a swing of CVD in ATRs of
CVD. Price's ATR is not used. RSI's ATR is about 3 points on every timeframe; CVD's grows
with the timeframe and differs by product, which is why it must be its own.

## The threshold

A running high is confirmed by a fall of `theta` from it, frozen when the high is set.

| Setting | RSI | CVD |
| --- | --- | --- |
| Multiples of the series' own ATR | 0.5, 1, 2, 3 | 0.5, 1, 2, 3 |
| Smallest swing (floor of `theta`) | 0.25 points | 3 typical trades |
| Floor of the ATR that swing values are divided by | 0.125 points | 1.5 typical trades |

- The multiples are price's, so a swing of one series compares with a swing of another at
  the same multiple; the three series make about as many swings at the same multiple.
- An ATR decays toward zero when a market stops moving, and a threshold of nearly nothing
  would confirm a swing on the first ordinary change. Price's threshold is at least 2
  spreads for that reason. RSI's floor is twice the change a row makes nine times in ten. A
  typical trade is the volume over the trade count of the latest window that had trades.
  Both floors bind rarely where the market is active.
- The ATR that values are measured in is floored at half the smallest swing, as price's is
  floored at one spread against a threshold floor of two.
- A row's threshold uses the ATR and the floor as of the previous row: a row's own window
  already holds its value.

## What is stored

One stage per timeframe, series, and multiple: 24 in all, in `pivot_rsi_<rows>` and
`pivot_cvd_<rows>`, with their events in `market.pivot_event`. Each has the columns of a
price scale that make sense for it: `progress`, the distances and legs in its own ATRs, the
ages, `dir`, `trend`, the class of the last high and low, the provisional relations, the
break ages, and `structure`. A level of RSI is an input (an index from 0 to 100); a level of
CVD is a count of contracts and is context only. The flow of a leg, which price scales
store, is left out.

Variant names: `<stream>_rsi_mean_atr_<k>` and `<stream>_cvd_atr_<k>`, for each timeframe
stream and multiple `k`. The first RSI variants, `<stream>_rsi_atr_<k>`, are retired: their
rows were deleted and the names stay registered and are never reused.

On `1m@1s` the rows are stored at the end of every ten-second row, where slower timeframes
and the decision dataset read them; the engine computes every second.

## Replaying an earlier run

A saved model reads the columns it was fitted on. Run 11's models read the retired RSI
scales, so `research policy 11` stops before it starts (`policy.incompatible`). To replay it,
check out commit `6916ed8`. Runs 9 and 12 replay. Details:
[results.md](results.md#replaying-an-earlier-run).

## Known limits

- The mean of RSI lags: its extremes come 15 to 30 rows later than a row-by-row series, half
  a window, which is the cost of averaging rows up to 59 old.
- The decision model has not been shown to gain from these inputs: no detectable difference
  on minute-end forecasts at the bracket horizon, on 86 trade dates. Other seconds and
  shorter horizons are untested ([results](results.md#do-the-swings-of-rsi-and-cvd-add-skill)).
- The three structures are given to the model separately. The test of the inputs was run
  without the comparison codes below.

## Not built

The codes that compare the three structures: agreement, divergence at the latest highs and
lows, a level one has broken that another holds. The model already receives the three
structures; the comparison codes follow as their own stage.
