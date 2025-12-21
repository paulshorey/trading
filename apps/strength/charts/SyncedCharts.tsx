'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRealtimeStrengthData } from './lib/data/useRealtimeStrengthData'
import { calculateTimeRange } from './lib/chartUtils'
import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import { useChartControlsStore } from './state/useChartControlsStore'
import { COLORS, HOURS_BACK_INITIAL } from './constants'
import {
  useAggregationWorker,
  AggregationResult,
} from './lib/workers/useAggregationWorker'
import { SCALE_FACTOR } from '@/constants'

export interface SyncedChartsProps {
  availableHeight: number
  availableHeightCrop: number
}

/**
 * Component that renders a single chart with dual y-axes for strength and price
 */
export function SyncedCharts({ availableHeight }: SyncedChartsProps) {
  // Chart ref for single chart
  const chartRef = useRef<ChartRef | null>(null)

  // Get state and actions from Zustand store
  const {
    // State
    hoursBack,
    interval,
    chartTickers, // Single consolidated ticker list
    timeRange,
    aggregatedStrengthData,
    aggregatedPriceData,
    intervalStrengthData,
    tickerPriceData,
    showIntervalLines,
    showTickerLines,
    // Actions
    setTimeRange,
    setAggregatedStrengthData,
    setAggregatedPriceData,
    setIntervalStrengthData,
    setTickerPriceData,
  } = useChartControlsStore()

  // Track if worker is processing for UI feedback
  const [isAggregating, setIsAggregating] = useState(false)

  /**
   * Use the real-time data hook to manage data fetching and updates
   * Fetches data for all selected chartTickers
   */
  const {
    rawData,
    isLoading,
    error,
    lastUpdateTime,
    isRealtime,
    isInitialLoad,
    updatedTimestamps,
  } = useRealtimeStrengthData({
    tickers: chartTickers,
    enabled: chartTickers.length > 0,
    maxDataHours: HOURS_BACK_INITIAL,
    updateIntervalMs: 10000, // Update every 10 seconds for real-time interval updates
  })

  /**
   * Handle aggregation results from the Web Worker
   * This callback updates the Zustand store with the computed data
   */
  const handleAggregationResult = useCallback(
    (result: AggregationResult, processingTimeMs: number) => {
      setIsAggregating(false)

      // Update all aggregated data in the store
      setAggregatedStrengthData(result.strengthData)
      setAggregatedPriceData(result.priceData)
      setIntervalStrengthData(result.intervalStrengthData)
      setTickerPriceData(result.tickerPriceData)

      // Log processing time for debugging
      if (processingTimeMs > 100) {
        console.log(
          `[Worker] Aggregation completed in ${processingTimeMs.toFixed(1)}ms`
        )
      }
    },
    [
      setAggregatedStrengthData,
      setAggregatedPriceData,
      setIntervalStrengthData,
      setTickerPriceData,
    ]
  )

  /**
   * Handle aggregation errors from the Web Worker
   */
  const handleAggregationError = useCallback((errorMsg: string) => {
    setIsAggregating(false)
    console.error('[Worker] Aggregation error:', errorMsg)
  }, [])

  /**
   * Initialize the Web Worker for data aggregation
   * All heavy computations happen off the main thread
   */
  const { aggregate, isProcessing, isReady } = useAggregationWorker({
    enabled: true,
    onResult: handleAggregationResult,
    onError: handleAggregationError,
  })

  /**
   * Data Aggregation Effect with Web Worker
   *
   * PERFORMANCE OPTIMIZATION:
   * - All aggregation happens in a Web Worker (off main thread)
   * - Main thread stays responsive for user interactions
   * - Worker processes all data and returns the results
   *
   * The aggregation creates multiple data series:
   * 1. Strength data: average of selected intervals across all tickers
   * 2. Price data: normalized average of all tickers
   * 3. Individual interval data: separate line for each selected interval
   * 4. Individual ticker price data: separate line for each selected ticker
   */
  useEffect(() => {
    if (rawData.length === 0 || !rawData.some((data) => data !== null)) {
      return
    }

    if (!isReady) {
      // Worker not ready yet, wait for next effect run
      return
    }

    // Don't trigger if already processing (prevents queue buildup)
    if (isProcessing) {
      return
    }

    setIsAggregating(true)

    // Send data to Web Worker for aggregation
    aggregate(rawData, interval, chartTickers)
  }, [interval, rawData, chartTickers, isReady, isProcessing, aggregate])

  /**
   * Time Range Effect
   *
   * Updates the visible time range when:
   * - hoursBack changes (user selects different time range)
   * - rawData changes (new data with different time bounds)
   * This only affects the visible portion of the charts, not the data itself.
   */
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, parseInt(hoursBack))
    if (newRange && newRange.from < newRange.to) {
      setTimeRange(newRange)
    } else if (!newRange && rawData.length > 0) {
      // If we can't calculate a range, log a warning
      console.warn('Unable to calculate valid time range from data', {
        rawDataLength: rawData.length,
        hoursBack,
        hasData: rawData.some((d) => d && d.length > 0),
      })
    }
  }, [hoursBack, rawData])

  return (
    <div className="relative w-full">
      {/* Show loading or error state */}
      {isLoading && <LoadingState />}
      {error && !isLoading && <ErrorState error={error} />}

      {/* Render single chart with dual y-axes */}
      {!isLoading && !error && (
        <Chart
          key="combined-chart"
          ref={(el) => {
            chartRef.current = el
          }}
          name="Strength & Price"
          heading={
            <span
              className="flex flex-row pl-[5px] scale2x"
              style={{ transformOrigin: 'left bottom' }}
            >
              <span className="pt-1 pr-1 pl-1 opacity-90 text-sm">
                <span
                  style={{
                    color: COLORS.price,
                    textShadow: '1px 1px 1px rgba(255, 255, 255, 1)',
                  }}
                >
                  Price
                </span>
                <span style={{ color: COLORS.neutral }}> / </span>
                <span
                  style={{
                    color: COLORS.strength,
                    textShadow: '1px 1px 1px rgba(255, 255, 255, 1)',
                  }}
                >
                  Strength
                </span>
                {/* <span className="text-gray-500"> trend</span> */}
              </span>
            </span>
          }
          strengthData={aggregatedStrengthData}
          priceData={aggregatedPriceData}
          intervalStrengthData={intervalStrengthData}
          tickerPriceData={tickerPriceData}
          tickers={chartTickers}
          showIntervalLines={showIntervalLines}
          showTickerLines={showTickerLines}
          width={
            typeof window !== 'undefined'
              ? window.innerWidth * SCALE_FACTOR
              : 1200
          }
          height={availableHeight}
          timeRange={timeRange}
          showZeroLine={true}
        />
      )}

      {/* Last updated time */}
      <UpdatedTime isRealtime={isRealtime} lastUpdateTime={lastUpdateTime} />

      {/* Target box for screen capture */}
      <div
        id="screenshot-target"
        className="absolute top-[34px] left-0 right-[8px] bottom-[34px] pointer-events-none"
      />
    </div>
  )
}
