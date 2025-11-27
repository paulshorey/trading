import { useEffect, useRef } from 'react'
import { LineData } from 'lightweight-charts'
import { useChartControlsStore } from '../../state/useChartControlsStore'
import { useRealtimeStrengthData } from '../useRealtimeStrengthData'
import { aggregatePriceData } from '../aggregatePriceData'
import { aggregateStrengthData } from '../aggregateStrengthData'
import { calculateTimeRange } from '../timeRangeUtils'
import {
  HOURS_BACK_INITIAL,
  REALTIME_UPDATE_INTERVAL_MS,
} from '../../constants'

export interface UseAggregatedChartDataOptions {
  /** Tickers to fetch data for */
  tickers: string[]
  /** Whether data fetching is enabled */
  enabled?: boolean
}

export interface UseAggregatedChartDataResult {
  /** Aggregated strength data for chart rendering */
  strengthData: LineData[] | null
  /** Aggregated price data for chart rendering */
  priceData: LineData[] | null
  /** Whether initial data is still loading */
  isLoading: boolean
  /** Error message if data fetch failed */
  error: string | null
  /** Last time data was updated */
  lastUpdateTime: Date | null
  /** Whether real-time updates are active */
  isRealtime: boolean
}

/**
 * Hook that manages fetching, aggregating, and updating chart data
 *
 * This hook encapsulates the complete data pipeline:
 * 1. Fetches real-time strength data for selected tickers
 * 2. Aggregates strength values across selected intervals
 * 3. Normalizes and aggregates price data across tickers
 * 4. Updates the Zustand store with aggregated data
 * 5. Calculates and updates the visible time range
 *
 * @param options - Configuration options
 * @returns Aggregated chart data and status indicators
 */
export function useAggregatedChartData({
  tickers,
  enabled = true,
}: UseAggregatedChartDataOptions): UseAggregatedChartDataResult {
  // Get state and actions from Zustand store
  const {
    hoursBack,
    interval,
    aggregatedStrengthData,
    aggregatedPriceData,
    setTimeRange,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  } = useChartControlsStore()

  // Fetch real-time data
  const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
    useRealtimeStrengthData({
      tickers,
      enabled: enabled && tickers.length > 0,
      maxDataHours: HOURS_BACK_INITIAL,
      updateIntervalMs: REALTIME_UPDATE_INTERVAL_MS,
    })

  // Track previous aggregated data for incremental update logging
  const prevAggregatedStrengthRef = useRef<LineData[] | null>(null)
  const prevAggregatedPriceRef = useRef<LineData[] | null>(null)

  /**
   * Data Aggregation Effect
   *
   * Recalculates aggregated chart data whenever:
   * - rawData changes (new data fetched or real-time updates)
   * - interval changes (different intervals selected for averaging)
   * - lastUpdateTime changes (indicates new real-time data)
   *
   * Creates two data series:
   * 1. Strength data: average of selected intervals across all tickers
   * 2. Price data: normalized average of all tickers
   */
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      // Aggregate strength data with selected intervals
      const strengthData = aggregateStrengthData(
        rawData,
        interval,
        rawData // Pass same data for consistent timestamps
      )

      // Aggregate and normalize price data
      const priceData = aggregatePriceData(
        rawData,
        rawData // Pass same data for consistent timestamps
      )

      // Log aggregation results for debugging
      if (lastUpdateTime && prevAggregatedStrengthRef.current) {
        const newStrengthPoints =
          strengthData.length - (prevAggregatedStrengthRef.current?.length || 0)
        const newPricePoints =
          priceData.length - (prevAggregatedPriceRef.current?.length || 0)

        if (newStrengthPoints > 0 || newPricePoints > 0) {
          console.log('[useAggregatedChartData] Aggregation update:', {
            timestamp: lastUpdateTime.toISOString(),
            newStrengthPoints,
            newPricePoints,
            totalStrengthPoints: strengthData.length,
            totalPricePoints: priceData.length,
            tickers,
          })
        }
      }

      // Create new array references to ensure React detects changes
      const newStrengthData = strengthData.length > 0 ? [...strengthData] : null
      const newPriceData = priceData.length > 0 ? [...priceData] : null

      setAggregatedStrengthData(newStrengthData)
      setAggregatedPriceData(newPriceData)

      // Store current data for next comparison
      prevAggregatedStrengthRef.current = newStrengthData
      prevAggregatedPriceRef.current = newPriceData
    }
  }, [
    interval,
    rawData,
    tickers,
    lastUpdateTime,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  ])

  /**
   * Time Range Effect
   *
   * Updates the visible time range when:
   * - hoursBack changes (user selects different time range)
   * - rawData changes (new data with different time bounds)
   *
   * This only affects the visible portion of the charts, not the data itself.
   */
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, parseInt(hoursBack))
    if (newRange && newRange.from < newRange.to) {
      setTimeRange(newRange)
    } else if (!newRange && rawData.length > 0) {
      console.warn(
        '[useAggregatedChartData] Unable to calculate valid time range',
        {
          rawDataLength: rawData.length,
          hoursBack,
          hasData: rawData.some((d) => d && d.length > 0),
        }
      )
    }
  }, [hoursBack, rawData, setTimeRange])

  return {
    strengthData: aggregatedStrengthData,
    priceData: aggregatedPriceData,
    isLoading,
    error,
    lastUpdateTime,
    isRealtime,
  }
}
