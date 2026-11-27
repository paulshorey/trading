from datetime import date, time

import numpy as np
import pandas as pd
import pytest
from strategy_core import venue_clock as clock
from strategy_core.market import NS, SessionCalendar


def session(day, root="GC"):
    row = clock.schedule(clock.PRODUCTS[root].calendar, day.year).loc[str(day)]
    return {
        x.event: x
        for x in clock.session_events(root, row.market_open.value, row.market_close.value)
    }


@pytest.mark.parametrize(
    ("day", "gold", "cash"),
    [
        ("2026-01-15", "15:00", "14:30"),
        ("2026-03-16", "15:00", "13:30"),
        ("2026-07-15", "14:00", "13:30"),
        ("2026-10-28", "15:00", "13:30"),
    ],
)
def test_each_rule_uses_its_own_calendar_date_and_zone(day, gold, cash):
    events = session(date.fromisoformat(day))
    for event, utc in [
        ("lbma_gold_pm", gold),
        ("nyse_open", cash),
        ("shfe_day_open", "01:00"),
        ("sge_gold_pm", "07:00"),
    ]:
        assert events[event].at == pd.Timestamp(f"{day} {utc}Z")
    equity = session(date.fromisoformat(day), "NQ")
    assert "index_settle_start" in equity and "lbma_gold_pm" not in equity
    assert "index_settle_start" not in events


def test_holidays_and_overnight_venue_dates():
    events = session(date(2026, 11, 26))
    assert "globex_open" in events and "nyse_open" not in events and "gc_settle_end" not in events
    events = session(date(2026, 12, 24))
    assert events["nyse_imbalance"].at == pd.Timestamp("2026-12-24 17:50Z")
    assert events["gc_settle_end"].at == pd.Timestamp("2026-12-24 17:30Z")
    assert "lbma_gold_am" in events and "lbma_gold_pm" not in events
    assert "lbma_gold_am" not in session(date(2026, 8, 31))
    assert "shfe_night_open" not in session(date(2026, 9, 30))
    for venue, at in [("shfe", "13:00"), ("sge", "12:00")]:
        item = session(date(2026, 3, 13))[venue + "_night_open"]
        assert (item.at, item.trade_date) == (
            pd.Timestamp("2026-03-13 " + at + "Z"),
            date(2026, 3, 16),
        )
        end = session(date(2026, 3, 13))[venue + "_night_close"]
        assert end.at.tz_convert("Asia/Shanghai").date() == date(2026, 3, 14)


def test_published_events_are_visible_only_from_the_source_vintage():
    # The archived January BLS calendar was edited after the January payroll release.
    assert session(date(2026, 1, 9))["payrolls"].known_at > pd.Timestamp("2026-01-09 22:00Z")
    assert "fomc_statement" not in session(date(2026, 3, 17))
    dates = [date(2026, 1, 9), date(2026, 3, 18)]
    spans = clock.schedule("CMEGlobex_GC", 2026).loc[[str(d) for d in dates]]
    opened = np.array([t.value for t in spans.market_open], np.int64)
    closed = np.array([t.value for t in spans.market_close], np.int64)
    cal = SessionCalendar("test", opened, closed)
    at = pd.Timestamp("2026-03-18 18:00Z").value
    ends = np.array([closed[0], at - NS, at, at + NS])
    out = clock.feature_values("GC", cal, ends)
    assert np.isnan(out["clock.payrolls_s"]).all()
    np.testing.assert_equal(out["clock.fomc_statement_s"], [np.nan, -1.0, 0.0, 1.0])
    for i, end in enumerate(ends):
        single = clock.feature_values("GC", cal, np.array([end]))
        for k, v in out.items():
            np.testing.assert_equal(single[k][0], v[i])
    assert list(out) == [s.name for s in clock.SPECS]


def test_invalid_wall_times_are_rejected():
    for day, hour in [(date(2026, 3, 8), 2), (date(2026, 11, 1), 1)]:
        with pytest.raises(ValueError):
            clock.instant(day, time(hour, 30), "America/New_York")


def test_the_effective_tokyo_rule_and_its_dated_close_change_together():
    for day, hour in [(date(2024, 11, 1), 6), (date(2024, 11, 5), 6.5)]:
        event = session(day)["tokyo_close"]
        rule = clock.rule_on(event.event, event.trade_date)
        assert rule.local_time == ("15:00" if hour == 6 else "15:30")
        assert event.at.hour + event.at.minute / 60 == hour
    assert "lbma_gold_pm" not in session(date(2024, 11, 5))
    assert session(date(2026, 11, 27))["gc_tas_end"].at == pd.Timestamp("2026-11-27 18:30Z")
    assert session(date(2025, 12, 24))["lme_ring_close"].at == pd.Timestamp("2025-12-24 14:40Z")
