import assert from "node:assert/strict";
import test from "node:test";

import type { CandleForDb } from "./types.js";
import { writeCandles } from "./db-writer.js";

function makeCandleForDb(time: string): CandleForDb {
  return {
    key: `ES|${time}`,
    ticker: "ES",
    time,
    candle: {
      open: 6000,
      high: 6002,
      low: 5999,
      close: 6001,
      volume: 10,
      askVolume: 6,
      bidVolume: 4,
      unknownSideVolume: 0,
      sumBidDepth: 10,
      sumAskDepth: 12,
      sumSpread: 0,
      sumMidPrice: 0,
      sumPriceVolume: 60010,
      maxTradeSize: 3,
      largeTradeCount: 1,
      largeTradeVolume: 3,
      symbol: "ESH6",
      tradeCount: 10,
      currentCvd: 102,
      metricsOHLC: {
        cvd: {
          open: 100,
          high: 105,
          low: 99,
          close: 102,
        },
      },
    },
  };
}

test("writes explicit UTC second for candles_1m_1s", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] };

  await writeCandles(
    {
      query: async (text, values) => {
        captured.text = text;
        captured.values = values;
      },
    },
    "candles_1m_1s",
    [makeCandleForDb("2026-03-10T14:59:59.000Z")],
  );

  assert.match(captured.text, /\bsecond\b/);
  assert.match(captured.text, /second = EXCLUDED\.second/);
  assert.equal(captured.values.at(-1), 59);
});

test("writes explicit UTC minute for candles_1h_1m", async () => {
  const captured: { text: string; values: unknown[] } = { text: "", values: [] };

  await writeCandles(
    {
      query: async (text, values) => {
        captured.text = text;
        captured.values = values;
      },
    },
    "candles_1h_1m",
    [makeCandleForDb("2026-03-10T14:59:00.000Z")],
  );

  assert.match(captured.text, /\bminute\b/);
  assert.match(captured.text, /minute = EXCLUDED\.minute/);
  assert.equal(captured.values.at(-1), 59);
});
