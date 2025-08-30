'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { LineData, Time, ISeriesApi } from 'lightweight-charts'
import { StrengthRowGet, strengthGets } from '@apps/common/sql/strength'

import { convertToChartData, calculateTimeRange } from './lib/chartUtils'
import { applyCursorToAllCharts } from './lib/chartSync'

import ChartControls, {
  intervalsOptions,
  tickersOptions,
} from './components/ChartControls'
import SingleChart, { SingleChartRef } from './components/SingleChart'
import { LoadingState, ErrorState } from './components/ChartStates'

export interface SyncedChartsProps {
  width: number
  height: number
}

/**
 * Inner component that renders charts with specific dimensions
 */
export function SyncedCharts({ width, height }: SyncedChartsProps) {
  // Chart refs
  const chartComponentRefs = useRef<(SingleChartRef | null)[]>([])
  const isUpdatingCursor = useRef(false)

  // State
  const [loadingState, setLoadingState] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Time controls
  const [timeRange, setTimeRange] = useState<{ from: Time; to: Time } | null>(
    null
  )
  const [hoursBack, setHoursBack] = useState<number>(60) // Default to 60 hours
  const [cursorTime, setCursorTime] = useState<Time | null>(null)

  // Control Interval list
  const [controlInterval, setControlInterval] = useState<string[]>(
    intervalsOptions[intervalsOptions.length - 1]!.value
  )
  const handleControlIntervalChange = useCallback((intervals: string[]) => {
    setControlInterval(intervals)
  }, [])

  // Control Ticker list
  const [controlTickers, setControlTickers] = useState<string[]>(
    tickersOptions[tickersOptions.length - 1]!.value
  )
  const handleControlTickersChange = useCallback((tickers: string[]) => {
    setControlTickers(tickers)
  }, [])

  // Initialize refs arrays
  const [allChartsData, setAllChartsData] = useState<(LineData[] | null)[]>(
    new Array(controlTickers.length).fill(null)
  )
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>(
    new Array(controlTickers.length).fill(null)
  )
  useEffect(() => {
    chartComponentRefs.current = new Array(controlTickers.length).fill(null)
  }, [controlTickers.length])

  // Load data for each ticker (only on mount or when tickers/interval changes)
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Fetch data for each ticker separately
        const allTickerData: (StrengthRowGet[] | null)[] = []
        const allChartData: (LineData[] | null)[] = []
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
            allChartData.push(null)
            continue
          }

          if (!rows || rows.length === 0) {
            console.warn(`No data found for ${ticker}`)
            allTickerData.push(null)
            allChartData.push(null)
            continue
          }

          // Reverse to get chronological order
          rows.reverse()

          // Store raw data for this ticker
          allTickerData.push(rows)

          // Convert to chart data
          const chartData = convertToChartData(rows, controlInterval) // Use default single interval for initial load
          allChartData.push(chartData.length > 0 ? chartData : null)

          // Track overall time range across all charts
          if (rows.length > 0) {
            const firstTime = rows[0]!.timenow.getTime() / 1000
            const lastTime = rows[rows.length - 1]!.timenow.getTime() / 1000
            earliestOverallTime = Math.min(earliestOverallTime, firstTime)
            latestOverallTime = Math.max(latestOverallTime, lastTime)
          }
        }

        // Store all data
        setRawData(allTickerData)
        setAllChartsData(allChartData)
        setError(null)
        setLoadingState(false)

        // Don't set time range here - let the dedicated useEffect handle it
        // based on hoursBack and rawData
      } catch (err) {
        console.error('Error loading chart data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoadingState(false)
      }
    }

    loadAllData()
  }, [controlTickers]) // Run once on mount, then when controlTickers changes

  // Recalculate chart data when controlInterval changes
  useEffect(() => {
    if (rawData.some((data) => data !== null)) {
      const newChartData = rawData.map((tickerData) => {
        if (!tickerData) return null
        const chartData = convertToChartData(tickerData, controlInterval) // Now correctly using the array
        return chartData.length > 0 ? chartData : null
      })
      setAllChartsData(newChartData)
    }
  }, [controlInterval, rawData])

  // Update time range when hours back changes
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, hoursBack)
    if (newRange) {
      setTimeRange(newRange)
    }
  }, [hoursBack, rawData])

  // Apply cursor position changes to all charts
  useEffect(() => {
    const chartRefs = chartComponentRefs.current
      .map((ref) => ref?.chart)
      .filter(Boolean)

    const seriesRefs = chartComponentRefs.current
      .map((ref) => ref?.series)
      .filter(Boolean) as ISeriesApi<'Line'>[]

    applyCursorToAllCharts(
      cursorTime,
      chartRefs,
      seriesRefs,
      allChartsData,
      rawData,
      controlInterval, // Now passing the array
      isUpdatingCursor
    )
  }, [cursorTime, allChartsData, rawData, controlInterval])

  // Dimension changes are now handled directly in SingleChart via props

  // Crosshair move handler - memoized to prevent SingleChart re-renders
  const handleCrosshairMove = useCallback((time: Time | null) => {
    if (!isUpdatingCursor.current) {
      setCursorTime(time)
    }
  }, [])

  // Hours back change handler - memoized to prevent ChartControls re-renders
  const handleHoursBackChange = useCallback((hours: number) => {
    setHoursBack(hours)
  }, [])

  return (
    <div className="pr-[10px] w-full">
      {/* Master Controls */}
      <ChartControls
        hoursBack={hoursBack}
        onHoursBackChange={handleHoursBackChange}
        controlInterval={controlInterval}
        onControlIntervalChange={handleControlIntervalChange}
        controlTickers={controlTickers}
        onControlTickersChange={handleControlTickersChange}
      />

      {/* Show loading or error state for all charts */}
      {loadingState && <LoadingState />}
      {error && !loadingState && <ErrorState error={error} />}

      {/* Render all charts stacked vertically */}
      {!loadingState &&
        !error &&
        controlTickers.map((ticker, index) => (
          <SingleChart
            key={ticker}
            ref={(el) => {
              chartComponentRefs.current[index] = el
            }}
            ticker={ticker}
            chartData={allChartsData[index] || null}
            width={width}
            height={height}
            onCrosshairMove={handleCrosshairMove}
            chartIndex={index}
            timeRange={timeRange}
          />
        ))}
    </div>
  )
}
