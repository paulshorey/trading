/**
 * Trade Processing Library
 *
 * Shared utilities for processing TBBO trade data into candles with order flow metrics.
 * Used by both live streaming (tbbo-1m-aggregator) and historical ingest (tbbo-1m-1s).
 */

// Types
export type {
  TbboRecord,
  CandleState,
  CandleForDb,
  AggregatorStats,
  NormalizedTrade,
  MetricCalculationContext,
} from "./types.js";

// Side detection (Lee-Ready algorithm)
export { inferSideFromPrice, determineTradeSide } from "./side-detection.js";

// Large trade thresholds
export { LARGE_TRADE_THRESHOLDS, getLargeTradeThreshold } from "./thresholds.js";

// Timestamp utilities
export {
  MAX_TRADE_AGE_MS,
  nsToMs,
  getMinuteBucket,
  getSecondBucket,
  toMinuteBucket,
  toSecondBucket,
  checkTradeAge,
} from "./timestamp.js";

// Symbol utilities
export { extractTicker } from "./symbol.js";

// Front-month contract tracker
export { FrontMonthTracker } from "./front-month.js";

// Candle aggregation
export {
  createCandleFromTrade,
  updateCandleWithTrade,
  updateCandleCvdOHLC,
} from "./candle-aggregation.js";

// Database writer utilities
export { writeCandles } from "./db-writer.js";

// Shared rolling-window engine
export type { RollingTickerSnapshot, RollingWindowStats, TimedTradeInput } from "./rolling-window.js";
export { RollingWindow1m } from "./rolling-window.js";
