# The clock and session inputs: spec

Frozen November 27, 2026, before the stage is built and before the model is run with it.
Build-order item 1 of the [roadmap](roadmap.md#build-order), step 1 of the process,
[decision 43](roadmap.md#decisions).

## In plain words

Markets behave differently at different times: the open of the main market, the middle of
the night, the last hour before the close. Today the model knows only how many seconds have
passed since the session opened. This adds where each row is in time: the time of day, how
far the session is from its close, where the row stands against the product's main market
hours, and the day of the week. Nothing here reads a price or a trade: every value follows
from the row's time, the exchange calendar, and the product.

## What is computed

One row per second, from the calendar alone. All times are scheduled-open time, as
everywhere.

| Feature | Unit | What it is |
| --- | --- | --- |
| `tod_sin`, `tod_cos` | ratio | The time of day in the product's market time zone, as a point on a circle: midnight and 23:59 are neighbours |
| `session_left_s` | seconds | Scheduled seconds until this session closes |
| `session_frac` | ratio | The share of the session that has passed, 0 at the open to 1 at the close |
| `session_short` | ratio | 1 when the session is shorter than the product's usual one (an early close), else 0 |
| `main_open_s` | seconds | Clock seconds since the main hours opened on this trade date: negative before, positive after |
| `main_close_s` | seconds | Clock seconds since the main hours closed: negative before, positive after |
| `in_main` | ratio | 1 inside the main hours, else 0 |
| `weekday` | ratio | The trade date's day of the week, Monday 0 to Friday 1 in steps of a quarter (Sunday's evening session belongs to Monday's trade date) |

`session_elapsed_s` exists already (`candle_1m_1s`) and stays where it is.

**The time to the forced exit is left out.** It depends on an execution setting, and a stage
must not; it is `session_left_s` less a constant.

**Main hours** are the hours of the product's main cash or floor market, a property of each
product, in New York time:

| Products | Main hours | Why these |
| --- | --- | --- |
| GC, SI, PL (metals) | 08:20 to 13:30 | The former COMEX floor hours, still when most volume trades and when settlement prices are set |
| ES, NQ, YM, RTY (equity indices) | 09:30 to 16:00 | The stock market's hours |

On a trade date whose session does not contain the main open (a holiday with a shortened
session), `main_open_s`, `main_close_s` are undefined and `in_main` is 0. The two are clock
seconds, not row counts: they answer "how long until the stock market opens", which a
closure does not stop.

**Daylight saving time** is handled by using the market time zone for the time of day and
the main hours, so 09:30 is always 09:30.

## What is stored

A new stage, `clock_1s` (tier 0, input: the calendar and the product), in its own table.
Like the fast swings of RSI and CVD it is stored at the end of every ten-second row, where
the decision dataset reads it; the engine computes every second. No other stage is rebuilt.
Adding a product needs its main hours and time zone in the product table.

## The test, frozen before its run

The yardstick is rerun on the same rows, target, folds, and model as run 12, with the nine
new features beside the 1,449.

| Item | Value |
| --- | --- |
| Compared | `trees` with the clock inputs against `trees_without_clock`, fitted in the same run |
| Measure | The difference of their pooled rank correlations on the test rows, 95% interval from resampled trade dates (`yardstick.paired_difference`) |
| Success | The interval of the difference is above zero |
| Also reported | The yardstick's slopes by month; the same comparison on the one-minute horizon, where the first run found the only predictability and found none from the session inputs |

**Expected before the run:** no detectable gain at the bracket horizon, on 86 trade dates
of two metals. The first run's horizon map gave the session inputs alone no skill at any
horizon. The inputs are built anyway: they are cheap, they let the model condition every
other input on the time of day, and they matter more once products with different main
hours are trained together ([decision 42](roadmap.md#decisions)).
