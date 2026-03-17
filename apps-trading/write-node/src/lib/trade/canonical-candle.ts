import type { Candles1h1mRow, Candles1m1sRow } from "@lib/db-timescale/generated/typescript/db-types";

import type { CandleForDb, CandleState } from "./types.js";

type StoredCandleCommonColumn =
  | "time"
  | "ticker"
  | "symbol"
  | "open"
  | "high"
  | "low"
  | "close"
  | "volume"
  | "ask_volume"
  | "bid_volume"
  | "cvd_open"
  | "cvd_high"
  | "cvd_low"
  | "cvd_close"
  | "trades"
  | "max_trade_size"
  | "big_trades"
  | "big_volume"
  | "vd"
  | "vd_ratio"
  | "book_imbalance"
  | "price_pct"
  | "divergence"
  | "sum_bid_depth"
  | "sum_ask_depth"
  | "sum_price_volume"
  | "unknown_volume";

type Stored1mCandleRow = Pick<Candles1m1sRow, StoredCandleCommonColumn>;
type Stored1hCandleRow = Pick<Candles1h1mRow, StoredCandleCommonColumn>;

export type StoredCandleRow = Stored1mCandleRow | Stored1hCandleRow;

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value) || 0;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface StoredRowConversionOptions {
  requireCompleteCvd?: boolean;
}

function assertCompleteCvd(row: StoredCandleRow): void {
  if (row.cvd_open !== null && row.cvd_high !== null && row.cvd_low !== null && row.cvd_close !== null) {
    return;
  }

  throw new Error(
    `Stored candle row for ${row.ticker} at ${toIsoString(row.time)} is missing complete CVD OHLC ` +
      `and cannot be used as canonical hourly source data`,
  );
}

export function candleStateFromStoredRow(row: StoredCandleRow, options: StoredRowConversionOptions = {}): CandleState {
  if (options.requireCompleteCvd) {
    assertCompleteCvd(row);
  }

  const cvdOpen = row.cvd_open === null ? null : toNumber(row.cvd_open);
  const cvdHigh = row.cvd_high === null ? null : toNumber(row.cvd_high);
  const cvdLow = row.cvd_low === null ? null : toNumber(row.cvd_low);
  const cvdClose = row.cvd_close === null ? null : toNumber(row.cvd_close);

  return {
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    askVolume: toNumber(row.ask_volume),
    bidVolume: toNumber(row.bid_volume),
    unknownSideVolume: toNumber(row.unknown_volume),
    sumBidDepth: toNumber(row.sum_bid_depth),
    sumAskDepth: toNumber(row.sum_ask_depth),
    sumSpread: 0,
    sumMidPrice: 0,
    sumPriceVolume: toNumber(row.sum_price_volume),
    maxTradeSize: toNumber(row.max_trade_size),
    largeTradeCount: toNumber(row.big_trades),
    largeTradeVolume: toNumber(row.big_volume),
    symbol: row.symbol ?? row.ticker,
    tradeCount: toNumber(row.trades),
    currentCvd: cvdClose ?? undefined,
    metricsOHLC:
      cvdOpen !== null && cvdHigh !== null && cvdLow !== null && cvdClose !== null
        ? {
            cvd: {
              open: cvdOpen,
              high: cvdHigh,
              low: cvdLow,
              close: cvdClose,
            },
          }
        : undefined,
  };
}

export function candleForDbFromStoredRow(row: StoredCandleRow, options: StoredRowConversionOptions = {}): CandleForDb {
  const time = toIsoString(row.time);

  return {
    key: `${row.ticker}|${time}`,
    ticker: row.ticker,
    time,
    candle: candleStateFromStoredRow(row, options),
  };
}
