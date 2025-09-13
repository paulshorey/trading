'use client'

import { useEffect, useRef } from 'react'
import { Time, ISeriesApi } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'

import {
  calculateTimeRange,
  aggregateStrengthData,
  getSingleTickerPriceData,
  aggregatePriceData,
} from './lib/chartUtils'
import { applyCursorToAllCharts } from './lib/chartSync'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { useChartControlsStore } from './state/useChartControlsStore'
import { AVERAGE_LABEL, CHART_WIDTH } from './constants'
import PriceControl from './controls/PriceControl'
import StrengthControl from './controls/StrengthControl'

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
  } = useChartControlsStore()

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
        priceTicker === AVERAGE_LABEL
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
    const newRange = calculateTimeRange(rawData, parseInt(hoursBack))
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

  // Crosshair move handler
  const handleCrosshairMove = (time: Time | null) => {
    if (!isUpdatingCursor.current) {
      setCursorTime(time)
    }
  }

  const loadingState = aggregatedStrengthData?.length === 0

  const chart1Height =
    Math.ceil((availableHeight * 1) / 2) + availableHeightCrop
  const chart2Height =
    Math.ceil((availableHeight * 1) / 2) - availableHeightCrop

  return (
    <div className={`overflow-hidden`} style={{ width: CHART_WIDTH + 'px' }}>
      {/* Show loading or error state for all charts */}
      {loadingState && <LoadingState />}
      {error && !loadingState && <ErrorState error={error} />}

      {/* Render 2 aggregated charts */}
      {!loadingState && !error && (
        <>
          {/* Chart: Aggregated Strength (average of all interval averages) */}
          <Chart
            key="aggregated-strength"
            ref={(el) => {
              chartComponentRefs.current[0] = el
            }}
            name={`Strength`}
            heading={
              <span className="flex flex-row pl-[9px]">
                {/* <span className="pt-1 pr-1 opacity-50 text-sm">
                  Strength of
                </span> */}
                <StrengthControl showLabel={false} />
                <span
                  className="pt-1 pr-1 pl-1 opacity-60 text-sm"
                  // style={{
                  //   textShadow: '0 0 1px rgba(0, 0, 0, 0.05)',
                  // }}
                >
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

          {/* Chart: Single Ticker Price */}
          <Chart
            key={`price-${priceTicker}`}
            ref={(el) => {
              chartComponentRefs.current[1] = el
            }}
            name={`Price`}
            chartData={aggregatedPriceData}
            heading={
              <span className="flex flex-row pl-[5px]">
                {/* <span className="pt-1 pr-1 opacity-50 text-sm">Price of</span> */}
                <PriceControl showLabel={false} />
                <span className="pt-1 pr-1 pl-1 opacity-60 text-sm">Price</span>
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
    </div>
  )
}
