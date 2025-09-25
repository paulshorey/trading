import { StrengthRowGet } from '@apps/common/sql/strength'
import { LineData, Time } from 'lightweight-charts'
import {
  aggregateStrengthDataWithInterpolation,
  extractGlobalTimestamps,
} from './aggregateDataUtils'

/**
 * Aggregate strength data from all tickers with interpolation
 * Creates a single chart data series that averages all interval values from all tickers
 * Uses forward-fill interpolation to handle missing values
 */
export const aggregateStrengthData = (
  allRawData: (StrengthRowGet[] | null)[],
  control_intervals: string[]
): LineData[] => {
  // Extract all unique timestamps
  const sortedTimestamps = extractGlobalTimestamps(allRawData)

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

  // Convert to LineData format
  return result.map((point) => ({
    time: point.time as Time,
    value: point.value,
  }))
}
