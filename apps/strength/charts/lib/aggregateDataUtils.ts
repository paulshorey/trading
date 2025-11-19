/**
 * Data processing utilities for charts
 */

/**
 * Find the 2 most similar values from a group of 3 data points
 * Returns the average of the 2 most similar values, discarding the outlier
 *
 * Algorithm:
 * - Calculate distances between all pairs: |a-b|, |a-c|, |b-c|
 * - The pair with the smallest distance are the most similar
 * - Discard the third value (outlier) and return the average of the pair
 *
 * @param values - Array of exactly 3 numeric values
 * @returns Average of the 2 most similar values
 */
export function findTwoMostSimilar(values: number[]): number {
  if (values.length !== 3) {
    throw new Error('findTwoMostSimilar requires exactly 3 values')
  }

  const [a, b, c] = values as [number, number, number]

  // Calculate distances between all pairs
  const distAB = Math.abs(a - b)
  const distAC = Math.abs(a - c)
  const distBC = Math.abs(b - c)

  // Find the pair with minimum distance (most similar)
  let avg: number
  if (distAB <= distAC && distAB <= distBC) {
    // A and B are most similar, discard C
    avg = (a + b) / 2
  } else if (distAC <= distAB && distAC <= distBC) {
    // A and C are most similar, discard B
    avg = (a + c) / 2
  } else {
    // B and C are most similar, discard A
    avg = (b + c) / 2
  }

  return avg
}

/**
 * Generate future timestamps at 2-minute intervals
 * @param lastTimestamp - The last timestamp from the real data (in seconds)
 * @param hours - Number of hours to extend into the future
 * @returns Array of future timestamps at 2-minute intervals (in seconds)
 */
export function generateFutureTimestamps(
  lastTimestamp: number,
  hours: number = 12
): number[] {
  const futureTimestamps: number[] = []
  const intervalSeconds = 2 * 60 // 2 minutes in seconds
  const totalIntervals = (hours * 60) / 2 // Total number of 2-minute intervals

  for (let i = 1; i <= totalIntervals; i++) {
    futureTimestamps.push(lastTimestamp + i * intervalSeconds)
  }

  return futureTimestamps
}

/**
 * Forward-fill missing values in price data
 * Uses aggressive interpolation to fill all timestamps with the most recent valid value
 */
export function forwardFillData<
  T extends { timestamp: number; value?: number },
>(data: T[], sortedTimestamps: number[]): Map<number, number> {
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
 * IMPORTANT: Timestamps should be at even minutes with no seconds
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

        // Validate timestamp is at even minute with no seconds
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
 * Downsample data from 2-minute to 3-minute intervals
 * Uses sliding window approach with outlier removal
 *
 * For each 3-minute output timestamp:
 * 1. Find the 3 nearest input data points
 * 2. Discard the outlier (value most different from the other two)
 * 3. Average the remaining 2 values
 *
 * @param inputData - Map of 2-minute timestamp -> value
 * @param sortedInputTimestamps - Sorted array of 2-minute timestamps (in seconds)
 * @returns Array of downsampled data points at 3-minute intervals
 */
export function downsampleTo3Minutes(
  inputData: Map<number, number>,
  sortedInputTimestamps: number[]
): { time: number; value: number }[] {
  if (sortedInputTimestamps.length === 0) {
    return []
  }

  // Generate 3-minute interval timestamps
  const firstTimestamp = sortedInputTimestamps[0]!
  const lastTimestamp = sortedInputTimestamps[sortedInputTimestamps.length - 1]!

  // Round first timestamp down to nearest 3-minute mark
  const firstDate = new Date(firstTimestamp * 1000)
  const firstMinutes = firstDate.getMinutes()
  const roundedFirstMinutes = Math.floor(firstMinutes / 3) * 3
  firstDate.setMinutes(roundedFirstMinutes, 0, 0)
  const startTimestamp = firstDate.getTime() / 1000

  const output3MinTimestamps: number[] = []
  const intervalSeconds = 3 * 60 // 3 minutes

  for (
    let ts = startTimestamp;
    ts <= lastTimestamp;
    ts += intervalSeconds
  ) {
    output3MinTimestamps.push(ts)
  }

  // For each 3-minute timestamp, find 3 nearest input points and average the 2 most similar
  const result: { time: number; value: number }[] = []

  output3MinTimestamps.forEach((outputTimestamp) => {
    // Find 3 nearest input timestamps
    const nearestInputs: Array<{ timestamp: number; value: number }> = []

    // Find closest timestamp and its neighbors
    let closestIndex = 0
    let minDist = Infinity

    for (let i = 0; i < sortedInputTimestamps.length; i++) {
      const dist = Math.abs(sortedInputTimestamps[i]! - outputTimestamp)
      if (dist < minDist) {
        minDist = dist
        closestIndex = i
      }
    }

    // Get up to 3 points: closest and its neighbors
    const indices: number[] = []
    if (closestIndex > 0) indices.push(closestIndex - 1)
    indices.push(closestIndex)
    if (closestIndex < sortedInputTimestamps.length - 1)
      indices.push(closestIndex + 1)

    // If we're at the edge and only have 2 points, add another neighbor
    if (indices.length === 2) {
      if (closestIndex === 0 && sortedInputTimestamps.length > 2) {
        indices.push(closestIndex + 2)
      } else if (
        closestIndex === sortedInputTimestamps.length - 1 &&
        sortedInputTimestamps.length > 2
      ) {
        indices.unshift(closestIndex - 2)
      }
    }

    // Collect values for these timestamps
    const values: number[] = []
    indices.forEach((idx) => {
      const ts = sortedInputTimestamps[idx]!
      const value = inputData.get(ts)
      if (value !== undefined && Number.isFinite(value)) {
        values.push(value)
      }
    })

    // Average the 2 most similar values if we have at least 3 points
    if (values.length >= 3) {
      const avgValue = findTwoMostSimilar(values.slice(0, 3))
      result.push({
        time: outputTimestamp,
        value: avgValue,
      })
    } else if (values.length > 0) {
      // If we have fewer than 3 points, just average what we have
      const avgValue = values.reduce((sum, v) => sum + v, 0) / values.length
      result.push({
        time: outputTimestamp,
        value: avgValue,
      })
    }
  })

  return result
}

/**
 * Forward-fill missing values for strength data aggregation
 * Similar to forwardFillData but handles strength data aggregation structure
 */
export function aggregateStrengthDataWithInterpolation<
  T extends { timenow: Date },
>(
  allRawData: (T[] | null)[],
  sortedTimestamps: number[],
  getStrengthValue: (item: T, intervals: string[]) => number | null,
  controlIntervals: string[]
): { time: number; value: number }[] {
  // Create a map to store aggregated values by timestamp
  const aggregatedMap = new Map<number, { sum: number; count: number }>()

  // Track interpolated data for each ticker
  const tickerInterpolatedData: Map<number, number>[] = []
  let tickersWithData = 0
  let totalDataPoints = 0

  // Process each ticker's data
  allRawData.forEach((tickerData, tickerIndex) => {
    if (!tickerData || tickerData.length === 0) {
      tickerInterpolatedData[tickerIndex] = new Map()
      return
    }
    tickersWithData++

    // Convert ticker data to timestamp/value pairs for interpolation
    // Skip entries where ALL interval values are null (empty pre-created rows)
    const tickerValues = tickerData
      .map((item) => {
        const value = getStrengthValue(item, controlIntervals)
        // Only include if we have actual data (not empty pre-created rows)
        if (value === null || value === 0) {
          // Check if this is an empty row (all strength values are null)
          const hasAnyData = controlIntervals.some(
            (interval) =>
              item[interval as keyof typeof item] !== null &&
              item[interval as keyof typeof item] !== undefined
          )
          if (!hasAnyData) {
            return null // Skip empty pre-created rows
          }
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

    // Apply forward-fill interpolation
    const filledData = forwardFillData(tickerValues, sortedTimestamps)
    tickerInterpolatedData[tickerIndex] = filledData

    totalDataPoints += tickerValues.length

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
  const sorted = result.sort((a, b) => a.time - b.time)

  return sorted
}
