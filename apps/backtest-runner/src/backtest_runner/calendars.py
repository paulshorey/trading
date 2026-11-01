"""Scheduled-open sessions from exchange calendars (pandas_market_calendars).

Errors here change candle contents, so the session report flags trades during
scheduled closures; Databento's `status` schema can cross-check the calendar later.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from importlib.metadata import version

import numpy as np
import pandas_market_calendars as mcal
from strategy_core.market import Product, SessionCalendar

# Trading-time ordinals (and so phases) count scheduled-open slots from the first session on
# or after this date, the start of Databento's CME history. Every run, contract, and stored
# row shares it; changing it relabels phases but changes no candle or indicator value.
PHASE_ORIGIN = date(2010, 1, 1)


@dataclass(frozen=True)
class Session:
    trade_date: date
    open: int
    close: int
    after: int  # close of the previous session: the closure before this one starts here


def load_sessions(
    product: Product,
    start: date,
    end: date,
    warmup: int,
) -> tuple[SessionCalendar, list[Session], list[Session]]:
    """The calendar, `warmup` sessions before `start`, and trading sessions `start..end`."""
    if end < start:
        raise ValueError("end is before start")
    if start < PHASE_ORIGIN:
        raise ValueError(f"Sessions before {PHASE_ORIGIN} are not supported")
    cal = mcal.get_calendar(product.calendar)
    schedule = cal.schedule(start_date=PHASE_ORIGIN, end_date=end + timedelta(days=7))
    opens, closes, sessions = [], [], []
    previous_close = None
    for day, row in schedule.iterrows():
        o, c = row["market_open"].value, row["market_close"].value
        if "break_start" in schedule.columns and row["break_start"] < row["break_end"]:
            opens += [o, row["break_end"].value]
            closes += [row["break_start"].value, c]
        else:
            opens.append(o)
            closes.append(c)
        sessions.append(Session(day.date(), o, c, o if previous_close is None else previous_close))
        previous_close = c
    calendar = SessionCalendar(
        f"{product.calendar} (pandas_market_calendars {version('pandas_market_calendars')})",
        np.array(opens, np.int64),
        np.array(closes, np.int64),
    )
    trading = [s for s in sessions if start <= s.trade_date <= end]
    if not trading:
        raise ValueError(f"No {product.root} sessions between {start} and {end}")
    first = sessions.index(trading[0])
    return calendar, sessions[max(first - warmup, 0) : first], trading
