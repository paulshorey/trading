'use client'

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useStrengthData } from './lib/data/useStrengthData'
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
import { LineData, Time } from 'lightweight-charts'

export interface SyncedChartsProps {
  availableHeight: number
  availableHeightCrop: number
}

/**
 * Generate a hash of rawData to detect meaningful changes
 * Includes timestamps AND sample values from recent data
 * This prevents re-aggregation when only old historical data exists
 */
function getRawDataHash(rawData: unknown[]): string {
  if (!rawData || rawData.length === 0) return 'empty'

  let hash = `len:${rawData.length}`
  for (const tickerData of rawData) {
    if (!tickerData || !Array.isArray(tickerData)) {
      hash += '|null'
      continue
    }
    const arr = tickerData as { timenow: Date; price?: number }[]
    const len = arr.length
    const first = arr[0]?.timenow?.getTime() || 0
    const last = arr[len - 1]?.timenow?.getTime() || 0

    // Also include the price of the last few rows to detect value changes
    // (not just timestamp changes)
    let recentPriceHash = ''
    for (let i = Math.max(0, len - 5); i < len; i++) {
      const price = arr[i]?.price || 0
      recentPriceHash += `:${price.toFixed(2)}`
    }

    hash += `|${len}:${first}:${last}${recentPriceHash}`
  }
  return hash
}

/**
 * Generate a cache key for aggregated results
 * Based on tickers and intervals (not data content)
 * IMPORTANT: Use spread operator to avoid mutating the original arrays!
 */
function getAggregationCacheKey(
  tickers: string[],
  intervals: string[]
): string {
  return `${[...tickers].sort().join(',')}|${[...intervals].sort().join(',')}`
}

// Cache for aggregated results - survives ticker switches
// Keyed by ticker+interval combination
type AggregationCache = Map<
  string,
  {
    strength: LineData<Time>[] | null
    price: LineData<Time>[] | null
    intervalStrength: Record<string, LineData<Time>[]>
    tickerPrice: Record<string, LineData<Time>[]>
    timestamp: number // When this was cached
  }
>

// Module-level cache (persists across component re-renders)
const aggregationCache: AggregationCache = new Map()
const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes cache validity

/**
 * SyncedCharts - Main chart component with controlled data flow
 *
 * Data Flow:
 * 1. User selects tickers → dataState = 'loading', dataVersion++
 * 2. Historical data fetched → send to worker with dataVersion
 * 3. Worker returns aggregated data → validate dataVersion → render chart
 * 4. Real-time updates poll every 10s → debounced worker updates
 *
 * Performance Optimizations:
 * - Uses refs for processing state to avoid effect re-triggers
 * - Debounces rapid data changes (500ms minimum between aggregations)
 * - Skips aggregation if rawData hash hasn't changed
 *
 * Race Condition Prevention:
 * - dataVersion is tied to the data source (tickers)
 * - Worker results include dataVersion
 * - Results with stale dataVersion are ignored
 */
// Time in ms to wait after user stops scrolling before resuming polling
const SCROLL_PAUSE_RESUME_MS = 30000

export function SyncedCharts({ availableHeight }: SyncedChartsProps) {
  const chartRef = useRef<ChartRef | null>(null)

  // Polling pause state - paused when user is scrolling/panning the chart
  const [pollingPaused, setPollingPaused] = useState(false)
  const scrollResumeTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Zustand store
  const {
    hoursBack,
    interval,
    chartTickers,
    timeRange,
    setTimeRange,
    setAggregatedStrengthData,
    setAggregatedPriceData,
    setIntervalStrengthData,
    setTickerPriceData,
  } = useChartControlsStore()

  // Local state for chart rendering control
  const [chartData, setChartData] = useState<{
    strength: LineData<Time>[] | null
    price: LineData<Time>[] | null
    intervalStrength: Record<string, LineData<Time>[]>
    tickerPrice: Record<string, LineData<Time>[]>
  }>({
    strength: null,
    price: null,
    intervalStrength: {},
    tickerPrice: {},
  })

  // Track which dataVersion the current chartData corresponds to
  const chartDataVersionRef = useRef<number>(-1)

  // Refs for aggregation control (using refs to avoid effect re-triggers)
  const isProcessingRef = useRef(false)
  const lastAggregationTimeRef = useRef(0)
  const lastRawDataHashRef = useRef('')
  const pendingAggregationRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Handle user scroll/pan on chart
   * Pauses real-time polling while user is interacting with the chart.
   * After 30 seconds of no scrolling, polling resumes automatically.
   */
  const handleUserScroll = useCallback(() => {
    // Clear any existing resume timer
    if (scrollResumeTimerRef.current) {
      clearTimeout(scrollResumeTimerRef.current)
    }

    // Pause polling if not already paused
    if (!pollingPaused) {
      setPollingPaused(true)
      console.log('[SyncedCharts] User scrolling - polling paused')
    }

    // Set timer to resume polling after inactivity
    scrollResumeTimerRef.current = setTimeout(() => {
      console.log('[SyncedCharts] Scroll inactivity - resuming polling')
      setPollingPaused(false)
      scrollResumeTimerRef.current = null
    }, SCROLL_PAUSE_RESUME_MS)
  }, [pollingPaused])

  // Cleanup scroll timer on unmount
  useEffect(() => {
    return () => {
      if (scrollResumeTimerRef.current) {
        clearTimeout(scrollResumeTimerRef.current)
      }
    }
  }, [])

  /**
   * Controlled data fetching hook
   * Handles ticker changes, loading state, and real-time updates
   * Paused when user is scrolling/panning the chart
   */
  const { rawData, dataState, error, lastUpdateTime, dataVersion } =
    useStrengthData({
      tickers: chartTickers,
      enabled: chartTickers.length > 0,
      maxDataHours: HOURS_BACK_INITIAL,
      updateIntervalMs: 10000,
      paused: pollingPaused,
    })

  /**
   * Handle aggregation results from the Web Worker
   * Only accepts results where dataVersion matches current
   * Caches results for instant ticker switching
   */
  const handleAggregationResult = useCallback(
    (
      result: AggregationResult,
      processingTimeMs: number,
      resultDataVersion: number
    ) => {
      // Mark processing as complete (use ref to avoid re-triggering effects)
      isProcessingRef.current = false
      lastAggregationTimeRef.current = Date.now()

      // Double-check: only update if this is for the current data version
      // (The worker hook already filters, but this is an extra safety check)
      if (resultDataVersion < chartDataVersionRef.current) {
        return
      }

      // Update the version this chart data corresponds to
      chartDataVersionRef.current = resultDataVersion

      // Update local chart data
      const newChartData = {
        strength: result.strengthData,
        price: result.priceData,
        intervalStrength: result.intervalStrengthData,
        tickerPrice: result.tickerPriceData,
      }

      setChartData(newChartData)

      // Cache the results for instant ticker switching
      const cacheKey = getAggregationCacheKey(chartTickers, interval)
      aggregationCache.set(cacheKey, {
        ...newChartData,
        timestamp: Date.now(),
      })

      // Limit cache size to prevent memory leaks (keep last 10 combinations)
      if (aggregationCache.size > 10) {
        const oldestKey = aggregationCache.keys().next().value
        if (oldestKey) aggregationCache.delete(oldestKey)
      }

      // Also update store for any external consumers
      setAggregatedStrengthData(result.strengthData)
      setAggregatedPriceData(result.priceData)
      setIntervalStrengthData(result.intervalStrengthData)
      setTickerPriceData(result.tickerPriceData)

      if (processingTimeMs > 100) {
        console.log(
          `[Worker] Aggregation v${resultDataVersion} completed in ${processingTimeMs.toFixed(
            1
          )}ms`
        )
      }
    },
    [
      chartTickers,
      interval,
      setAggregatedStrengthData,
      setAggregatedPriceData,
      setIntervalStrengthData,
      setTickerPriceData,
    ]
  )

  const handleAggregationError = useCallback((errorMsg: string) => {
    console.error('[Worker] Aggregation error:', errorMsg)
    isProcessingRef.current = false
  }, [])

  /**
   * Web Worker for aggregation
   * Note: We don't use isProcessing from the hook - we use our own ref
   * to avoid re-triggering effects when processing state changes
   */
  const { aggregate, isReady, setValidDataVersion } = useAggregationWorker({
    enabled: true,
    onResult: handleAggregationResult,
    onError: handleAggregationError,
  })

  /**
   * Effect: When dataVersion changes (ticker switch), immediately clear chart
   * and update the valid version so old worker results are ignored.
   */
  useEffect(() => {
    // Set the valid version - any results with older version will be ignored
    setValidDataVersion(dataVersion)

    // Cancel any pending aggregation timeouts
    if (pendingAggregationRef.current) {
      clearTimeout(pendingAggregationRef.current)
      pendingAggregationRef.current = null
    }

    // Reset processing state - the old aggregation's result will be ignored
    // so we need to allow new aggregations to start
    isProcessingRef.current = false

    // Reset the raw data hash so new data will trigger aggregation
    lastRawDataHashRef.current = ''

    // Reset debounce timer so initial load is fast
    lastAggregationTimeRef.current = 0

    // Clear chart data immediately when version changes
    // This prevents showing old data while new data loads
    if (chartDataVersionRef.current !== dataVersion) {
      setChartData({
        strength: null,
        price: null,
        intervalStrength: {},
        tickerPrice: {},
      })

      // Clear store data too
      setAggregatedStrengthData(null)
      setAggregatedPriceData(null)
      setIntervalStrengthData({})
      setTickerPriceData({})
    }
  }, [
    dataVersion,
    setValidDataVersion,
    setAggregatedStrengthData,
    setAggregatedPriceData,
    setIntervalStrengthData,
    setTickerPriceData,
  ])

  /**
   * Effect: Load from cache when ticker/interval changes
   * Provides instant display while fresh data is being fetched
   */
  useEffect(() => {
    if (dataState !== 'ready') return

    const cacheKey = getAggregationCacheKey(chartTickers, interval)
    const cached = aggregationCache.get(cacheKey)

    if (cached) {
      const age = Date.now() - cached.timestamp
      if (age < CACHE_MAX_AGE_MS) {
        // Use cached data immediately for instant display
        // Fresh aggregation will update this shortly
        if (chartData.strength === null) {
          setChartData({
            strength: cached.strength,
            price: cached.price,
            intervalStrength: cached.intervalStrength,
            tickerPrice: cached.tickerPrice,
          })
        }
      } else {
        // Cache expired, remove it
        aggregationCache.delete(cacheKey)
      }
    }
  }, [chartTickers, interval, dataState]) // Only when tickers/intervals change

  /**
   * Effect: Process data through worker when rawData changes
   *
   * Performance optimizations:
   * - Uses refs for processing state (not in dependency array)
   * - Debounces rapid changes with 2000ms minimum interval (real-time data is 10s)
   * - Skips if rawData hash hasn't changed (includes value comparison)
   * - Caches results for instant ticker switching
   */
  useEffect(() => {
    // Don't process if still loading or no data
    if (dataState !== 'ready') return
    if (rawData.length === 0 || !rawData.some((data) => data !== null)) return
    if (!isReady) return

    // Check if rawData actually changed (by comparing hashes including values)
    const currentHash = getRawDataHash(rawData)
    if (currentHash === lastRawDataHashRef.current) {
      return
    }

    // Clear any pending aggregation
    if (pendingAggregationRef.current) {
      clearTimeout(pendingAggregationRef.current)
      pendingAggregationRef.current = null
    }

    // Function to actually trigger aggregation
    const triggerAggregation = () => {
      // Don't queue up requests if already processing
      if (isProcessingRef.current) {
        // Schedule retry after a short delay
        pendingAggregationRef.current = setTimeout(triggerAggregation, 500)
        return
      }

      // Update hash and mark as processing
      lastRawDataHashRef.current = currentHash
      isProcessingRef.current = true

      // Send to worker for aggregation with the current dataVersion
      aggregate(rawData, interval, chartTickers, dataVersion)
    }

    // Debounce: 2000ms for real-time updates (data comes every 10s, no need for faster)
    // But use 100ms for initial load (when lastAggregationTime is 0)
    const timeSinceLastAggregation = Date.now() - lastAggregationTimeRef.current
    const isInitialLoad = lastAggregationTimeRef.current === 0
    const DEBOUNCE_MS = isInitialLoad ? 100 : 2000

    if (timeSinceLastAggregation < DEBOUNCE_MS) {
      // Schedule aggregation after debounce period
      const delay = DEBOUNCE_MS - timeSinceLastAggregation
      pendingAggregationRef.current = setTimeout(triggerAggregation, delay)
    } else {
      // Execute immediately
      triggerAggregation()
    }

    // Cleanup pending timeout on unmount or dependency change
    return () => {
      if (pendingAggregationRef.current) {
        clearTimeout(pendingAggregationRef.current)
        pendingAggregationRef.current = null
      }
    }
  }, [
    rawData,
    dataState,
    interval,
    chartTickers,
    dataVersion,
    isReady,
    aggregate,
    // Note: isProcessing is NOT in dependencies - we use isProcessingRef instead
  ])

  /**
   * Effect: Calculate time range when data is ready
   */
  useEffect(() => {
    if (!chartData.strength || chartData.strength.length === 0) return

    const newRange = calculateTimeRange(rawData, parseInt(hoursBack))
    if (newRange && newRange.from < newRange.to) {
      setTimeRange(newRange)
    }
  }, [hoursBack, rawData, chartData.strength, setTimeRange])

  /**
   * Determine what to render based on state
   */
  const showLoading = dataState === 'loading'
  const showError = error && dataState !== 'loading'
  const showChart = chartData.strength !== null

  // Only pass timeRange to chart when we have valid data
  const chartTimeRange = showChart ? timeRange : undefined

  return (
    <div className="relative w-full">
      {/* Loading state - shown while fetching historical data */}
      {showLoading && <LoadingState />}

      {/* Error state */}
      {showError && <ErrorState error={error} />}

      {/* Chart - only rendered when data is ready */}
      {showChart && (
        <Chart
          key={`chart-${dataVersion}`}
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
              </span>
            </span>
          }
          strengthData={chartData.strength}
          priceData={chartData.price}
          intervalStrengthData={chartData.intervalStrength}
          tickerPriceData={chartData.tickerPrice}
          tickers={chartTickers}
          width={
            typeof window !== 'undefined'
              ? window.innerWidth * SCALE_FACTOR
              : 1200
          }
          height={availableHeight}
          timeRange={chartTimeRange}
          onUserScroll={handleUserScroll}
        />
      )}

      {/* Last updated time (shows paused indicator when user is scrolling) */}
      <UpdatedTime
        isRealtime={dataState === 'ready'}
        lastUpdateTime={lastUpdateTime}
        paused={pollingPaused}
      />

      {/* Target box for screen capture */}
      <div
        id="screenshot-target"
        className="absolute top-[34px] left-0 right-[8px] bottom-[34px] pointer-events-none"
      />
    </div>
  )
}
