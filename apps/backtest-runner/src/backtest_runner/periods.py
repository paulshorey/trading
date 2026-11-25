"""The periods every experiment keeps to (docs/project/roadmap.md, how results are judged).

Experiments read front sessions of the development period only. Trade dates from `HOLDOUT` on
are reserved for one final evaluation, so a command that reads outcomes calls `check_period`
before it reads anything.
"""

from datetime import date

DEV_START, DEV_END = date(2026, 1, 2), date(2026, 8, 31)
HOLDOUT = date(2026, 9, 1)  # from here on: not read
TEST_MONTHS = (5, 6, 7, 8)  # of 2026: one walk-forward test block each


def check_period(start: date, end: date) -> None:
    if end >= HOLDOUT:
        raise ValueError(f"Trade dates from {HOLDOUT} on are the holdout; experiments stop before")
    if start < DEV_START:
        raise ValueError(f"The development period starts {DEV_START}; start is before it")
    if start > end:
        raise ValueError("end is before start")
