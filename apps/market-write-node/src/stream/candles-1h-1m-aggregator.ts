import { pool } from "../lib/db.js";
import type { CandleForDb, StoredCandleRow } from "../lib/trade/index.js";
import { RollingCandleWindow, candleForDbFromStoredRow, isMinuteBoundary, writeCandles } from "../lib/trade/index.js";

const SOURCE_TABLE = "candles_1m_1s";
const TARGET_TABLE = "candles_1h_1m";
const HYDRATION_WINDOW_ROWS = 60;
const WINDOW_MINUTES = 60;
const WRITE_BATCH_SIZE = 500;

const HYDRATION_QUERY = `
  WITH ranked AS (
    SELECT
      time,
      ticker,
      symbol,
      open,
      high,
      low,
      close,
      volume,
      ask_volume,
      bid_volume,
      cvd_open,
      cvd_high,
      cvd_low,
      cvd_close,
      trades,
      max_trade_size,
      big_trades,
      big_volume,
      vd,
      vd_ratio,
      book_imbalance,
      price_pct,
      divergence,
      sum_bid_depth,
      sum_ask_depth,
      sum_price_volume,
      unknown_volume,
      ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY time DESC) AS rn
    FROM ${SOURCE_TABLE}
    WHERE time = date_trunc('minute', time)
  )
  SELECT
    time,
    ticker,
    symbol,
    open,
    high,
    low,
    close,
    volume,
    ask_volume,
    bid_volume,
    cvd_open,
    cvd_high,
    cvd_low,
    cvd_close,
    trades,
    max_trade_size,
    big_trades,
    big_volume,
    vd,
    vd_ratio,
    book_imbalance,
    price_pct,
    divergence,
    sum_bid_depth,
    sum_ask_depth,
    sum_price_volume,
    unknown_volume
  FROM ranked
  WHERE rn <= $1
  ORDER BY ticker ASC, time ASC
`;

export class Candles1h1mAggregator {
  private readonly rollingWindow = new RollingCandleWindow({
    windowSize: WINDOW_MINUTES,
    expectedIntervalMs: 60_000,
    label: "1h@1m",
  });

  private initialized = false;
  private candlesWritten = 0;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const result = await pool.query<StoredCandleRow>(HYDRATION_QUERY, [HYDRATION_WINDOW_ROWS]);
      const seedCandles = result.rows.map(candleForDbFromStoredRow);
      this.rollingWindow.seedCandles(seedCandles);

      if (seedCandles.length > 0) {
        console.log(`📚 Hydrated ${seedCandles.length} canonical 1m row(s) into ${TARGET_TABLE}`);
      } else {
        console.log(`📚 No canonical 1m rows available yet to hydrate ${TARGET_TABLE}`);
      }
    } catch (error) {
      console.warn(`⚠️ Could not hydrate ${TARGET_TABLE} from ${SOURCE_TABLE}:`, error);
    }

    this.initialized = true;
  }

  addBaseCandles(candles: CandleForDb[]): number {
    const minuteBoundaryCandles = candles.filter((candle) => isMinuteBoundary(candle.time));
    if (minuteBoundaryCandles.length === 0) {
      return 0;
    }

    return this.rollingWindow.addCandles(minuteBoundaryCandles);
  }

  async flushCompleted(): Promise<void> {
    const pendingCandles = this.rollingWindow.drainPendingCandles();
    if (pendingCandles.length === 0) {
      return;
    }

    let written = 0;
    let dropped = 0;

    for (let i = 0; i < pendingCandles.length; i += WRITE_BATCH_SIZE) {
      const batch = pendingCandles.slice(i, i + WRITE_BATCH_SIZE);

      try {
        await writeCandles(pool, TARGET_TABLE, batch);
        written += batch.length;
        this.candlesWritten += batch.length;
      } catch (error) {
        dropped += batch.length;
        console.error(`❌ Failed to write ${TARGET_TABLE} candles:`, error);
      }
    }

    if (written > 0) {
      console.log(`✅ Flushed ${written} rolling 1h candle(s) to ${TARGET_TABLE}`);
    }
    if (dropped > 0) {
      console.warn(`⚠️ Dropped ${dropped} rolling 1h candle(s) due to DB write failures`);
    }
  }

  async flushAll(): Promise<void> {
    await this.flushCompleted();
  }

  getCandlesWritten(): number {
    return this.candlesWritten;
  }
}
