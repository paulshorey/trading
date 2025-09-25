import { LineData, Time } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'

/**
 * Convert strength data to chart data using the specified intervals
 * If multiple intervals are provided, average their values
 */
export const convertToChartData = (
  data: StrengthRowGet[],
  control_intervals: string[]
): LineData[] => {
  return data
    .map((item) => {
      // Calculate average value across all specified intervals
      let sum = 0
      let count = 0

      for (const interval of control_intervals) {
        const value = item[interval as keyof StrengthRowGet]

        // Only include non-null values in the average
        if (value !== null && value !== undefined) {
          const numericValue =
            typeof value === 'string' ? parseFloat(value) : Number(value)

          if (Number.isFinite(numericValue)) {
            sum += numericValue
            count++
          }
        }
      }

      // Skip this data point if no valid values were found
      if (count === 0) return null

      // Calculate average
      const averageValue = sum / count

      return {
        time: (new Date(item.timenow).getTime() / 1000) as any,
        value: averageValue,
      }
    })
    .filter((item): item is LineData => item !== null) // Remove null values
}

/**
 * Calculate time range from raw data
 */
export const calculateTimeRange = (
  rawData: (StrengthRowGet[] | null)[],
  hoursBack: number
): { from: Time; to: Time } | null => {
  let latestOverallTime = 0
  let earliestOverallTime = Infinity

  // Find the overall time range across all tickers
  rawData.forEach((tickerData) => {
    if (tickerData && tickerData.length > 0) {
      const firstTime = tickerData[0]!.timenow.getTime() / 1000
      const lastTime =
        tickerData[tickerData.length - 1]!.timenow.getTime() / 1000
      earliestOverallTime = Math.min(earliestOverallTime, firstTime)
      latestOverallTime = Math.max(latestOverallTime, lastTime)
    }
  })

  if (latestOverallTime > 0 && earliestOverallTime < Infinity) {
    const hoursBackInSeconds = hoursBack * 60 * 60
    const startTime = Math.max(
      earliestOverallTime,
      latestOverallTime - hoursBackInSeconds
    )

    // Ensure start time is always before end time
    // Add a small buffer if they're equal or too close
    if (startTime >= latestOverallTime) {
      // If we don't have enough data, show at least 1 hour
      const oneHourInSeconds = 60 * 60
      return {
        from: (latestOverallTime - oneHourInSeconds) as Time,
        to: latestOverallTime as Time,
      }
    }

    return {
      from: startTime as Time,
      to: latestOverallTime as Time,
    }
  }

  return null
}

/**
 * Get price data for a single ticker
 * Creates a chart data series for the price values of a specific ticker
 */
export const getSingleTickerPriceData = (
  allRawData: (StrengthRowGet[] | null)[],
  controlTickers: string[],
  selectedTicker: string
): LineData[] => {
  // Find the index of the selected ticker
  const tickerIndex = controlTickers.indexOf(selectedTicker)
  if (tickerIndex === -1 || !allRawData[tickerIndex]) {
    return []
  }

  const tickerData = allRawData[tickerIndex]!
  const result: LineData[] = []

  // Process the selected ticker's data
  tickerData.forEach((item) => {
    if (
      item.price !== null &&
      item.price !== undefined &&
      item.price !== 0 &&
      Number.isFinite(item.price)
    ) {
      result.push({
        time: (new Date(item.timenow).getTime() / 1000) as Time,
        value: item.price,
      })
    }
  })

  // Sort by time
  return result.sort((a, b) => (a.time as number) - (b.time as number))
}

/**
 * Get nearest series value at a specific time using binary search
 * If multiple intervals are provided, average their values
 */
export const getNearestSeriesValueAtTime = (
  chartData: LineData[] | null | undefined,
  t: Time,
  chartIndex: number,
  rawData: (StrengthRowGet[] | null)[],
  control_intervals: string[]
): number | null => {
  const tickerRawData = rawData[chartIndex]
  if (
    !tickerRawData ||
    !chartData ||
    typeof t !== 'number' ||
    tickerRawData.length === 0
  )
    return null
  const target = t as number

  // Binary search to find nearest index by timenow in raw data
  let left = 0
  let right = tickerRawData.length - 1
  while (left <= right) {
    const mid = (left + right) >> 1
    const midTime = tickerRawData[mid]!.timenow.getTime() / 1000
    if (midTime === target) {
      left = mid
      right = mid - 1
      break
    }
    if (midTime < target) left = mid + 1
    else right = mid - 1
  }

  // Candidates are at indices right and left
  let idx = right
  if (left >= 0 && left < tickerRawData.length) {
    if (right < 0) idx = left
    else {
      const leftTime = tickerRawData[left]!.timenow.getTime() / 1000
      const rightTime = tickerRawData[right]!.timenow.getTime() / 1000
      idx =
        Math.abs(leftTime - target) < Math.abs(rightTime - target)
          ? left
          : right
    }
  } else if (right < 0) {
    idx = 0
  } else if (right >= tickerRawData.length) {
    idx = tickerRawData.length - 1
  }

  idx = Math.max(0, Math.min(idx, tickerRawData.length - 1))

  // Calculate average value across all specified intervals
  let sum = 0
  let count = 0

  for (const interval of control_intervals) {
    const raw = tickerRawData[idx]![interval as keyof StrengthRowGet]

    if (raw !== null && raw !== undefined) {
      const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
      if (Number.isFinite(value)) {
        sum += value
        count++
      }
    }
  }

  // Return null if no valid values found, otherwise return average
  return count > 0 ? sum / count : null
}
