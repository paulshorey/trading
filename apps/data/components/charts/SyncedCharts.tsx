'use client'

import { useEffect, useRef, useMemo } from 'react'
import { Time, ISeriesApi } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'

import {
  calculateTimeRange,
  aggregateStrengthData,
  getSingleTickerPriceData,
  aggregatePriceData,
} from './lib/chartUtils'
import { applyCursorToAllCharts } from './lib/chartSync'

import Header from './controls/Header'
import SingleChart, { SingleChartRef } from './components/SingleChart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { useChartControlsStore } from './state/useChartControlsStore'
import StrengthControl from './controls/StrengthControl'
import PriceControl from './controls/PriceControl'
import IntervalControl from './controls/IntervalControl'
import TimeControl from './controls/TimeControl'

export interface SyncedChartsProps {
  availableWidth: number
  availableHeight: number
}

/**
 * Inner component that renders charts with specific dimensions
 */
export function SyncedCharts({
  availableWidth,
  availableHeight,
}: SyncedChartsProps) {
  // Chart refs
  const chartComponentRefs = useRef<(SingleChartRef | null)[]>([])
  const isUpdatingCursor = useRef(false)

  // Get state and actions from Zustand store
  const {
    // State
    error,
    hoursBack,
    controlInterval,
    controlTickers,
    priceTicker,
    timeRange,
    cursorTime,
    rawData,
    aggregatedStrengthData,
    aggregatedPriceData,
    // Actions
    setError,
    setTimeRange,
    setCursorTime,
    setRawData,
    setAggregatedStrengthData,
    setAggregatedPriceData,
    setChartDimensions,
  } = useChartControlsStore()

  // Calculate chart dimensions based on available space for 2 charts
  const chartDimensions = useMemo(() => {
    // Width = 100% of browser width minus padding
    const chartWidth = availableWidth - 10 // 10px padding right edge

    // Height = browser height divided by 2 (for 2 charts)
    const adjustedHeight = availableHeight // make charts a bit taller to account for negative margin
    const chartHeight = Math.floor(adjustedHeight / 2) // Always 2 charts

    const dimensions = {
      width: Math.max(chartWidth, 320), // Minimum width of 320px
      height: Math.max(chartHeight, 200), // Minimum height of 200px per chart
    }

    return dimensions
  }, [availableWidth, availableHeight])

  // Update dimensions in store when they change
  useEffect(() => {
    setChartDimensions(chartDimensions)
  }, [chartDimensions, setChartDimensions])

  // Always have exactly 2 chart refs (one for strength, one for price)
  useEffect(() => {
    chartComponentRefs.current = new Array(2).fill(null)
  }, [])

  /**
   * Data Loading Effect
   *
   * This effect runs whenever the selected tickers change (controlTickers).
   * It fetches the last 60 hours of strength data for each selected ticker.
   *
   * Note: We always fetch 60 hours regardless of the hoursBack setting.
   * The hoursBack parameter only controls the visible time range, not the data fetched.
   * This allows users to quickly zoom in/out without re-fetching data.
   */
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Fetch data for each ticker separately
        const allTickerData: (StrengthRowGet[] | null)[] = []
        let latestOverallTime = 0
        let earliestOverallTime = Infinity

        for (let i = 0; i < controlTickers.length; i++) {
          const ticker = controlTickers[i]!

          // This provides data for all possible hoursBack values without re-fetching
          const maxDataHours = 240
          const date_gt = new Date(Date.now() - maxDataHours * 60 * 60 * 1000)
          date_gt.setSeconds(0, 0) // Sets seconds and milliseconds to 0
          const minutes = date_gt.getMinutes()
          if (minutes % 2 !== 0) {
            date_gt.setMinutes(minutes - 1) // Round down to previous even minute
          }
          const where = { ticker, timenow_gt: date_gt }

          // Build query parameters for GET request
          const params = new URLSearchParams()
          if (where.ticker) params.append('ticker', where.ticker)
          if (where.timenow_gt)
            params.append('timenow_gt', where.timenow_gt.toISOString())

          const apiUrl = `/api/v1/strength?${params.toString()}`

          const response = await fetch(apiUrl, {
            method: 'GET',
          })
          const data = await response.json()

          let rows = data.rows
          const error = data.error ? { message: data.error } : null

          // Convert date strings back to Date objects
          if (rows && rows.length > 0) {
            rows = rows.map((row: any) => ({
              ...row,
              timenow: new Date(row.timenow),
              created_at: new Date(row.created_at),
            }))
          }

          if (error) {
            console.error(`Error loading data for ${ticker}:`, error)
            allTickerData.push(null)
            continue
          }

          if (!rows || rows.length === 0) {
            console.warn(`No data found for ${ticker}`)
            allTickerData.push(null)
            continue
          }

          // Reverse to get chronological order
          rows.reverse()

          // Store raw data for this ticker
          allTickerData.push(rows)

          // Track overall time range across all charts
          if (rows.length > 0) {
            const firstTime = rows[0]!.timenow.getTime() / 1000
            const lastTime = rows[rows.length - 1]!.timenow.getTime() / 1000
            earliestOverallTime = Math.min(earliestOverallTime, firstTime)
            latestOverallTime = Math.max(latestOverallTime, lastTime)
          }
        }

        // Store raw data in the store
        setRawData(allTickerData)
        setError(null)
      } catch (err) {
        console.error('Error loading chart data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      }
    }

    // Only load data if we have tickers selected
    if (controlTickers.length > 0) {
      loadAllData()
    }
  }, [controlTickers])

  /**
   * Data Aggregation Effect
   *
   * This effect recalculates the aggregated chart data whenever:
   * - rawData changes (new data fetched)
   * - controlInterval changes (different intervals selected for averaging)
   * - priceTicker changes (different ticker selected for price chart)
   * - controlTickers changes (needed to find the right price data)
   *
   * The aggregation creates two data series:
   * 1. Strength data: average of selected intervals across all selected tickers
   * 2. Price data: Either individual ticker price or normalized average of all prices
   */
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      const strengthData = aggregateStrengthData(rawData, controlInterval)

      // Choose between individual ticker price or average of all prices
      const priceData =
        priceTicker === 'average'
          ? aggregatePriceData(rawData)
          : getSingleTickerPriceData(rawData, controlTickers, priceTicker)

      setAggregatedStrengthData(strengthData.length > 0 ? strengthData : null)
      setAggregatedPriceData(priceData.length > 0 ? priceData : null)
    }
  }, [controlInterval, priceTicker, rawData, controlTickers])

  /**
   * Time Range Effect
   *
   * Updates the visible time range when:
   * - hoursBack changes (user selects different time range)
   * - rawData changes (new data with different time bounds)
   * This only affects the visible portion of the charts, not the data itself.
   */
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, hoursBack)
    if (newRange) {
      setTimeRange(newRange)
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

  // Dimension changes are now handled directly in SingleChart via props

  // Crosshair move handler
  const handleCrosshairMove = (time: Time | null) => {
    if (!isUpdatingCursor.current) {
      setCursorTime(time)
    }
  }

  const loadingState = aggregatedStrengthData?.length === 0

  return (
    <div className="pr-[10px] w-full">
      {/* Master Controls */}
      <Header />

      {/* Show loading or error state for all charts */}
      {loadingState && <LoadingState />}
      {error && !loadingState && <ErrorState error={error} />}

      {/* Render 2 aggregated charts */}
      {!loadingState && !error && (
        <>
          {/* Chart: Aggregated Strength (average of all interval averages) */}
          <SingleChart
            key="aggregated-strength"
            ref={(el) => {
              chartComponentRefs.current[0] = el
            }}
            name={`Strength`}
            heading={null}
            chartData={aggregatedStrengthData}
            width={chartDimensions.width}
            height={chartDimensions.height}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={0}
            timeRange={timeRange}
            showZeroLine={true}
          />

          {/* Chart: Single Ticker Price */}
          <SingleChart
            key={`price-${priceTicker}`}
            ref={(el) => {
              chartComponentRefs.current[1] = el
            }}
            name={`Price`}
            chartData={aggregatedPriceData}
            heading={
              <span className="ml-2 flex">
                <span className="flex flex-row">
                  {/* <span
                    className="pt-[1.5px] opacity-60"
                    style={{
                      scale: '0.9 1',
                      transformOrigin: 'left',
                      filter: 'brightness(1.3) contrast(1.2)',
                    }}
                  >
                    🦾
                  </span> */}
                  <StrengthControl showLabel={false} />
                </span>
                <span className="flex flex-row">
                  <span
                    className="pt-[1.5px] pl-[3px] opacity-50"
                    style={{
                      filter: 'brightness(1.5) contrast(1.2)',
                      scale: '0.9 1',
                      transformOrigin: 'right',
                    }}
                  >
                    💲
                  </span>
                  <PriceControl showLabel={false} />
                </span>
                <span className="flex flex-row">
                  <span
                    className="pt-[2px] pl-[5px] pr-[3px] opacity-80"
                    style={{
                      filter: 'contrast(0.6) brightness(1.3)',
                    }}
                  >
                    🕓
                  </span>
                  <IntervalControl showLabel={false} />
                </span>
                <span className="flex flex-row">
                  <span
                    className="pt-[2px] pl-[6px] pr-[2px] opacity-70"
                    style={{
                      filter: 'saturate(0.1) contrast(1.1)',
                    }}
                  >
                    🗓️
                  </span>
                  <TimeControl showLabel={false} />
                </span>
              </span>
            }
            width={chartDimensions.width}
            height={chartDimensions.height}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={1}
            timeRange={timeRange}
          />
        </>
      )}
    </div>
  )
}
