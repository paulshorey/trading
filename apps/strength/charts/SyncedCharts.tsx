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
import MarketControl from './controls/MarketControl'

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
    controlInterval,
    dataPoolTickers,   // Renamed from marketTickers for clarity
    strengthTickers,   // Renamed from controlTickers for clarity
    priceTickers,
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
   * Always fetch data for ALL dataPoolTickers to prevent refetching when switching views
   * Data will be filtered based on strengthTickers and priceTickers during aggregation
   */
  const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
    useRealtimeStrengthData({
      tickers: dataPoolTickers, // Always use dataPoolTickers to avoid refetching
      enabled: dataPoolTickers.length > 0,
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
   * - controlInterval changes (different intervals selected for averaging)
   * - priceTickers changes (different tickers selected for price chart)
   * - controlTickers changes (different tickers selected for strength chart)
   * - lastUpdateTime changes (indicates new real-time data)
   *
   * The aggregation creates two data series:
   * 1. Strength data: average of selected intervals across selected strength tickers
   * 2. Price data: normalized average of selected price tickers
   */
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      // Filter raw data based on selected tickers
      // rawData is ordered the same as dataPoolTickers
      const strengthIndices = strengthTickers
        .map((ticker) => dataPoolTickers.indexOf(ticker))
        .filter((i) => i >= 0)
      const priceIndices = priceTickers
        .map((ticker) => dataPoolTickers.indexOf(ticker))
        .filter((i) => i >= 0)

      const strengthRawData = strengthIndices.map((i) => rawData[i] || null)
      const priceRawData = priceIndices.map((i) => rawData[i] || null)

      // Always use ALL market data for timestamp extraction to ensure consistency
      // This prevents issues when switching between Average and individual tickers
      const strengthData = aggregateStrengthData(
        strengthRawData,
        controlInterval,
        rawData // Pass all market data for consistent timestamps
      )
      const priceData = aggregatePriceData(
        priceRawData,
        rawData // Pass all market data for consistent timestamps
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
            strengthTickers,
            priceTickers,
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
    controlInterval,
    priceTickers,
    rawData,
    strengthTickers,
    dataPoolTickers,
    lastUpdateTime,
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
                <span className="text-gray-500"> follows </span>
                <span className="text-[#ff8800]">Strength</span>
                <span className="text-gray-500"> trend</span>
              </span>
            </span>
          }
          strengthData={aggregatedStrengthData}
          priceData={aggregatedPriceData}
          width={typeof window !== 'undefined' ? window.innerWidth : 1200}
          height={availableHeight}
          timeRange={timeRange}
          showZeroLine={true}
        />
      )}

      {/* Last updated time */}
      <UpdatedTime isRealtime={isRealtime} lastUpdateTime={lastUpdateTime} />

      {/* Ticker control */}
      <div
        className="fixed top-[33px] left-[9px] font-normal z-[10000]"
        dir="ltr"
      >
        <div className="flex flex-row relative">
          <MarketControl showLabel={false} />
        </div>
      </div>
    </div>
  )
}
