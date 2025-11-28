/**
 * Chart Utilities
 *
 * Helper functions for chart data conversion and manipulation.
 */

import { LineData, Time } from 'lightweight-charts'
import { StrengthRowGet } from '@lib/common/sql/strength'

/**
 * Convert strength data to chart data format
 * Averages values across specified intervals
 */
export const convertToChartData = (
  data: StrengthRowGet[],
  intervals: string[]
): LineData[] => {
  return data
    .map((item) => {
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

      if (count === 0) return null

      return {
        time: (new Date(item.timenow).getTime() / 1000) as Time,
        value: sum / count,
      }
    })
    .filter((item): item is LineData => item !== null)
}

/**
 * Calculate visible time range from raw data
 * Returns the appropriate from/to based on hoursBack setting
 */
export const calculateTimeRange = (
  rawData: (StrengthRowGet[] | null)[],
  hoursBack: number
): { from: Time; to: Time } | null => {
  let latestOverallTime = 0
  let earliestOverallTime = Infinity

  rawData.forEach((tickerData) => {
    if (tickerData && tickerData.length > 0) {
      const firstTime = tickerData[0]!.timenow.getTime() / 1000
      const lastTime = tickerData[tickerData.length - 1]!.timenow.getTime() / 1000
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

    if (startTime >= latestOverallTime) {
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
 * Get nearest series value at a specific time using binary search
 * Useful for crosshair tooltip values
 */
export const getNearestSeriesValueAtTime = (
  chartData: LineData[] | null | undefined,
  time: Time,
  chartIndex: number,
  rawData: (StrengthRowGet[] | null)[],
  intervals: string[]
): number | null => {
  const tickerRawData = rawData[chartIndex]
  if (
    !tickerRawData ||
    !chartData ||
    typeof time !== 'number' ||
    tickerRawData.length === 0
  ) {
    return null
  }

  const target = time as number

  // Binary search for nearest timestamp
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

  // Find nearest index
  let idx = right
  if (left >= 0 && left < tickerRawData.length) {
    if (right < 0) {
      idx = left
    } else {
      const leftTime = tickerRawData[left]!.timenow.getTime() / 1000
      const rightTime = tickerRawData[right]!.timenow.getTime() / 1000
      idx =
        Math.abs(leftTime - target) < Math.abs(rightTime - target) ? left : right
    }
  } else if (right < 0) {
    idx = 0
  } else if (right >= tickerRawData.length) {
    idx = tickerRawData.length - 1
  }

  idx = Math.max(0, Math.min(idx, tickerRawData.length - 1))

  // Calculate average across intervals
  let sum = 0
  let count = 0

  for (const interval of intervals) {
    const raw = tickerRawData[idx]![interval as keyof StrengthRowGet]

    if (raw !== null && raw !== undefined) {
      const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
      if (Number.isFinite(value)) {
        sum += value
        count++
      }
    }
  }

  return count > 0 ? sum / count : null
}


