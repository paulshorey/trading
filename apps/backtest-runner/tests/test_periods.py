from datetime import date

import pytest
from backtest_runner import periods


def test_the_holdout_and_dates_before_the_development_period_are_refused():
    periods.check_period(periods.DEV_START, periods.DEV_END)
    with pytest.raises(ValueError, match="holdout"):
        periods.check_period(date(2026, 8, 1), periods.HOLDOUT)
    with pytest.raises(ValueError, match="starts"):
        periods.check_period(date(2025, 12, 31), periods.DEV_END)
    with pytest.raises(ValueError, match="before start"):
        periods.check_period(date(2026, 3, 2), date(2026, 3, 1))
    assert periods.DEV_END < periods.HOLDOUT and set(periods.TEST_MONTHS) == {5, 6, 7, 8}
