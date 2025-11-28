'use client'

import { useEffect, useRef } from 'react'
import { LineData } from 'lightweight-charts'
import { useRealtimeStrengthData } from './lib/useRealtimeStrengthData'

import { calculateTimeRange } from './lib/chartUtils'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import { useChartControlsStore } from './state/useChartControlsStore'
import { HOURS_BACK_INITIAL } from './constants'
import { aggregatePriceData } from './lib/aggregatePriceData'
import { aggregateStrengthData } from './lib/aggregateStrengthData'
import MarketControl from './components/controls/MarketControl'
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
    // Actions
    setTimeRange,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  } = useChartControlsStore()

  /**
   * Use the real-time data hook to manage data fetching and updates
   * Fetches data for all selected chartTickers
   */
  const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
    useRealtimeStrengthData({
      tickers: chartTickers,
      enabled: chartTickers.length > 0,
      maxDataHours: HOURS_BACK_INITIAL,
      updateIntervalMs: 60000, // Update every minute
    })

  // Track previous aggregated data for incremental updates
  const prevAggregatedStrengthRef = useRef<LineData[] | null>(null)
  const prevAggregatedPriceRef = useRef<LineData[] | null>(null)

  /**
   * Data Aggregation Effect with Real-time Updates
   *
   * This effect recalculates the aggregated chart data whenever:
   * - rawData changes (new data fetched or real-time updates)
   * - interval changes (different intervals selected for averaging)
   * - lastUpdateTime changes (indicates new real-time data)
   *
   * The aggregation creates two data series:
   * 1. Strength data: average of selected intervals across all tickers
   * 2. Price data: normalized average of all tickers
   */
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      // Use all raw data for both charts (no filtering needed)
      const strengthData = aggregateStrengthData(
        rawData,
        interval,
        rawData // Pass same data for consistent timestamps
      )
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
          console.log('[SyncedCharts] Aggregation update:', {
            timestamp: lastUpdateTime.toISOString(),
            newStrengthPoints,
            newPricePoints,
            totalStrengthPoints: strengthData.length,
            totalPricePoints: priceData.length,
            chartTickers,
          })
        }
      }

      // Always create new array references to ensure React detects changes
      const newStrengthData = strengthData.length > 0 ? [...strengthData] : null
      const newPriceData = priceData.length > 0 ? [...priceData] : null

      setAggregatedStrengthData(newStrengthData)
      setAggregatedPriceData(newPriceData)

      // Store current data for next comparison (after setting state)
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
            <span className="flex flex-row pl-[5px]">
              <span className="pt-1 pr-1 pl-1 opacity-90 text-sm">
                <span className="text-[#0084ff]">Price</span>
                <span className="text-gray-500"> / </span>
                <span className="text-[#ff8800]">Strength</span>
                {/* <span className="text-gray-500"> trend</span> */}
              </span>
            </span>
          }
          strengthData={aggregatedStrengthData}
          priceData={aggregatedPriceData}
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

      {/* Ticker control */}
      <div
        className="fixed top-[33px] left-[9px] font-normal z-[100]"
        dir="ltr"
      >
        <div className="flex flex-row relative">
          <MarketControl showLabel={false} />
        </div>
      </div>

      {/* Target box for screen capture */}
      <div
        id="screenshot-target"
        className="absolute top-[34px] left-0 right-[8px] bottom-[34px] pointer-events-none"
      />
    </div>
  )
}
