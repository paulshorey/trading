'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { IChartApi, LineData, Time, ISeriesApi } from 'lightweight-charts'
import { StrengthRowGet, strengthGets } from '@apps/common/sql/strength'

// Local lib imports
import { convertToChartData, calculateTimeRange } from './lib/chartUtils'
import {
  applyTimeRangeToAllCharts,
  applyCursorToAllCharts,
  handleWindowResize,
} from './lib/chartSync'

// Local component imports
import ChartControls from './components/ChartControls'
import SingleChart, { SingleChartRef } from './components/SingleChart'
import { LoadingState, ErrorState } from './components/ChartStates'

interface StrengthChartsSyncedProps {
  width?: number
  height?: number
  tickers?: string[]
  control_interval?: string
}

/**
 * This component fetches data for several trading tickers and displays their relative strength on charts.
 * All charts are synchronized to the same time range and selected time.
 * When a point on one chart is hovered, the crosshair is moved to this same time on all charts.
 */
export default function StrengthChartsSynced({
  width = 1280,
  height = 300,
  tickers = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD'],
  control_interval = '3',
}: StrengthChartsSyncedProps) {
  // Chart refs
  const chartComponentRefs = useRef<(SingleChartRef | null)[]>([])
  const isUpdatingCursor = useRef(false)

  // State
  const [loadingState, setLoadingState] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [allChartsData, setAllChartsData] = useState<(LineData[] | null)[]>(
    new Array(tickers.length).fill(null)
  )
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>(
    new Array(tickers.length).fill(null)
  )

  // Time controls
  const [timeRange, setTimeRange] = useState<{ from: Time; to: Time } | null>(
    null
  )
  const [hoursBack, setHoursBack] = useState<number>(48)
  const [cursorTime, setCursorTime] = useState<Time | null>(null)

  // Initialize refs arrays
  useEffect(() => {
    chartComponentRefs.current = new Array(tickers.length).fill(null)
  }, [tickers.length])

  // Load data for each ticker (only on mount or when tickers/interval changes)
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Fetch data for each ticker separately
        const allTickerData: (StrengthRowGet[] | null)[] = []
        const allChartData: (LineData[] | null)[] = []
        let latestOverallTime = 0
        let earliestOverallTime = Infinity

        for (let i = 0; i < tickers.length; i++) {
          const ticker = tickers[i]!
          const { rows, error } = await strengthGets({
            where: { ticker },
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
          const chartData = convertToChartData(rows, control_interval)
          allChartData.push(chartData.length > 0 ? chartData : null)

          // Track overall time range across all tickers
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

        // Set initial time range based on the overall data range
        if (latestOverallTime > 0 && earliestOverallTime < Infinity) {
          const hoursBackInSeconds = hoursBack * 60 * 60
          const startTime = Math.max(
            earliestOverallTime,
            latestOverallTime - hoursBackInSeconds
          )
          setTimeRange({
            from: startTime as Time,
            to: latestOverallTime as Time,
          })
        }
      } catch (err) {
        console.error('Error loading chart data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoadingState(false)
      }
    }

    loadAllData()
  }, []) // Only run once on mount - removed hoursBack, tickers, and control_interval

  // Update time range when hours back changes
  useEffect(() => {
    const newRange = calculateTimeRange(rawData, hoursBack)
    if (newRange) {
      setTimeRange(newRange)
    }
  }, [hoursBack, rawData])

  // Apply time range changes to all charts
  useEffect(() => {
    const chartRefs = chartComponentRefs.current
      .map((ref) => ref?.chart)
      .filter(Boolean) as IChartApi[]

    applyTimeRangeToAllCharts(chartRefs, timeRange)
  }, [timeRange])

  // Apply cursor position changes to all charts
  useEffect(() => {
    const chartRefs = chartComponentRefs.current
      .map((ref) => ref?.chart)
      .filter(Boolean) as IChartApi[]

    const seriesRefs = chartComponentRefs.current
      .map((ref) => ref?.series)
      .filter(Boolean) as ISeriesApi<'Line'>[]

    applyCursorToAllCharts(
      cursorTime,
      chartRefs,
      seriesRefs,
      allChartsData,
      rawData,
      control_interval,
      isUpdatingCursor
    )
  }, [cursorTime, allChartsData, rawData, control_interval])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const chartRefs = chartComponentRefs.current
        .map((ref) => ref?.chart)
        .filter(Boolean) as IChartApi[]

      const containerRefs = chartComponentRefs.current
        .map((ref) => ref?.container)
        .filter(Boolean) as HTMLDivElement[]

      handleWindowResize(chartRefs, containerRefs)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Crosshair move handler - memoized to prevent SingleChart re-renders
  const handleCrosshairMove = useCallback((time: Time | null) => {
    if (!isUpdatingCursor.current) {
      setCursorTime(time)
    }
  }, []) // No dependencies needed as isUpdatingCursor is a ref

  // Hours back change handler - memoized to prevent ChartControls re-renders
  const handleHoursBackChange = useCallback((hours: number) => {
    setHoursBack(hours)
  }, []) // No dependencies needed as setHoursBack is stable

  return (
    <div className="mx-auto w-full">
      {/* Master Controls */}
      <ChartControls
        hoursBack={hoursBack}
        onHoursBackChange={handleHoursBackChange}
      />

      {/* Show loading or error state for all charts */}
      {loadingState && <LoadingState />}
      {error && !loadingState && <ErrorState error={error} />}

      {/* Render all charts stacked vertically */}
      {!loadingState &&
        !error &&
        tickers.map((ticker, index) => (
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
          />
        ))}
    </div>
  )
}
