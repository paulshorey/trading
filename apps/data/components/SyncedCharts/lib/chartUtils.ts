import { LineData, Time } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'

/**
 * Convert strength data to chart data using the fixed interval
 */
export const convertToChartData = (
  data: StrengthRowGet[],
  control_interval: string
): LineData[] => {
  return data
    .map((item) => {
      // Access the fixed interval field
      const value = item[control_interval as keyof StrengthRowGet]

      // Skip rows where this interval's value is null
      if (value === null || value === undefined) return null
      const numericValue =
        typeof value === 'string' ? parseFloat(value) : Number(value)
      // Skip invalid values
      if (!Number.isFinite(numericValue)) return null

      return {
        time: (new Date(item.timenow).getTime() / 1000) as any,
        value: numericValue,
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
    return {
      from: startTime as Time,
      to: latestOverallTime as Time,
    }
  }

  return null
}

/**
 * Get nearest series value at a specific time using binary search
 */
export const getNearestSeriesValueAtTime = (
  chartData: LineData[] | null | undefined,
  t: Time,
  chartIndex: number,
  rawData: (StrengthRowGet[] | null)[],
  control_interval: string
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
  const raw = tickerRawData[idx]![control_interval as keyof StrengthRowGet]

  if (raw === null || raw === undefined) return null
  const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
  return Number.isFinite(value) ? value : null
}
