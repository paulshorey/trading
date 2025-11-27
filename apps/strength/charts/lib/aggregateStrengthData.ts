import { StrengthRowGet } from '@lib/common/sql/strength'
import { LineData, Time } from 'lightweight-charts'
import {
  aggregateStrengthDataWithInterpolation,
  extractGlobalTimestamps,
  generateFutureTimestamps,
} from './interpolation'

/**
 * Aggregate strength data from all tickers with interpolation
 * Creates a single chart data series that averages all interval values from all tickers
 * Uses forward-fill interpolation to handle missing values
 */
export const aggregateStrengthData = (
  allRawData: (StrengthRowGet[] | null)[],
  control_intervals: string[],
  allMarketData?: (StrengthRowGet[] | null)[] // Optional: all market data for consistent timestamps
): LineData[] => {
  // Extract all unique timestamps from ALL market data to ensure consistency
  // This prevents issues when switching between Average and individual tickers
  const dataForTimestamps = allMarketData || allRawData
  const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)

  if (sortedTimestamps.length === 0) {
    return []
  }

  // Helper function to extract strength value from an item
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

  // Use the new interpolation utility
  const result = aggregateStrengthDataWithInterpolation(
    allRawData,
    sortedTimestamps,
    getStrengthValue,
    control_intervals
  )

  // Convert to LineData format - ensure we create new objects
  const lineData = result.map((point) => ({
    time: point.time as Time,
    value: point.value,
  }))

  // Extend data 12 hours into the future with the last known value
  if (lineData.length > 0) {
    const lastDataPoint = lineData[lineData.length - 1]!
    const lastTimestamp = lastDataPoint.time as number
    const lastValue = lastDataPoint.value

    // Generate future timestamps (12 hours at 2-minute intervals)
    const futureTimestamps = generateFutureTimestamps(lastTimestamp, 12)

    // Add future data points with the last known value
    futureTimestamps.forEach((timestamp) => {
      lineData.push({
        time: timestamp as Time,
        value: lastValue,
      })
    })
  }

  return lineData
}
