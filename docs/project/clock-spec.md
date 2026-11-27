# The clock and session inputs: spec

The [dated venue clocks](#dated-venue-clocks) are the inputs used by training and
replay. The original experiment specification below was frozen on November 27,
2026 before run 13. It records step 1 of the process and
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

**Result:** no detectable gain at either horizon
([run 13](results.md#do-the-clock-and-session-inputs-add-skill)).

## Dated venue clocks

Run 13 above describes the original nine inputs at commit `539416a`. The current
model keeps the two time-of-day inputs, session time remaining, session fraction
and the weekday of the interval's local close. This weekday can differ from the CME
order trade date on a holiday. The model adds signed seconds to each named venue event, plus a
short-session flag based on the configured products' regular 23-hour session. Negative
seconds mean the event is ahead. Each decision reads occurrences inside its own open
futures interval. For repeated events it reads the nearest known occurrence, choosing
the earlier one on a tie. An absent, inapplicable or unpublished event yields a missing
value. The engine and the minute-end training dataset call the same function with UTC
row ends. The sparse stage and its historical database rows retain their original identity.

[Rules](../../lib/strategy-core/src/strategy_core/schedules/rules.csv) give the venue,
instrument group, IANA zone, normal local time, effective dates and source. GC, SI, PL
and MGC share the named metals events, including **separate** settlement windows for gold,
silver and platinum. ES, NQ, RTY and YM read equity-index settlement, cash-market
boundaries and common macro events. The edition has 46 shared event clocks,
87 metals clocks and two equity-index settlement clocks. Globex uses the instrument's product calendar.
Floor and London participation references are conventions. Settlement and benchmark
windows describe scheduled calculation times.

[Published dates](../../lib/strategy-core/src/strategy_core/schedules/published.csv)
are versioned inputs. Each date carries its scheduled local time, source and earliest
verified availability (`known_at`). For a current publisher page without a historical
publication stamp, the snapshot uses its retrieval date. This deliberately leaves gaps in
historical training coverage. On the 470,100 GC/SI decision rows from January 2 through
August 31, 2026, 111 of the 133 applicable named clocks have a value on at least one
row. The 22 without a usable occurrence include retail sales, ISM releases, jobless
claims, Fed speeches and the RMB fixing. Add archived publisher announcements to improve coverage.
The file contains timing information only. Contract-specific expirations, delivery dates
and index roll periods require a separate contract or index calendar.

The package uses the pinned tzdata wheel to resolve each actual source-local date and
time. Venue calendars select holiday hours and overnight dates. An ordinary Shanghai
Friday night belongs to the following Monday's trading date. The session-based NYSE,
Tokyo and Globex calendars cover 2016–27, subject to the effective bounds of each rule.
Globex interval endpoints use each product's calendar. Their trade-date labels use
CME clearing business dates, with the historical Friday holiday exception through
June 18, 2026. [CME's effective-date notice](https://www.cmegroup.com/notices/electronic-trading/2026/06/20260615.html).
The detailed metals and publication calendars cover portions of the 2025–26 research
archive. Dates outside a rule's coverage stay missing. The 2026 LME Christmas and
New Year's Eve exceptions need a dated exchange notice before they are used.

Materialize any covered range by **venue trading date** after applying migration 0018:

```sh
uv run research clocks GC SI PL MGC ES NQ RTY YM --start 2025-11-01 --end 2026-12-31
```

`market.clock_rule` stores local rules by edition and effective start date.
`market.clock_occurrence` stores the venue trading date, actual local date and time,
scheduled instant and publication availability as PostgreSQL timestamps with time zone.
Join the two on `revision`, `event` and `rule_valid_from = valid_from`. UTC instants
can be formatted in the rule's source zone for display. Rerunning a batch fills missing
records idempotently. A changed rule, calendar mapping, source file or relevant package
version creates another edition. Dataset caches, saved backtests and model artifacts carry
that edition. Previously trained artifacts can be replayed at their training revision.

Local research run 15 evaluates GC and SI on the existing development dates and walk-forward
folds, with the bracket and one-minute targets, `trees` with and without all clock
columns, and paired intervals resampled by trade date. Success requires a positive
lower bound at the bracket horizon. The final holdout stays reserved.
