import { getDb } from '@/lib/db'

interface Timeframe {
  id: string
  table: string
  ms: number
}

/**
 * Timeframe configurations
 * Note: "candles-1m" uses dash, others use underscore
 */
export const TIMEFRAMES: Timeframe[] = [
  { id: '1m', table: 'candles-1m', ms: 60 * 1000 },
  { id: '3m', table: 'candles_3m', ms: 3 * 60 * 1000 },
  { id: '7m', table: 'candles_7m', ms: 7 * 60 * 1000 },
  { id: '19m', table: 'candles_19m', ms: 19 * 60 * 1000 },
  { id: '29m', table: 'candles_29m', ms: 29 * 60 * 1000 },
  { id: '59m', table: 'candles_59m', ms: 59 * 60 * 1000 },
  { id: '109m', table: 'candles_109m', ms: 109 * 60 * 1000 },
  { id: '181m', table: 'candles_181m', ms: 181 * 60 * 1000 },
  { id: '1d', table: 'candles_1d', ms: 24 * 60 * 60 * 1000 },
  { id: '1w', table: 'candles_1w', ms: 7 * 24 * 60 * 60 * 1000 },
]

// Target number of candles to return (aim for good chart density)
export const TARGET_CANDLES = 1000

export interface GetCandlesOptions {
  limit?: number
  timeframe?: string
}

/**
 * Select the best timeframe based on requested date range
 * Returns the smallest timeframe that keeps results under target
 */
export function selectTimeframe(startMs: number, endMs: number): Timeframe {
  const rangeMs = endMs - startMs

  // Find the smallest timeframe that would result in <= TARGET_CANDLES
  // Iterate from smallest to largest timeframe
  for (const tf of TIMEFRAMES) {
    const estimatedCandles = rangeMs / tf.ms
    if (estimatedCandles <= TARGET_CANDLES) {
      return tf
    }
  }

  // Default to largest timeframe for very long ranges
  const fallback = TIMEFRAMES[TIMEFRAMES.length - 1]
  if (!fallback) {
    throw new Error('No timeframes configured')
  }
  return fallback
}

function resolveTimeframe(
  startMs: number,
  endMs: number,
  timeframeId?: string
): Timeframe {
  if (timeframeId) {
    const selected = TIMEFRAMES.find((tf) => tf.id === timeframeId)
    if (!selected) {
      throw new Error(`Unsupported timeframe: ${timeframeId}`)
    }
    return selected
  }
  return selectTimeframe(startMs, endMs)
}

/**
 * Candle data with all metrics as named properties
 */
export interface Candle {
  // Timestamp
  time: number
  // Price OHLC
  open: number
  high: number
  low: number
  close: number
  volume: number
  // CVD OHLC
  cvd_open: number
  cvd_high: number
  cvd_low: number
  cvd_close: number
  // EVR OHLC
  evr_open: number
  evr_high: number
  evr_low: number
  evr_close: number
  // VWAP OHLC
  vwap_open: number
  vwap_high: number
  vwap_low: number
  vwap_close: number
  // Spread BPS OHLC
  spread_bps_open: number
  spread_bps_high: number
  spread_bps_low: number
  spread_bps_close: number
  // Price PCT OHLC
  price_pct_open: number
  price_pct_high: number
  price_pct_low: number
  price_pct_close: number
  // Line metrics
  book_imbalance_close: number
  big_trades: number
  big_volume: number
  vd_strength: number
}

export interface CandlesResult {
  timeframe: string
  table: string
  count: number
  data: Candle[]
}

/**
 * Get the max time available in a table for a ticker
 */
async function getMaxTimeInTable(
  table: string,
  ticker: string
): Promise<number | null> {
  const db = getDb()
  const result = await db.query(
    `SELECT MAX(time) as max_time FROM "${table}" WHERE ticker = $1`,
    [ticker]
  )
  if (!result.rows[0]?.max_time) {
    return null
  }
  return new Date(result.rows[0].max_time).getTime()
}

/**
 * Query candles from the appropriate table.
 * Falls back to smaller timeframes if the selected one doesn't have recent data.
 */
export async function getCandles(
  startMs: number,
  endMs: number,
  ticker: string,
  options: GetCandlesOptions = {}
): Promise<CandlesResult> {
  const initialTimeframe = resolveTimeframe(startMs, endMs, options.timeframe)
  const initialIndex = TIMEFRAMES.findIndex(
    (tf) => tf.id === initialTimeframe.id
  )

  // Try the selected timeframe, then fall back to smaller ones if needed
  // We check if the table has data close to the requested end time
  // "Close" means within 2x the timeframe's duration (e.g., 2 weeks for weekly)
  let timeframe = initialTimeframe

  for (let i = initialIndex; i >= 0; i--) {
    const tf = TIMEFRAMES[i]
    if (!tf) continue
    const maxTime = await getMaxTimeInTable(tf.table, ticker)

    if (maxTime !== null) {
      // Check if this table has recent enough data
      // Allow a gap of up to 2x the timeframe duration from the requested end
      const maxAllowedGap = tf.ms * 2
      if (endMs - maxTime <= maxAllowedGap) {
        timeframe = tf
        break
      }
      // If this is the smallest timeframe (1m), use it regardless of gap
      // because it's our most granular data source
      if (i === 0) {
        timeframe = tf
        break
      }
    }
    // Try smaller timeframe
    if (i > 0) {
      const smaller = TIMEFRAMES[i - 1]
      if (smaller) {
        timeframe = smaller
      }
    }
  }

  const db = getDb()

  // Convert ms timestamps to ISO for database query
  const startISO = new Date(startMs).toISOString()
  const endISO = new Date(endMs).toISOString()

  const normalizedLimit =
    typeof options.limit === 'number' && options.limit > 0
      ? Math.floor(options.limit)
      : undefined

  // Build query - table name uses double quotes due to dash in "candles-1m"
  const whereParts: string[] = ['ticker = $1', 'time >= $2', 'time <= $3']
  const params: Array<string | number> = [ticker, startISO, endISO]

  // Select all metrics columns
  const columns = `
    time, open, high, low, close, volume,
    cvd_open, cvd_high, cvd_low, cvd_close,
    evr_open, evr_high, evr_low, evr_close,
    vwap_open, vwap_high, vwap_low, vwap_close,
    spread_bps_open, spread_bps_high, spread_bps_low, spread_bps_close,
    price_pct_open, price_pct_high, price_pct_low, price_pct_close,
    book_imbalance_close, big_trades, big_volume, vd_strength
  `

  let query = `
    SELECT ${columns}
    FROM "${timeframe.table}"
    WHERE ${whereParts.join(' AND ')}
  `

  if (normalizedLimit) {
    params.push(normalizedLimit)
    const limitParam = `$${params.length}`
    query = `
      SELECT ${columns}
      FROM (
        ${query}
        ORDER BY time DESC
        LIMIT ${limitParam}
      ) AS limited
      ORDER BY time ASC
    `
  } else {
    query = `
      ${query}
      ORDER BY time ASC
    `
  }

  const result = await db.query(query, params)

  // Convert to object format with all metrics
  const candles: Candle[] = result.rows.map((row) => ({
    time: new Date(row.time).getTime(),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
    cvd_open: parseFloat(row.cvd_open ?? 0),
    cvd_high: parseFloat(row.cvd_high ?? 0),
    cvd_low: parseFloat(row.cvd_low ?? 0),
    cvd_close: parseFloat(row.cvd_close ?? 0),
    evr_open: parseFloat(row.evr_open ?? 0),
    evr_high: parseFloat(row.evr_high ?? 0),
    evr_low: parseFloat(row.evr_low ?? 0),
    evr_close: parseFloat(row.evr_close ?? 0),
    vwap_open: parseFloat(row.vwap_open ?? 0),
    vwap_high: parseFloat(row.vwap_high ?? 0),
    vwap_low: parseFloat(row.vwap_low ?? 0),
    vwap_close: parseFloat(row.vwap_close ?? 0),
    spread_bps_open: parseFloat(row.spread_bps_open ?? 0),
    spread_bps_high: parseFloat(row.spread_bps_high ?? 0),
    spread_bps_low: parseFloat(row.spread_bps_low ?? 0),
    spread_bps_close: parseFloat(row.spread_bps_close ?? 0),
    price_pct_open: parseFloat(row.price_pct_open ?? 0),
    price_pct_high: parseFloat(row.price_pct_high ?? 0),
    price_pct_low: parseFloat(row.price_pct_low ?? 0),
    price_pct_close: parseFloat(row.price_pct_close ?? 0),
    book_imbalance_close: parseFloat(row.book_imbalance_close ?? 0),
    big_trades: parseFloat(row.big_trades ?? 0),
    big_volume: parseFloat(row.big_volume ?? 0),
    vd_strength: parseFloat(row.vd_strength ?? 0),
  }))

  return {
    timeframe: timeframe.id,
    table: timeframe.table,
    count: candles.length,
    data: candles,
  }
}

export interface DateRange {
  start: number
  end: number
}

/**
 * Get the date range available for a ticker
 * Queries the 1-minute table as it has the most recent data
 */
export async function getDateRange(ticker: string): Promise<DateRange | null> {
  const db = getDb()

  // Query the 1m table for range (most granular, has latest data)
  const result = await db.query(
    `
    SELECT MIN(time) as min_time, MAX(time) as max_time
    FROM "candles-1m"
    WHERE ticker = $1
  `,
    [ticker]
  )

  if (!result.rows[0]?.min_time) {
    return null
  }

  return {
    start: new Date(result.rows[0].min_time).getTime(),
    end: new Date(result.rows[0].max_time).getTime(),
  }
}
