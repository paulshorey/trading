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
| RSI | `candle_<window>.rsi`: the RSI of the window that ends with the row |
| CVD | `bar_<rows>.cvd`: buying minus selling volume from the contract's first row through this row |

One row gives one value, at the row's close. On `1m@1s` that is a value every second, on
`10m@10s` every ten seconds, on `1h@1m` every minute. A row without data has no value and
ends the zigzag's segment, as it does for price.

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

## Not in this step

The codes that compare the three structures (agreement, divergence at the latest highs and
lows, a level one has broken that another holds). The model already receives the three
structures; the comparison codes follow as their own stage.
