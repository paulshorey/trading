/**
 * Database Writer for Candles
 *
 * Shared logic for writing canonical candle rows to TimescaleDB. Each target
 * table carries the same rolling metrics plus an explicit UTC sample offset:
 * `second` for `candles_1m_1s` and `minute` for `candles_1h_1m`.
 */

import type { Candles1h1mRow, Candles1m1sRow } from "@lib/db-timescale/generated/typescript/db-types.ts";

import type { CandleForDb, CandleState } from "./types.js";
import { calculateVd, calculateVdRatio } from "../metrics/index.js";
import { calculateBookImbalance } from "../metrics/book-imbalance.js";
import { calculatePricePct } from "../metrics/price.js";
import { calculateDivergence } from "../metrics/absorption.js";

type QueryValue = string | number | Date | null;
type CandleTableName = "candles_1m_1s" | "candles_1h_1m";

const CANDLES_1M_1S_COLUMNS = [
  "time",
  "ticker",
  "symbol",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "ask_volume",
  "bid_volume",
  "cvd_open",
  "cvd_high",
  "cvd_low",
  "cvd_close",
  "vd",
  "vd_ratio",
  "book_imbalance",
  "price_pct",
  "divergence",
  "trades",
  "max_trade_size",
  "big_trades",
  "big_volume",
  "sum_bid_depth",
  "sum_ask_depth",
  "sum_price_volume",
  "unknown_volume",
  "second",
] as const satisfies readonly (keyof Candles1m1sRow)[];

const CANDLES_1H_1M_COLUMNS = [
  "time",
  "ticker",
  "symbol",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "ask_volume",
  "bid_volume",
  "cvd_open",
  "cvd_high",
  "cvd_low",
  "cvd_close",
  "vd",
  "vd_ratio",
  "book_imbalance",
  "price_pct",
  "divergence",
  "trades",
  "max_trade_size",
  "big_trades",
  "big_volume",
  "sum_bid_depth",
  "sum_ask_depth",
  "sum_price_volume",
  "unknown_volume",
  "minute",
] as const satisfies readonly (keyof Candles1h1mRow)[];

const SUPPORTED_CANDLE_TABLES = new Set<CandleTableName>(["candles_1m_1s", "candles_1h_1m"]);

interface Queryable {
  query: (text: string, values: QueryValue[]) => Promise<unknown>;
}

interface CvdRowValues {
  cvd_open: number | null;
  cvd_high: number | null;
  cvd_low: number | null;
  cvd_close: number | null;
}

interface SharedRowValues extends CvdRowValues {
  symbol: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ask_volume: number;
  bid_volume: number;
  vd: number;
  vd_ratio: number | null;
  book_imbalance: number | null;
  price_pct: number | null;
  divergence: number | null;
  trades: number;
  max_trade_size: number;
  big_trades: number;
  big_volume: number;
  sum_bid_depth: number;
  sum_ask_depth: number;
  sum_price_volume: number;
  unknown_volume: number;
}

/**
 * Context for CVD calculation during batch writes
 */
export interface CvdContext {
  /** Get base CVD for a ticker */
  getBaseCvd: (ticker: string) => number;
  /** Update CVD after processing a candle */
  updateCvd?: (ticker: string, newCvd: number) => void;
}

function assertSupportedCandleTable(tableName: string): asserts tableName is CandleTableName {
  if (SUPPORTED_CANDLE_TABLES.has(tableName as CandleTableName)) {
    return;
  }

  throw new Error(`Unsupported candle table: ${tableName}`);
}

/**
 * Build placeholder string for parameterized query.
 */
function buildPlaceholder(offset: number, count: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    parts.push(`$${offset + i}`);
  }
  return `(${parts.join(", ")})`;
}

function getColumnsForTable(tableName: CandleTableName): readonly string[] {
  switch (tableName) {
    case "candles_1m_1s":
      return CANDLES_1M_1S_COLUMNS;
    case "candles_1h_1m":
      return CANDLES_1H_1M_COLUMNS;
  }
}

function getColumnValues<Row extends object>(
  row: Row,
  columns: readonly (keyof Row & string)[],
): QueryValue[] {
  return columns.map((column) => row[column] as QueryValue);
}

/**
 * Build the INSERT query for candles.
 */
function buildCandleInsertQuery(tableName: CandleTableName, placeholders: string[]): string {
  const columns = getColumnsForTable(tableName);
  const updateColumns = columns.filter((column) => column !== "time" && column !== "ticker");

  return `
    INSERT INTO ${tableName} (
      ${columns.join(", ")}
    )
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (ticker, time) DO UPDATE SET
      ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(",\n      ")}
  `;
}

/**
 * Calculate derived metrics from candle state.
 */
function calculateDerivedMetrics(candle: CandleState) {
  const vd = candle.askVolume - candle.bidVolume;
  const vdRatio = calculateVdRatio(candle.askVolume, candle.bidVolume);
  const bookImbalance = calculateBookImbalance(candle.sumBidDepth, candle.sumAskDepth);
  const pricePct = calculatePricePct(candle.open, candle.close);
  const divergence = calculateDivergence(pricePct, vdRatio);
  return { vd, vdRatio, bookImbalance, pricePct, divergence };
}

function toTimestamp(time: string): Date {
  const timestamp = new Date(time);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid candle timestamp: ${time}`);
  }
  return timestamp;
}

function buildSharedRowValues(candle: CandleState, cvdValues: CvdRowValues): SharedRowValues {
  const { vd, vdRatio, bookImbalance, pricePct, divergence } = calculateDerivedMetrics(candle);

  return {
    symbol: candle.symbol,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    ask_volume: candle.askVolume,
    bid_volume: candle.bidVolume,
    ...cvdValues,
    vd,
    vd_ratio: vdRatio,
    book_imbalance: bookImbalance,
    price_pct: pricePct,
    divergence,
    trades: candle.tradeCount,
    max_trade_size: candle.maxTradeSize,
    big_trades: candle.largeTradeCount,
    big_volume: candle.largeTradeVolume,
    sum_bid_depth: candle.sumBidDepth,
    sum_ask_depth: candle.sumAskDepth,
    sum_price_volume: candle.sumPriceVolume,
    unknown_volume: candle.unknownSideVolume,
  };
}

function buildCandles1m1sRow(time: string, ticker: string, candle: CandleState, cvdValues: CvdRowValues): Candles1m1sRow {
  const timestamp = toTimestamp(time);

  return {
    time: timestamp,
    ticker,
    ...buildSharedRowValues(candle, cvdValues),
    second: timestamp.getUTCSeconds(),
  };
}

function buildCandles1h1mRow(time: string, ticker: string, candle: CandleState, cvdValues: CvdRowValues): Candles1h1mRow {
  const timestamp = toTimestamp(time);

  return {
    time: timestamp,
    ticker,
    ...buildSharedRowValues(candle, cvdValues),
    minute: timestamp.getUTCMinutes(),
  };
}

function buildRowForTable(
  tableName: CandleTableName,
  time: string,
  ticker: string,
  candle: CandleState,
  cvdValues: CvdRowValues,
): Candles1m1sRow | Candles1h1mRow {
  switch (tableName) {
    case "candles_1m_1s":
      return buildCandles1m1sRow(time, ticker, candle, cvdValues);
    case "candles_1h_1m":
      return buildCandles1h1mRow(time, ticker, candle, cvdValues);
  }
}

function buildRowValuesForTable(tableName: CandleTableName, row: Candles1m1sRow | Candles1h1mRow): QueryValue[] {
  switch (tableName) {
    case "candles_1m_1s":
      return getColumnValues(row as Candles1m1sRow, CANDLES_1M_1S_COLUMNS);
    case "candles_1h_1m":
      return getColumnValues(row as Candles1h1mRow, CANDLES_1H_1M_COLUMNS);
  }
}

/**
 * Build INSERT parameters for a batch of candles.
 */
function buildCandleInsertParams(
  tableName: CandleTableName,
  candles: CandleForDb[],
  cvdContext: CvdContext,
): {
  values: QueryValue[];
  placeholders: string[];
} {
  const values: QueryValue[] = [];
  const placeholders: string[] = [];
  const columnsPerRow = getColumnsForTable(tableName).length;

  candles.forEach(({ ticker, time, candle }, i) => {
    const metrics = candle.metricsOHLC;
    const offset = i * columnsPerRow;

    placeholders.push(buildPlaceholder(offset, columnsPerRow));

    if (!metrics) {
      const baseCvd = cvdContext.getBaseCvd(ticker);
      const vd = calculateVd(candle.askVolume, candle.bidVolume);
      const cvd = baseCvd + vd;
      cvdContext.updateCvd?.(ticker, cvd);

      const row = buildRowForTable(tableName, time, ticker, candle, {
        cvd_open: cvd,
        cvd_high: cvd,
        cvd_low: cvd,
        cvd_close: cvd,
      });
      values.push(...buildRowValuesForTable(tableName, row));
      return;
    }

    cvdContext.updateCvd?.(ticker, metrics.cvd.close);
    const row = buildRowForTable(tableName, time, ticker, candle, {
      cvd_open: metrics.cvd.open,
      cvd_high: metrics.cvd.high,
      cvd_low: metrics.cvd.low,
      cvd_close: metrics.cvd.close,
    });
    values.push(...buildRowValuesForTable(tableName, row));
  });

  return { values, placeholders };
}

/**
 * Sort and write candles with a single UPSERT query.
 */
export async function writeCandles(queryable: Queryable, tableName: string, candles: CandleForDb[]): Promise<void> {
  if (candles.length === 0) {
    return;
  }

  assertSupportedCandleTable(tableName);

  const sorted = [...candles].sort((a, b) => {
    if (a.ticker !== b.ticker) {
      return a.ticker.localeCompare(b.ticker);
    }
    return a.time.localeCompare(b.time);
  });

  const cvdContext: CvdContext = {
    getBaseCvd: () => 0,
    updateCvd: () => {},
  };

  const { values, placeholders } = buildCandleInsertParams(tableName, sorted, cvdContext);
  const query = buildCandleInsertQuery(tableName, placeholders);
  await queryable.query(query, values);
}
