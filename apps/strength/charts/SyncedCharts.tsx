'use client'

import { useEffect, useRef } from 'react'
import { Time, ISeriesApi, LineData } from 'lightweight-charts'
import { useRealtimeStrengthData } from '../lib/useRealtimeStrengthData'

import {
  calculateTimeRange,
  aggregateStrengthData,
  aggregatePriceData,
} from './lib/chartUtils'
import { applyCursorToAllCharts } from './lib/chartSync'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import { useChartControlsStore } from './state/useChartControlsStore'
import { CHART_WIDTH } from './constants'
import PriceControl from './controls/PriceControl'
import StrengthControl from './controls/StrengthControl'
import MarketControl from './controls/MarketControl'

export interface SyncedChartsProps {
  availableHeight: number
  availableHeightCrop: number
}

/**
 * Inner component that renders charts with specific dimensions
 */
export function SyncedCharts({
  availableHeight,
  availableHeightCrop,
}: SyncedChartsProps) {
  // Chart refs
  const chartComponentRefs = useRef<(ChartRef | null)[]>([])
  const isUpdatingCursor = useRef(false)

  // Get state and actions from Zustand store
  const {
    // State
    hoursBack,
    controlInterval,
    controlTickers,
    priceTickers,
    timeRange,
    cursorTime,
    aggregatedStrengthData,
    aggregatedPriceData,
    // Actions
    setTimeRange,
    setCursorTime,
    setAggregatedStrengthData,
    setAggregatedPriceData,
  } = useChartControlsStore()

  // Always have exactly 2 chart refs (one for strength, one for price)
  useEffect(() => {
    chartComponentRefs.current = new Array(2).fill(null)
  }, [])

  /**
   * Use the real-time data hook to manage data fetching and updates
   * This replaces the old data loading effect with automatic real-time updates
   */
  const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
    useRealtimeStrengthData({
      tickers: controlTickers,
      enabled: controlTickers.length > 0,
      maxDataHours: 240,
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
      // Note: The rawData corresponds to controlTickers by index
      // For now, we'll use all rawData and let the aggregation functions handle the filtering
      // TODO: This logic needs to be updated when we have proper ticker-to-data mapping
      const strengthData = aggregateStrengthData(rawData, controlInterval)
      const priceData = aggregatePriceData(rawData)

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
            controlTickers,
            priceTickers,
          })
        }
      }

      // Store previous data for comparison
      prevAggregatedStrengthRef.current = aggregatedStrengthData
      prevAggregatedPriceRef.current = aggregatedPriceData

      setAggregatedStrengthData(strengthData.length > 0 ? strengthData : null)
      setAggregatedPriceData(priceData.length > 0 ? priceData : null)
    }
  }, [controlInterval, priceTickers, rawData, controlTickers, lastUpdateTime])

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

  /**
   * Cursor Synchronization Effect
   *
   * Synchronizes the crosshair cursor position across both charts.
   * When the user hovers over one chart, the cursor position is
   * mirrored on the other chart for easy comparison of values
   * at the same time point.
   */
  useEffect(() => {
    const chartRefs = chartComponentRefs.current
      .map((ref) => ref?.chart)
      .filter(Boolean)

    const seriesRefs = chartComponentRefs.current
      .map((ref) => ref?.series)
      .filter(Boolean) as ISeriesApi<'Line'>[]

    // Create array of chart data for the 2 charts
    const chartsData = [aggregatedStrengthData, aggregatedPriceData]

    applyCursorToAllCharts(
      cursorTime,
      chartRefs,
      seriesRefs,
      chartsData,
      rawData,
      controlInterval,
      isUpdatingCursor
    )
  }, [
    cursorTime,
    aggregatedStrengthData,
    aggregatedPriceData,
    rawData,
    controlInterval,
  ])

  // Crosshair move handler
  const handleCrosshairMove = (time: Time | null) => {
    if (!isUpdatingCursor.current) {
      setCursorTime(time)
    }
  }

  const chart1Height =
    Math.ceil((availableHeight * 1) / 2) + availableHeightCrop
  const chart2Height =
    Math.ceil((availableHeight * 1) / 2) - availableHeightCrop

  return (
    <div
      className={`overflow-hidden relative`}
      style={{ width: CHART_WIDTH + 'px' }}
    >
      {/* Show loading or error state for all charts */}
      {isLoading && <LoadingState />}
      {error && !isLoading && <ErrorState error={error} />}

      {/* Render 2 aggregated charts */}
      {!isLoading && !error && (
        <>
          {/* Chart: Aggregated Strength (average of all interval averages) */}
          <Chart
            key="aggregated-strength"
            ref={(el) => {
              chartComponentRefs.current[0] = el
            }}
            name={`Strength`}
            heading={
              <span className="flex flex-row pl-[5px]">
                <MarketControl showLabel={false} />
                <span className="pt-1 pr-1 pl-1 opacity-50 text-sm">→</span>
                <StrengthControl showLabel={false} />
                <span className="pt-1 pr-1 pl-1 opacity-90 text-sm">
                  Strength
                </span>
              </span>
            }
            chartData={aggregatedStrengthData}
            width={CHART_WIDTH}
            height={chart1Height}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={0}
            timeRange={timeRange}
            showZeroLine={true}
          />

          {/* Chart: Price Tickers */}
          <Chart
            key={`price-${JSON.stringify(priceTickers)}`}
            ref={(el) => {
              chartComponentRefs.current[1] = el
            }}
            name={`Price`}
            chartData={aggregatedPriceData}
            heading={
              <span className="flex flex-row pl-[5px]">
                {/* <span className="pt-1 pr-1 opacity-50 text-sm">Price of</span> */}
                <PriceControl showLabel={false} />
                <span className="pt-1 pr-1 pl-1 opacity-90 text-sm">Price</span>
              </span>
            }
            width={CHART_WIDTH}
            height={chart2Height}
            heightCropTop={Math.ceil((chart1Height - chart2Height) * 0.5)}
            heightCropBottom={Math.ceil((chart1Height - chart2Height) * 0.5)}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={1}
            timeRange={timeRange}
          />
        </>
      )}

      {/* Last updated time */}
      <UpdatedTime isRealtime={isRealtime} lastUpdateTime={lastUpdateTime} />
    </div>
  )
}
