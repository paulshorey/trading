'use client'

import { useEffect, useRef, useMemo } from 'react'
import { Time, ISeriesApi } from 'lightweight-charts'
import { StrengthRowGet, strengthGets } from '@apps/common/sql/strength'

import {
  calculateTimeRange,
  aggregateStrengthData,
  getSingleTickerPriceData,
} from './lib/chartUtils'
import { applyCursorToAllCharts } from './lib/chartSync'

import Header from './controls/Header'
import SingleChart, { SingleChartRef } from './components/SingleChart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { useChartControlsStore } from './state/useChartControlsStore'
import StrengthControl from './controls/StrengthControl'
import PriceControl from './controls/PriceControl'

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
    loadingState,
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
    setLoadingState,
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

  // Load data for each ticker when tickers change
  useEffect(() => {
    const loadAllData = async () => {
      try {
        setLoadingState(true)

        // Fetch data for each ticker separately
        const allTickerData: (StrengthRowGet[] | null)[] = []
        let latestOverallTime = 0
        let earliestOverallTime = Infinity

        for (let i = 0; i < controlTickers.length; i++) {
          const ticker = controlTickers[i]!

          // Always fetch 60 hours of data (max range we support)
          const maxDataHours = 60
          const date = new Date(Date.now() - maxDataHours * 60 * 60 * 1000)
          date.setSeconds(0, 0) // Sets seconds and milliseconds to 0
          const minutes = date.getMinutes()
          if (minutes % 2 !== 0) {
            date.setMinutes(minutes - 1) // Round down to previous even minute
          }

          const timenow_gt = date
          const { rows, error } = await strengthGets({
            where: { ticker, timenow_gt },
          })

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

        // Store raw data
        setRawData(allTickerData)
        setError(null)
        setLoadingState(false)
      } catch (err) {
        console.error('Error loading chart data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoadingState(false)
      }
    }

    loadAllData()
  }, [controlTickers]) // Only run when tickers change

  // Recalculate aggregated data when rawData, controlInterval or priceTicker changes
  useEffect(() => {
    if (rawData.length > 0 && rawData.some((data) => data !== null)) {
      const strengthData = aggregateStrengthData(rawData, controlInterval)
      const priceData = getSingleTickerPriceData(
        rawData,
        controlTickers,
        priceTicker
      )
      setAggregatedStrengthData(strengthData.length > 0 ? strengthData : null)
      setAggregatedPriceData(priceData.length > 0 ? priceData : null)
    }
  }, [controlInterval, priceTicker, rawData, controlTickers])

  // Update time range when hours back changes
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, hoursBack)
    if (newRange) {
      setTimeRange(newRange)
    }
  }, [hoursBack, rawData])

  // Apply cursor position changes to both charts
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
          {/* Chart 1: Aggregated Strength (average of all interval averages) */}
          <SingleChart
            key="aggregated-strength"
            ref={(el) => {
              chartComponentRefs.current[0] = el
            }}
            name={`Strength`}
            heading={<StrengthControl />}
            chartData={aggregatedStrengthData}
            width={chartDimensions.width}
            height={chartDimensions.height}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={0}
            timeRange={timeRange}
          />

          {/* Chart 2: Single Ticker Price */}
          <SingleChart
            key={`price-${priceTicker}`}
            ref={(el) => {
              chartComponentRefs.current[1] = el
            }}
            name={`Price`}
            heading={<PriceControl />}
            chartData={aggregatedPriceData}
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
