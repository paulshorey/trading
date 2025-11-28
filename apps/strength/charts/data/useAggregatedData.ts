/**
 * Aggregated Chart Data Hook
 *
 * Processes raw strength data into chart-ready format.
 * Extracted from SyncedCharts.tsx to separate data processing from rendering.
 *
 * Responsibilities:
 * 1. Aggregate strength data across selected intervals
 * 2. Aggregate and normalize price data across tickers
 * 3. Calculate visible time range based on hoursBack setting
 */

import { useEffect, useRef } from 'react'
import { LineData, Time } from 'lightweight-charts'
import { StrengthRowGet } from '@lib/common/sql/strength'
import { aggregateStrengthData, aggregatePriceData } from './aggregation'
import { useChartControlsStore } from '../state'

/**
 * Calculate time range from raw data
 */
function calculateTimeRange(
  rawData: (StrengthRowGet[] | null)[],
  hoursBack: number
): { from: Time; to: Time } | null {
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

export interface UseAggregatedDataOptions {
  rawData: (StrengthRowGet[] | null)[]
  lastUpdateTime: Date | null
}

export interface UseAggregatedDataResult {
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null
  timeRange: { from: Time; to: Time } | null
}

/**
 * Hook that processes raw data into aggregated chart data
 * Updates the Zustand store with processed data
 */
export function useAggregatedData({
  rawData,
  lastUpdateTime,
}: UseAggregatedDataOptions): UseAggregatedDataResult {
  // Get state and actions from store
  const {
    hoursBack,
    interval,
    chartTickers,
    timeRange,
    aggregatedStrengthData,
    aggregatedPriceData,
    setTimeRange,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  } = useChartControlsStore()

  // Track previous data for comparison
  const prevAggregatedStrengthRef = useRef<LineData[] | null>(null)
  const prevAggregatedPriceRef = useRef<LineData[] | null>(null)

  /**
   * Data Aggregation Effect
   *
   * Recalculates aggregated chart data when:
   * - rawData changes (new data fetched or real-time updates)
   * - interval changes (different intervals selected for averaging)
   * - lastUpdateTime changes (indicates new real-time data)
   */
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      const strengthData = aggregateStrengthData(rawData, interval, rawData)
      const priceData = aggregatePriceData(rawData, rawData)

      // Log aggregation results for debugging
      if (lastUpdateTime && prevAggregatedStrengthRef.current) {
        const newStrengthPoints =
          strengthData.length - (prevAggregatedStrengthRef.current?.length || 0)
        const newPricePoints =
          priceData.length - (prevAggregatedPriceRef.current?.length || 0)

        if (newStrengthPoints > 0 || newPricePoints > 0) {
          console.log('[useAggregatedData] Update:', {
            timestamp: lastUpdateTime.toISOString(),
            newStrengthPoints,
            newPricePoints,
            totalStrengthPoints: strengthData.length,
            totalPricePoints: priceData.length,
            chartTickers,
          })
        }
      }

      // Create new array references to trigger React updates
      const newStrengthData = strengthData.length > 0 ? [...strengthData] : null
      const newPriceData = priceData.length > 0 ? [...priceData] : null

      setAggregatedStrengthData(newStrengthData)
      setAggregatedPriceData(newPriceData)

      prevAggregatedStrengthRef.current = newStrengthData
      prevAggregatedPriceRef.current = newPriceData
    }
  }, [
    interval,
    rawData,
    chartTickers,
    lastUpdateTime,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  ])

  /**
   * Time Range Effect
   *
   * Updates visible time range when:
   * - hoursBack changes (user selects different time range)
   * - rawData changes (new data with different time bounds)
   */
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, parseInt(hoursBack))
    if (newRange && newRange.from < newRange.to) {
      setTimeRange(newRange)
    } else if (!newRange && rawData.length > 0) {
      console.warn('Unable to calculate valid time range from data', {
        rawDataLength: rawData.length,
        hoursBack,
        hasData: rawData.some((d) => d && d.length > 0),
      })
    }
  }, [hoursBack, rawData, setTimeRange])

  return {
    aggregatedStrengthData,
    aggregatedPriceData,
    timeRange,
  }
}


