"""The clock stage: hand-checked times across a daylight-saving change, main hours by product,
a short session, and that it is a pure function of the rows it is given."""

from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pytest
from strategy_core.columns import Table
from strategy_core.engine import MarketChunk
from strategy_core.features import Unit
from strategy_core.market import NS, SessionCalendar
from strategy_core.pipeline import SPARSE_STEPS, STAGES, StageFeatures
from strategy_core.stage_clock import COLUMNS, FEATURES, ClockStage, root_of
from strategy_core.stages import StageContext

NY = ZoneInfo("America/New_York")


def at(text: str) -> int:
    """UTC ns of a New York wall-clock time."""
    return round(datetime.fromisoformat(text).replace(tzinfo=NY).timestamp()) * NS


# Friday before the clocks change (UTC-5), Monday after (UTC-4), and a session that closes
# early: 23, 23, and 19 hours.
SESSIONS = [
    ("2026-03-05 18:00", "2026-03-06 17:00"),
    ("2026-03-08 18:00", "2026-03-09 17:00"),
    ("2026-03-09 18:00", "2026-03-10 13:00"),
    ("2026-03-10 18:00", "2026-03-11 17:00"),
]
CAL = SessionCalendar(
    "test",
    np.array([at(o) for o, _ in SESSIONS], np.int64),
    np.array([at(c) for _, c in SESSIONS], np.int64),
)


def clock(contract: str, ends: list[int]):
    """The stage's rows for seconds ending at `ends`."""
    end = np.array(ends, np.int64)
    base = Table({"slot_ordinal": np.arange(len(end), dtype=np.int64) + 1, "end_ns": end}, {})
    stage = ClockStage(StageContext(CAL, 0, 0, None))
    chunk = MarketChunk(contract, int(end[0]) - NS, int(end[-1]), None, np.zeros((0, 2), np.int64))
    out = stage.process(chunk, {"tables": {"bar_1s": base}})
    return {
        k: np.where(out.nulls.get(k, np.zeros(len(end), bool)), np.nan, v)
        for k, v in out.values.items()
    }


def test_time_of_day_and_main_hours_follow_the_market_clock_across_the_time_change():
    noon = [at("2026-03-06 12:00"), at("2026-03-09 12:00")]  # UTC-5, then UTC-4
    f = clock("GCZ6", noon)
    np.testing.assert_allclose(f["tod_sin"], 0, atol=1e-12)  # noon is half way round, both days
    np.testing.assert_allclose(f["tod_cos"], -1)
    assert f["weekday"].tolist() == [1.0, 0.0]  # Friday, then Monday (the Sunday evening session)
    assert f["session_left_s"].tolist() == [5 * 3600, 5 * 3600]
    np.testing.assert_allclose(f["session_frac"], 18 / 23)
    # metals: main hours 08:20 to 13:30. The second ending at 08:20:00 is the last one before
    assert f["main_open_s"].tolist() == [3 * 3600 + 40 * 60] * 2
    assert f["main_close_s"].tolist() == [-90 * 60] * 2 and f["in_main"].tolist() == [1, 1]
    edge = clock(
        "GCZ6",
        [at("2026-03-09 08:20:00"), at("2026-03-09 08:20:01"), at("2026-03-09 13:30:00"),
         at("2026-03-09 13:30:01"), at("2026-03-08 18:00:01"), at("2026-03-09 17:00:00")],
    )  # fmt: skip
    assert edge["in_main"].tolist() == [0, 1, 1, 0, 0, 0]
    assert edge["main_open_s"].tolist()[:2] == [0, 1]
    assert edge["main_open_s"][4] == -(14 * 3600 + 20 * 60 - 1)  # Sunday evening: before it
    assert edge["session_frac"][5] == 1 and edge["session_left_s"][5] == 0
    assert edge["session_frac"][4] == pytest.approx(1 / (23 * 3600))


def test_main_hours_belong_to_the_product_and_an_unknown_one_has_none():
    rows = [at("2026-03-09 09:00"), at("2026-03-09 10:00")]
    assert clock("ESM6", rows)["in_main"].tolist() == [0, 1]  # the stock market opens at 09:30
    assert clock("ESM6", rows)["main_open_s"].tolist() == [-1800, 1800]
    assert clock("GCJ6", rows)["in_main"].tolist() == [1, 1]
    unknown = clock("X", rows)
    assert np.isnan(unknown["main_open_s"]).all() and np.isnan(unknown["main_close_s"]).all()
    assert unknown["in_main"].tolist() == [0, 0] and np.isfinite(unknown["tod_sin"]).all()
    assert root_of("GCZ6") == "GC" and root_of("MGCZ6") == "MGC" and root_of("RTYH6") == "RTY"
    assert root_of("GCZ6-GCG7") is None and root_of("X") is None


def test_a_short_session_is_flagged_and_keeps_its_main_open():
    f = clock("SIK6", [at("2026-03-10 09:00"), at("2026-03-10 13:00"), at("2026-03-11 09:00")])
    assert f["session_short"].tolist() == [1, 1, 0]  # 19 hours against the usual 23
    assert f["session_left_s"].tolist()[:2] == [4 * 3600, 0]
    assert f["main_close_s"][1] == -1800  # it closed half an hour before the main hours would
    assert f["weekday"].tolist() == [0.25, 0.25, 0.5]


def test_the_clock_is_a_pure_function_of_its_rows_and_declares_units():
    ends = [at("2026-03-09 08:19:55") + k * NS for k in range(20)]
    whole = clock("GCZ6", ends)
    parts = [clock("GCZ6", ends[:7]), clock("GCZ6", ends[7:8]), clock("GCZ6", ends[8:])]
    for name, _, _ in FEATURES:
        np.testing.assert_array_equal(np.concatenate([p[name] for p in parts]), whole[name])
    units = {u.value for u in Unit}
    assert all(c.unit in units for c in COLUMNS[2:]) and len(FEATURES) == 9
    assert ClockStage in STAGES and ClockStage.NAME in SPARSE_STEPS
    assert ClockStage(StageContext(CAL, 0, 0, None)).warmup() == 0 and ClockStage.STATE == ()
    names = [n for n in StageFeatures.sources() if n.startswith("clock.")]
    assert "clock.tod_sin" in names and "clock.main_open_s" not in names
    assert "clock.nyse_open_s" in names
