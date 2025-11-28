/**
 * Data Aggregation Utilities
 *
 * Functions for processing raw strength/price data into chart-ready format.
 * Includes interpolation, normalization, and forward-fill logic.
 */

import { StrengthRowGet } from '@lib/common/sql/strength'
import { LineData, Time } from 'lightweight-charts'

// ============================================================================
// TIMESTAMP UTILITIES
// ============================================================================

/**
 * Generate future timestamps at 2-minute intervals
 * Used to extend chart data into the future with flat line
 */
export function generateFutureTimestamps(
  lastTimestamp: number,
  hours: number = 12
): number[] {
  const futureTimestamps: number[] = []
  const intervalSeconds = 2 * 60
  const totalIntervals = (hours * 60) / 2

  for (let i = 1; i <= totalIntervals; i++) {
    futureTimestamps.push(lastTimestamp + i * intervalSeconds)
  }

  return futureTimestamps
}

/**
 * Extract all unique timestamps from multiple data arrays
 * Validates timestamps are at even minutes with no seconds
 */
export function extractGlobalTimestamps<T extends { timenow: Date }>(
  allData: (T[] | null)[]
): number[] {
  const globalTimestamps = new Set<number>()
  const invalidTimestamps: string[] = []

  allData.forEach((data) => {
    if (data && data.length > 0) {
      data.forEach((item) => {
        const date = new Date(item.timenow)
        const timestamp = date.getTime() / 1000

        // Validate timestamp
        const minutes = date.getMinutes()
        const seconds = date.getSeconds()
        if (minutes % 2 !== 0 || seconds !== 0) {
          invalidTimestamps.push(date.toISOString())
        }

        globalTimestamps.add(timestamp)
      })
    }
  })

  if (invalidTimestamps.length > 0) {
    console.warn('[extractGlobalTimestamps] Found invalid timestamps:', {
      count: invalidTimestamps.length,
      samples: invalidTimestamps.slice(0, 5),
    })
  }

  return Array.from(globalTimestamps).sort((a, b) => a - b)
}

// ============================================================================
// FORWARD-FILL INTERPOLATION
// ============================================================================

/**
 * Forward-fill missing values in data
 * Uses the most recent valid value to fill gaps
 */
export function forwardFillData<
  T extends { timestamp: number; value?: number },
>(data: T[], sortedTimestamps: number[]): Map<number, number> {
  const filledData = new Map<number, number>()

  // First pass: collect valid values by timestamp
  const validDataByTimestamp = new Map<number, number>()
  data.forEach((item) => {
    if (
      item.value !== null &&
      item.value !== undefined &&
      item.value !== 0 &&
      Number.isFinite(item.value)
    ) {
      validDataByTimestamp.set(item.timestamp, item.value)
    }
  })

  // Second pass: fill all timestamps
  let previousValue: number | null = null

  for (let i = 0; i < sortedTimestamps.length; i++) {
    const timestamp = sortedTimestamps[i]!
    const existingValue = validDataByTimestamp.get(timestamp)

    if (existingValue !== undefined) {
      filledData.set(timestamp, existingValue)
      previousValue = existingValue
    } else {
      let filledValue: number | null = null

      // Look backward first
      if (previousValue !== null) {
        filledValue = previousValue
      } else {
        // No previous value, look forward
        for (let j = i + 1; j < sortedTimestamps.length; j++) {
          const futureValue = validDataByTimestamp.get(sortedTimestamps[j]!)
          if (futureValue !== undefined) {
            filledValue = futureValue
            break
          }
        }
      }

      if (filledValue !== null) {
        filledData.set(timestamp, filledValue)
      }
    }
  }

  return filledData
}

// ============================================================================
// STRENGTH DATA AGGREGATION
// ============================================================================

/**
 * Aggregate strength data from multiple tickers
 * Averages values across selected intervals and tickers
 */
export function aggregateStrengthData(
  allRawData: (StrengthRowGet[] | null)[],
  intervals: string[],
  allMarketData?: (StrengthRowGet[] | null)[]
): LineData[] {
  const dataForTimestamps = allMarketData || allRawData
  const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)

  if (sortedTimestamps.length === 0) {
    return []
  }

  // Helper to extract strength value from an item
  const getStrengthValue = (
    item: StrengthRowGet,
    intervals: string[]
  ): number | null => {
    let sum = 0
    let count = 0

    for (const interval of intervals) {
      const value = item[interval as keyof StrengthRowGet]

      if (value !== null && value !== undefined) {
        const numericValue =
          typeof value === 'string' ? parseFloat(value) : Number(value)

        if (Number.isFinite(numericValue)) {
          sum += numericValue
          count++
        }
      }
    }

    return count > 0 ? sum / count : null
  }

  // Aggregate with interpolation
  const aggregatedMap = new Map<number, { sum: number; count: number }>()

  allRawData.forEach((tickerData) => {
    if (!tickerData || tickerData.length === 0) return

    const tickerValues = tickerData
      .map((item) => {
        const value = getStrengthValue(item, intervals)
        if (value === null || value === 0) {
          const hasAnyData = intervals.some(
            (interval) =>
              item[interval as keyof typeof item] !== null &&
              item[interval as keyof typeof item] !== undefined
          )
          if (!hasAnyData) return null
        }
        return {
          timestamp: new Date(item.timenow).getTime() / 1000,
          value,
        }
      })
      .filter((item) => item !== null && item.value !== null) as Array<{
      timestamp: number
      value: number
    }>

    const filledData = forwardFillData(tickerValues, sortedTimestamps)

    filledData.forEach((value, timestamp) => {
      if (!aggregatedMap.has(timestamp)) {
        aggregatedMap.set(timestamp, { sum: 0, count: 0 })
      }
      const existing = aggregatedMap.get(timestamp)!
      existing.sum += value
      existing.count++
    })
  })

  // Convert to LineData
  const lineData: LineData[] = []
  aggregatedMap.forEach((value, timestamp) => {
    if (value.count > 0) {
      lineData.push({
        time: timestamp as Time,
        value: value.sum / value.count,
      })
    }
  })

  lineData.sort((a, b) => (a.time as number) - (b.time as number))

  // Extend into future
  if (lineData.length > 0) {
    const lastPoint = lineData[lineData.length - 1]!
    const futureTimestamps = generateFutureTimestamps(lastPoint.time as number, 12)

    futureTimestamps.forEach((timestamp) => {
      lineData.push({
        time: timestamp as Time,
        value: lastPoint.value,
      })
    })
  }

  return lineData
}

// ============================================================================
// PRICE DATA AGGREGATION
// ============================================================================

/**
 * Normalize price data across multiple tickers
 * Each ticker is normalized to contribute equally regardless of absolute price
 */
function normalizeMultipleTickerData(
  tickersData: Array<{
    filledPrices: Map<number, number>
    lastValidPrice: number
    hasAnyData: boolean
  }>,
  sortedTimestamps: number[]
): { time: number; value: number }[] {
  const tickersWithData = tickersData.filter((t) => t.hasAnyData)

  if (tickersWithData.length === 0) {
    return []
  }

  const normalizationFactors = tickersWithData.map((ticker) => {
    if (ticker.lastValidPrice === 0) return 0
    return 1 / ticker.lastValidPrice
  })

  const result: { time: number; value: number }[] = []

  sortedTimestamps.forEach((timestamp) => {
    let normalizedSum = 0
    let validCount = 0

    tickersWithData.forEach((ticker, idx) => {
      const price = ticker.filledPrices.get(timestamp)
      if (price !== undefined && Number.isFinite(price)) {
        normalizedSum += price * normalizationFactors[idx]!
        validCount++
      }
    })

    if (validCount > 0) {
      const averageNormalized = normalizedSum / validCount
      const avgLastPrice =
        tickersWithData.reduce((sum, t) => sum + t.lastValidPrice, 0) /
        tickersWithData.length

      result.push({
        time: timestamp,
        value: averageNormalized * avgLastPrice,
      })
    }
  })

  return result
}

/**
 * Aggregate price data from multiple tickers with normalization
 */
export function aggregatePriceData(
  allRawData: (StrengthRowGet[] | null)[],
  allMarketData?: (StrengthRowGet[] | null)[]
): LineData[] {
  const dataForTimestamps = allMarketData || allRawData
  const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)

  if (sortedTimestamps.length === 0) {
    return []
  }

  // Process each ticker
  const processedTickers: {
    filledPrices: Map<number, number>
    lastValidPrice: number
    hasAnyData: boolean
  }[] = []

  allRawData.forEach((tickerData) => {
    const filledPrices = new Map<number, number>()

    if (!tickerData || tickerData.length === 0) {
      processedTickers.push({ filledPrices, lastValidPrice: 0, hasAnyData: false })
      return
    }

    const tickerPrices = tickerData
      .map((item) => ({
        timestamp: new Date(item.timenow).getTime() / 1000,
        value:
          item.price !== null &&
          item.price !== undefined &&
          item.price !== 0 &&
          Number.isFinite(item.price)
            ? item.price
            : undefined,
      }))
      .filter((item) => item.value !== undefined) as Array<{
      timestamp: number
      value: number
    }>

    if (tickerPrices.length > 0) {
      const lastKnownPrice = tickerPrices[tickerPrices.length - 1]!.value
      const interpolatedPrices = forwardFillData(tickerPrices, sortedTimestamps)
      const lastFilledPrice = interpolatedPrices.get(
        sortedTimestamps[sortedTimestamps.length - 1]!
      )

      processedTickers.push({
        filledPrices: interpolatedPrices,
        lastValidPrice: lastFilledPrice || lastKnownPrice,
        hasAnyData: true,
      })
    } else {
      processedTickers.push({ filledPrices, lastValidPrice: 0, hasAnyData: false })
    }
  })

  // Normalize and aggregate
  const normalizedResult = normalizeMultipleTickerData(
    processedTickers,
    sortedTimestamps
  )

  const lineData = normalizedResult.map((point) => ({
    time: point.time as Time,
    value: point.value,
  }))

  // Extend into future
  if (lineData.length > 0) {
    const lastPoint = lineData[lineData.length - 1]!
    const futureTimestamps = generateFutureTimestamps(lastPoint.time as number, 12)

    futureTimestamps.forEach((timestamp) => {
      lineData.push({
        time: timestamp as Time,
        value: lastPoint.value,
      })
    })
  }

  return lineData
}


