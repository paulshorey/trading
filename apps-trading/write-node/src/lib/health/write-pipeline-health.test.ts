import assert from "node:assert/strict";
import test from "node:test";

import { getWritePipelineHealth } from "./write-pipeline-health.js";

const baseStreamStatus = {
  connected: true,
  authenticated: true,
  streaming: true,
  reconnectAttempts: 0,
};

const baseStreamStats = {
  marketOpen: true,
  marketOpenByTicker: {
    ES: true,
  },
  messagesReceived: 100,
  parseErrors: 0,
  skippedMarketClosed: 0,
};

test("reports healthy when hourly lag stays within threshold", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: "2026-03-17T18:53:00.000Z",
            latest_source_row_count: 60,
            latest_target_time: "2026-03-17T18:52:00.000Z",
          },
        ] as Row[],
      }),
    },
    streamStatus: baseStreamStatus,
    streamStats: baseStreamStats,
    maxAllowedLagMinutes: 2,
    processUptimeMs: 180_000,
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ok");
  assert.deepEqual(report.reasons, []);
  assert.deepEqual(report.lag.staleTickers, []);
});

test("reports warming up when hourly table has no rows yet and source has under 60 rows", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: "2026-03-17T18:20:00.000Z",
            latest_source_row_count: 25,
            latest_target_time: null,
          },
        ] as Row[],
      }),
    },
    streamStatus: baseStreamStatus,
    streamStats: baseStreamStats,
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "warming_up");
  assert.deepEqual(report.lag.warmingUpTickers, ["ES"]);
});

test("reports unhealthy when hourly lag exceeds threshold while market is open", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: "2026-03-17T18:53:00.000Z",
            latest_source_row_count: 60,
            latest_target_time: "2026-03-17T18:46:00.000Z",
          },
        ] as Row[],
      }),
    },
    streamStatus: baseStreamStatus,
    streamStats: baseStreamStats,
    maxAllowedLagMinutes: 2,
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "unhealthy");
  assert.deepEqual(report.lag.staleTickers, ["ES"]);
  assert.match(report.reasons[0] ?? "", /candles_1h_1m is stale/i);
});

test("does not mark market-closed tickers unhealthy for lag", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: "2026-03-17T18:53:00.000Z",
            latest_source_row_count: 60,
            latest_target_time: "2026-03-17T18:46:00.000Z",
          },
        ] as Row[],
      }),
    },
    streamStatus: baseStreamStatus,
    streamStats: {
      ...baseStreamStats,
      marketOpen: false,
      marketOpenByTicker: {
        ES: false,
      },
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ok");
  assert.equal(report.lag.tickers[0]?.status, "market_closed");
});

test("reports unhealthy when market is open but stream is disconnected", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: null,
            latest_source_row_count: 0,
            latest_target_time: null,
          },
        ] as Row[],
      }),
    },
    streamStatus: {
      ...baseStreamStatus,
      connected: false,
      authenticated: false,
      streaming: false,
    },
    streamStats: baseStreamStats,
    processUptimeMs: 180_000,
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "unhealthy");
  assert.match(report.reasons[0] ?? "", /stream is not fully ready/i);
});

test("treats early stream startup as warming up instead of unhealthy", async () => {
  const report = await getWritePipelineHealth({
    queryable: {
      query: async <Row = unknown>() => ({
        rows: [
          {
            ticker: "ES",
            latest_source_time: null,
            latest_source_row_count: 0,
            latest_target_time: null,
          },
        ] as Row[],
      }),
    },
    streamStatus: {
      ...baseStreamStatus,
      connected: false,
      authenticated: false,
      streaming: false,
    },
    streamStats: baseStreamStats,
    processUptimeMs: 30_000,
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "warming_up");
  assert.equal(report.stream.startupGraceActive, true);
});
