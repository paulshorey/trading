import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GLOBEX_MARKET_SESSION_CONFIG,
  WeeklyMarketSession,
  collectOpenBucketTimesBetween,
} from "./market-session.js";

test("Globex session follows winter and summer DST boundaries in the configured time zone", () => {
  const session = new WeeklyMarketSession(DEFAULT_GLOBEX_MARKET_SESSION_CONFIG);

  assert.equal(session.isOpenAt(new Date("2026-01-05T21:59:59.000Z")), true);
  assert.equal(session.isOpenAt(new Date("2026-01-05T22:00:00.000Z")), false);
  assert.equal(session.isOpenAt(new Date("2026-01-05T22:59:59.000Z")), false);
  assert.equal(session.isOpenAt(new Date("2026-01-05T23:00:00.000Z")), true);

  assert.equal(session.isOpenAt(new Date("2026-03-09T20:59:59.000Z")), true);
  assert.equal(session.isOpenAt(new Date("2026-03-09T21:00:00.000Z")), false);
  assert.equal(session.isOpenAt(new Date("2026-03-09T21:59:59.000Z")), false);
  assert.equal(session.isOpenAt(new Date("2026-03-09T22:00:00.000Z")), true);
});

test("next open calculation skips closed periods using local session time", () => {
  const session = new WeeklyMarketSession(DEFAULT_GLOBEX_MARKET_SESSION_CONFIG);

  const nextWinterOpenMs = session.getNextOpenMs(new Date("2026-01-05T22:15:00.000Z").getTime());
  assert.equal(new Date(nextWinterOpenMs).toISOString(), "2026-01-05T23:00:00.000Z");

  const nextSummerOpenMs = session.getNextOpenMs(new Date("2026-03-09T21:15:00.000Z").getTime());
  assert.equal(new Date(nextSummerOpenMs).toISOString(), "2026-03-09T22:00:00.000Z");
});

test("session helpers support non-US time zones and multiple daily windows", () => {
  const session = new WeeklyMarketSession({
    timeZone: "Asia/Tokyo",
    weeklyLocalWindows: [
      { startDay: "Mon", startTime: "09:00", endDay: "Mon", endTime: "11:30" },
      { startDay: "Mon", startTime: "12:30", endDay: "Mon", endTime: "15:00" },
    ],
    label: "Tokyo daytime",
  });

  assert.equal(session.isOpenAt(new Date("2026-01-05T00:30:00.000Z")), true);
  assert.equal(session.isOpenAt(new Date("2026-01-05T03:00:00.000Z")), false);
  assert.equal(session.isOpenAt(new Date("2026-01-05T04:30:00.000Z")), true);

  const nextOpenMs = session.getNextOpenMs(new Date("2026-01-05T03:00:00.000Z").getTime());
  assert.equal(new Date(nextOpenMs).toISOString(), "2026-01-05T03:30:00.000Z");

  const openBuckets = collectOpenBucketTimesBetween(
    new Date("2026-01-05T03:00:00.000Z").getTime(),
    new Date("2026-01-05T04:30:00.000Z").getTime(),
    30 * 60 * 1000,
    10,
    session,
  );
  assert.deepEqual(
    openBuckets.bucketTimes.map((timeMs) => new Date(timeMs).toISOString()),
    ["2026-01-05T03:30:00.000Z", "2026-01-05T04:00:00.000Z"],
  );
});
