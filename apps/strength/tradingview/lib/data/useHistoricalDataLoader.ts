/**
 * useHistoricalDataLoader - Hook for loading more historical data when scrolling left
 *
 * This hook monitors the chart's visible range and triggers fetches for older data
 * when the user scrolls to the left edge of existing data.
 *
 * Key features:
 * - Subscribes to chart's visible logical range changes
 * - Detects when user scrolls near the beginning of loaded data
 * - Fetches older historical data and prepends to existing data
 * - Preserves user's scroll position after loading
 * - Debounces requests to prevent excessive fetching
 * - Tracks loading state for UI feedback
 */

import { useCallback, useRef, useEffect, useState } from 'react'
import { IChartApi, LogicalRange } from 'lightweight-charts'
import { StrengthRowGet } from '@lib/common/sql/strength'
import { FetchStrengthData } from './FetchStrengthData'
import {
  HISTORICAL_LOAD_THRESHOLD,
  HISTORICAL_LOAD_HOURS,
  HISTORICAL_LOAD_DEBOUNCE_MS,
  HISTORICAL_LOAD_MAX_HOURS_BACK,
} from '../../constants'

// Time to wait after data load before restoring view position (ms)
// This needs to be long enough for:
// 1. React to re-render with new rawData
// 2. Aggregation worker to process the data
// 3. Chart component to receive and render new aggregated data
const VIEW_RESTORE_DELAY_MS = 2500

export interface UseHistoricalDataLoaderOptions {
  /** The chart instance to monitor */
  chart: IChartApi | null
  /** Current tickers being displayed */
  tickers: string[]
  /** Current raw data (to find earliest timestamp) */
  rawData: (StrengthRowGet[] | null)[]
  /** Callback to prepend new historical data */
  onHistoricalDataLoaded: (newData: (StrengthRowGet[] | null)[]) => void
  /** Whether loading is enabled */
  enabled?: boolean
}

export interface UseHistoricalDataLoaderResult {
  /** Whether historical data is currently being loaded */
  isLoadingHistory: boolean
  /** Earliest timestamp we've loaded (for UI/debugging) */
  earliestLoadedTime: Date | null
  /** How much total history has been loaded in hours */
  totalHistoryHours: number
  /** Whether we've hit the maximum history limit */
  reachedMaxHistory: boolean
}

/**
 * Hook for loading more historical data when user scrolls left
 */
export function useHistoricalDataLoader({
  chart,
  tickers,
  rawData,
  onHistoricalDataLoaded,
  enabled = true,
}: UseHistoricalDataLoaderOptions): UseHistoricalDataLoaderResult {
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [earliestLoadedTime, setEarliestLoadedTime] = useState<Date | null>(
    null
  )
  const [reachedMaxHistory, setReachedMaxHistory] = useState(false)

  // Refs for tracking state without causing re-renders
  const earliestLoadedTimeRef = useRef<Date | null>(null)
  const isFetchingRef = useRef(false)
  const lastFetchTimeRef = useRef(0)
  const subscriptionCleanupRef = useRef<(() => void) | null>(null)
  // Cooldown period after loading - ignore range changes while data propagates through React
  const cooldownUntilRef = useRef(0)

  /**
   * Calculate the earliest timestamp from current raw data
   */
  const getEarliestTimestamp = useCallback((): Date | null => {
    let earliest: Date | null = null

    for (const tickerData of rawData) {
      if (tickerData && tickerData.length > 0) {
        const firstRow = tickerData[0]
        if (firstRow && (!earliest || firstRow.timenow < earliest)) {
          earliest = firstRow.timenow
        }
      }
    }

    return earliest
  }, [rawData])

  /**
   * Calculate how many hours of history we've loaded
   */
  const getTotalHistoryHours = useCallback((): number => {
    const earliest = getEarliestTimestamp()
    if (!earliest) return 0

    const now = Date.now()
    const hours = (now - earliest.getTime()) / (1000 * 60 * 60)
    return Math.round(hours)
  }, [getEarliestTimestamp])

  /**
   * Fetch older historical data
   * Preserves user's scroll position by saving and restoring visible time range
   */
  const fetchOlderData = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return
    }

    // Debounce: don't fetch too frequently
    const now = Date.now()
    if (now - lastFetchTimeRef.current < HISTORICAL_LOAD_DEBOUNCE_MS) {
      return
    }

    // Check if we have tickers, data, and chart
    if (tickers.length === 0 || rawData.length === 0 || !chart) {
      return
    }

    // Get the earliest timestamp we currently have
    const earliestTime = getEarliestTimestamp()
    if (!earliestTime) {
      return
    }

    // Check if we've hit the max history limit
    const totalHours = getTotalHistoryHours()
    if (totalHours >= HISTORICAL_LOAD_MAX_HOURS_BACK) {
      setReachedMaxHistory(true)
      console.log(
        `[HistoricalDataLoader] Reached max history limit (${HISTORICAL_LOAD_MAX_HOURS_BACK}h)`
      )
      return
    }

    // Save current visible LOGICAL range for restoration after data load
    // We use logical range (bar indices) instead of time range because:
    // When we prepend data, all logical indices shift by the number of bars added
    // We need to offset the range to maintain the same visual position
    let savedLogicalRange: { from: number; to: number } | null = null
    try {
      const timeScale = chart.timeScale()
      const logicalRange = timeScale.getVisibleLogicalRange()
      if (logicalRange) {
        savedLogicalRange = { from: logicalRange.from, to: logicalRange.to }
      }
    } catch (err) {
      console.warn('[HistoricalDataLoader] Could not save logical range:', err)
    }

    // Mark as fetching
    isFetchingRef.current = true
    lastFetchTimeRef.current = now
    setIsLoadingHistory(true)

    try {
      // Calculate the date range to fetch
      // Fetch HISTORICAL_LOAD_HOURS before the earliest time we have
      const toDate = new Date(earliestTime.getTime())
      const fromDate = new Date(
        earliestTime.getTime() - HISTORICAL_LOAD_HOURS * 60 * 60 * 1000
      )

      console.log(
        `[HistoricalDataLoader] Fetching ${HISTORICAL_LOAD_HOURS}h of older data`,
        {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          savedLogicalRange,
        }
      )

      // Fetch the older data for all tickers
      const olderData = await FetchStrengthData.fetchMultipleTickersData(
        tickers,
        fromDate,
        toDate
      )

      // Update earliest loaded time
      let newEarliestTime: Date | null = null
      for (const tickerData of olderData) {
        if (tickerData && tickerData.length > 0) {
          const firstRow = tickerData[0]
          if (
            firstRow &&
            (!newEarliestTime || firstRow.timenow < newEarliestTime)
          ) {
            newEarliestTime = firstRow.timenow
          }
        }
      }

      if (newEarliestTime) {
        earliestLoadedTimeRef.current = newEarliestTime
        setEarliestLoadedTime(newEarliestTime)
      }

      // Count how many bars we're adding (use the max from any ticker)
      let addedBarsCount = 0
      for (const tickerData of olderData) {
        if (tickerData && tickerData.length > 0) {
          addedBarsCount = Math.max(addedBarsCount, tickerData.length)
        }
      }

      // Call the callback to prepend the data
      onHistoricalDataLoaded(olderData)

      // Set cooldown to prevent immediate re-fetch while data propagates through React
      // The cooldown is long enough for:
      // 1. React to re-render with new rawData
      // 2. Worker to process aggregation
      // 3. Chart to receive and render new data
      // 4. setVisibleLogicalRange to complete
      const COOLDOWN_MS = 5000 // 5 seconds to be safe
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS

      // Restore visible LOGICAL range after a delay to allow React to re-render
      // KEY INSIGHT: When prepending data, all logical indices shift by the number of bars added
      // So we need to OFFSET the saved range by addedBarsCount to maintain the same view
      if (savedLogicalRange && chart && addedBarsCount > 0) {
        setTimeout(() => {
          try {
            const timeScale = chart.timeScale()
            // Offset the range by the number of bars we prepended
            // This keeps the user looking at the same data they were viewing before
            const newRange = {
              from: savedLogicalRange.from + addedBarsCount,
              to: savedLogicalRange.to + addedBarsCount,
            }
            timeScale.setVisibleLogicalRange(newRange)
            console.log(
              '[HistoricalDataLoader] Restored logical range after data load',
              { savedLogicalRange, addedBarsCount, newRange }
            )
          } catch (err) {
            console.warn(
              '[HistoricalDataLoader] Could not restore logical range:',
              err
            )
          }
        }, VIEW_RESTORE_DELAY_MS)
      }

      console.log('[HistoricalDataLoader] Older data loaded successfully', {
        dataLengths: olderData.map((d) => d?.length || 0),
      })
    } catch (err) {
      console.error('[HistoricalDataLoader] Error fetching older data:', err)
    } finally {
      isFetchingRef.current = false
      setIsLoadingHistory(false)
    }
  }, [
    chart,
    tickers,
    rawData,
    getEarliestTimestamp,
    getTotalHistoryHours,
    onHistoricalDataLoaded,
  ])

  /**
   * Handle visible range change - check if we need to load more data
   */
  const handleVisibleRangeChange = useCallback(
    (logicalRange: LogicalRange | null) => {
      if (!logicalRange || !enabled) return

      // Check if we're in cooldown period (waiting for data to propagate through React)
      if (Date.now() < cooldownUntilRef.current) {
        return
      }

      // Check if user has scrolled near the beginning of the data
      // logicalRange.from represents the leftmost visible bar index
      // When this gets close to 0 (or negative), user is at/near the start
      if (logicalRange.from < HISTORICAL_LOAD_THRESHOLD) {
        // User is near the left edge - load more historical data
        fetchOlderData()
      }
    },
    [enabled, fetchOlderData]
  )

  /**
   * Subscribe to chart's visible range changes
   */
  useEffect(() => {
    // Clean up previous subscription
    if (subscriptionCleanupRef.current) {
      subscriptionCleanupRef.current()
      subscriptionCleanupRef.current = null
    }

    if (!chart || !enabled) return

    // Subscribe to visible logical range changes
    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)

    // Store cleanup function
    subscriptionCleanupRef.current = () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
    }

    return () => {
      if (subscriptionCleanupRef.current) {
        subscriptionCleanupRef.current()
        subscriptionCleanupRef.current = null
      }
    }
  }, [chart, enabled, handleVisibleRangeChange])

  /**
   * Update earliest loaded time when rawData changes
   */
  useEffect(() => {
    const earliest = getEarliestTimestamp()
    if (earliest && !earliestLoadedTimeRef.current) {
      earliestLoadedTimeRef.current = earliest
      setEarliestLoadedTime(earliest)
    }
  }, [rawData, getEarliestTimestamp])

  /**
   * Reset state when tickers change
   */
  useEffect(() => {
    earliestLoadedTimeRef.current = null
    setEarliestLoadedTime(null)
    setReachedMaxHistory(false)
    isFetchingRef.current = false
  }, [tickers.join(',')])

  return {
    isLoadingHistory,
    earliestLoadedTime,
    totalHistoryHours: getTotalHistoryHours(),
    reachedMaxHistory,
  }
}
