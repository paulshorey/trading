'use client'

import { useEffect, useRef } from 'react'
import { LineData } from 'lightweight-charts'
import { useRealtimeStrengthData } from './lib/useRealtimeStrengthData'

import { calculateTimeRange } from './lib/chartUtils'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import { useChartControlsStore } from './state/useChartControlsStore'
import { COLORS, HOURS_BACK_INITIAL } from './constants'
import {
  aggregatePriceData,
  aggregatePriceByTicker,
} from './lib/aggregatePriceData'
import {
  aggregateStrengthData,
  aggregateStrengthByInterval,
} from './lib/aggregateStrengthData'
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

  /**
   * Data Aggregation Effect with Real-time Updates
   *
   * This effect recalculates the aggregated chart data whenever:
   * - rawData changes (new data fetched or real-time updates)
   * - interval changes (different intervals selected for averaging)
   * - lastUpdateTime changes (indicates new real-time data)
   *
   * The aggregation creates multiple data series:
   * 1. Strength data: average of selected intervals across all tickers
   * 2. Price data: normalized average of all tickers
   * 3. Individual interval data: separate line for each selected interval
   * 4. Individual ticker price data: separate line for each selected ticker
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

      // Calculate individual interval data for each selected interval
      const individualIntervalData = aggregateStrengthByInterval(
        rawData,
        interval,
        rawData // Pass same data for consistent timestamps
      )

      // Calculate individual ticker price data for each selected ticker
      const individualTickerPriceData = aggregatePriceByTicker(
        rawData,
        chartTickers,
        rawData // Pass same data for consistent timestamps
      )

      // Always create new array references to ensure React detects changes
      const newStrengthData = strengthData.length > 0 ? [...strengthData] : null
      const newPriceData = priceData.length > 0 ? [...priceData] : null

      setAggregatedStrengthData(newStrengthData)
      setAggregatedPriceData(newPriceData)
      setIntervalStrengthData(individualIntervalData)
      setTickerPriceData(individualTickerPriceData)
    }
  }, [
    interval,
    rawData,
    chartTickers,
    lastUpdateTime,
    setAggregatedStrengthData,
    setAggregatedPriceData,
    setIntervalStrengthData,
    setTickerPriceData,
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
                <span style={{ color: COLORS.price }}>Price</span>
                <span style={{ color: COLORS.neutral }}> / </span>
                <span style={{ color: COLORS.strength }}>Strength</span>
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
