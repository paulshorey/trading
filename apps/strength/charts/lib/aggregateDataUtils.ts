/**
 * Data processing utilities for charts
 */

/**
 * Forward-fill missing values in price data
 * Uses aggressive interpolation to fill all timestamps with the most recent valid value
 */
export function forwardFillData<T extends { timestamp: number; value?: number }>(
  data: T[],
  sortedTimestamps: number[]
): Map<number, number> {
  const filledData = new Map<number, number>()

  // First pass: collect all valid values by timestamp
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

  // Second pass: aggressively fill ALL timestamps
  let previousValue: number | null = null

  for (let i = 0; i < sortedTimestamps.length; i++) {
    const timestamp = sortedTimestamps[i]!
    const existingValue = validDataByTimestamp.get(timestamp)

    if (existingValue !== undefined) {
      // We have a valid value at this timestamp
      filledData.set(timestamp, existingValue)
      previousValue = existingValue
    } else {
      // Missing value - need to fill
      let filledValue: number | null = null

      // Look backward for the most recent valid value
      if (previousValue !== null) {
        filledValue = previousValue
      } else {
        // No previous value yet, look forward
        for (let j = i + 1; j < sortedTimestamps.length; j++) {
          const futureValue = validDataByTimestamp.get(sortedTimestamps[j]!)
          if (futureValue !== undefined) {
            filledValue = futureValue
            break
          }
        }
      }

      // If we found a value to use, set it
      if (filledValue !== null) {
        filledData.set(timestamp, filledValue)
        // Don't update previousValue here as it's not a "real" value
      }
    }
  }

  return filledData
}

/**
 * Extract all unique timestamps from multiple data arrays
 */
export function extractGlobalTimestamps<T extends { timenow: Date }>(
  allData: (T[] | null)[]
): number[] {
  const globalTimestamps = new Set<number>()

  allData.forEach((data) => {
    if (data && data.length > 0) {
      data.forEach((item) => {
        const timestamp = new Date(item.timenow).getTime() / 1000
        globalTimestamps.add(timestamp)
      })
    }
  })

  return Array.from(globalTimestamps).sort((a, b) => a - b)
}

/**
 * Normalize price data across multiple tickers
 * Each ticker's prices are normalized relative to its last valid price
 * This allows tickers with different price levels to be compared equally
 */
export function normalizeMultipleTickerData(
  tickersData: Array<{
    filledPrices: Map<number, number>
    lastValidPrice: number
    hasAnyData: boolean
  }>,
  sortedTimestamps: number[]
): { time: number; value: number }[] {
  // Filter to only tickers with data
  const tickersWithData = tickersData.filter((t) => t.hasAnyData)

  if (tickersWithData.length === 0) {
    return []
  }

  // Calculate normalization factors based on last valid prices
  // Each ticker's prices will be normalized relative to its last price
  // This makes each ticker contribute equally regardless of absolute price level
  const normalizationFactors = tickersWithData.map((ticker) => {
    // Avoid division by zero
    if (ticker.lastValidPrice === 0) return 0
    // Normalize so that each ticker's last price becomes 1.0
    return 1 / ticker.lastValidPrice
  })

  // Create normalized and averaged result
  const result: { time: number; value: number }[] = []

  sortedTimestamps.forEach((timestamp) => {
    let normalizedSum = 0
    let validCount = 0

    tickersWithData.forEach((ticker, idx) => {
      const price = ticker.filledPrices.get(timestamp)
      if (price !== undefined && Number.isFinite(price)) {
        // Normalize the price relative to its last value
        const normalizedPrice = price * normalizationFactors[idx]!
        normalizedSum += normalizedPrice
        validCount++
      }
    })

    // Calculate average of normalized values
    // Each normalized ticker now has its last price = 1.0
    // So the average represents the relative movement of all tickers
    if (validCount > 0) {
      const averageNormalized = normalizedSum / validCount

      // Scale back to a meaningful price range
      // We use the average of all last prices as the reference point
      const avgLastPrice =
        tickersWithData.reduce((sum, t) => sum + t.lastValidPrice, 0) /
        tickersWithData.length
      const scaledValue = averageNormalized * avgLastPrice

      result.push({
        time: timestamp,
        value: scaledValue,
      })
    }
  })

  return result
}

/**
 * Forward-fill missing values for strength data aggregation
 * Similar to forwardFillData but handles strength data aggregation structure
 */
export function aggregateStrengthDataWithInterpolation<T extends { timenow: Date }>(
  allRawData: (T[] | null)[],
  sortedTimestamps: number[],
  getStrengthValue: (item: T, intervals: string[]) => number | null,
  controlIntervals: string[]
): { time: number; value: number }[] {
  // Create a map to store aggregated values by timestamp
  const aggregatedMap = new Map<number, { sum: number; count: number }>()

  // Track interpolated data for each ticker
  const tickerInterpolatedData: Map<number, number>[] = []

  // Process each ticker's data
  allRawData.forEach((tickerData, tickerIndex) => {
    if (!tickerData) {
      tickerInterpolatedData[tickerIndex] = new Map()
      return
    }

    // Convert ticker data to timestamp/value pairs for interpolation
    const tickerValues = tickerData.map(item => ({
      timestamp: new Date(item.timenow).getTime() / 1000,
      value: getStrengthValue(item, controlIntervals)
    })).filter(item => item.value !== null) as Array<{ timestamp: number; value: number }>

    // Apply forward-fill interpolation
    const filledData = forwardFillData(tickerValues, sortedTimestamps)
    tickerInterpolatedData[tickerIndex] = filledData

    // Add interpolated values to aggregated map
    filledData.forEach((value, timestamp) => {
      if (!aggregatedMap.has(timestamp)) {
        aggregatedMap.set(timestamp, { sum: 0, count: 0 })
      }

      const existing = aggregatedMap.get(timestamp)!
      existing.sum += value
      existing.count++
    })
  })

  // Convert map to sorted result array
  const result: { time: number; value: number }[] = []
  aggregatedMap.forEach((value, timestamp) => {
    if (value.count > 0) {
      result.push({
        time: timestamp,
        value: value.sum / value.count,
      })
    }
  })

  // Sort by time
  return result.sort((a, b) => a.time - b.time)
}