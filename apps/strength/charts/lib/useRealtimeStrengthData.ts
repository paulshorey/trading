import { useEffect, useRef, useState, useCallback } from 'react'
import { StrengthRowGet } from '@/sql/strength'
import { FetchStrengthData } from './FetchStrengthData'
import { HOURS_BACK_INITIAL } from '../constants'

export interface UseRealtimeStrengthDataOptions {
  tickers: string[]
  enabled?: boolean
  maxDataHours?: number
  updateIntervalMs?: number
}

export interface UseRealtimeStrengthDataResult {
  rawData: (StrengthRowGet[] | null)[]
  isLoading: boolean
  error: string | null
  lastUpdateTime: Date | null
  isRealtime: boolean
}

/**
 * Custom hook for managing real-time strength data updates
 * Fetches initial historical data and then polls for new data every minute
 */
export function useRealtimeStrengthData({
  tickers,
  enabled = true,
  maxDataHours = HOURS_BACK_INITIAL,
  updateIntervalMs = 60000, // 1 minute default
}: UseRealtimeStrengthDataOptions): UseRealtimeStrengthDataResult {
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const [isRealtime, setIsRealtime] = useState(false)

  // Track the last data timestamp we've received
  const lastDataTimestampRef = useRef<Date | null>(null)
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  /**
   * Load initial historical data
   */
  const loadInitialData = useCallback(async () => {
    if (!enabled || tickers.length === 0) return

    setIsLoading(true)
    setError(null)

    try {
      const initialDate = FetchStrengthData.getInitialDataDate(maxDataHours)
      const allTickerData = await FetchStrengthData.fetchMultipleTickersData(
        tickers,
        initialDate
      )

      if (isMountedRef.current) {
        // Find the latest timestamp across all data
        let latestTimestamp: Date | null = null
        allTickerData.forEach((tickerData) => {
          if (tickerData && tickerData.length > 0) {
            const lastItem = tickerData[tickerData.length - 1]
            if (
              lastItem &&
              (!latestTimestamp || lastItem.timenow > latestTimestamp)
            ) {
              latestTimestamp = lastItem.timenow
            }
          }
        })

        const logData = {
          tickers,
          dataLengths: allTickerData.map((d) => d?.length || 0),
          tickerDataMapping: tickers.map((ticker, idx) => ({
            ticker,
            hasData:
              allTickerData[idx] !== null && allTickerData[idx]!.length > 0,
            dataPoints: allTickerData[idx]?.length || 0,
          })),
          latestDataTime: null as string | null,
        }

        if (latestTimestamp) {
          logData.latestDataTime = (latestTimestamp as Date).toISOString()
        }

        setRawData(allTickerData)
        lastDataTimestampRef.current = latestTimestamp
        setLastUpdateTime(new Date())
        setIsLoading(false)
        setIsRealtime(true) // Enable realtime after initial load
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Error loading initial data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setIsLoading(false)
      }
    }
  }, [tickers, enabled, maxDataHours])

  /**
   * Forward-fill missing strength values from historical data
   * @param currentRow The row to forward-fill (should be index 1)
   * @param historicalRow The row to use for filling (should be index 2)
   * @returns The forward-filled row
   */
  const forwardFillStrengthData = (
    currentRow: StrengthRowGet,
    historicalRow: StrengthRowGet
  ): StrengthRowGet => {
    const filled = { ...currentRow }

    // Forward-fill each strength interval if null
    const strengthIntervals = ['1', '4', '12', '60', '240'] as const
    strengthIntervals.forEach(interval => {
      if (filled[interval] === null && historicalRow[interval] !== null) {
        filled[interval] = historicalRow[interval]
      }
    })

    // Forward-fill price if needed (though it usually has its own algorithm)
    if (filled.price === 0 || filled.price === null) {
      filled.price = historicalRow.price || 0
    }

    return filled
  }

  /**
   * Fetch incremental updates for real-time data
   */
  const fetchRealtimeUpdate = useCallback(async () => {
    if (!enabled || tickers.length === 0 || !lastDataTimestampRef.current)
      return

    try {
      // IMPORTANT: Fetch the last TWO 2-minute intervals
      // The current interval might be empty (pre-created with just timestamp)
      // The previous interval might still be receiving updates
      // We go back 4 minutes to ensure we capture both intervals
      const now = new Date()
      const currentMinute = now.getMinutes()
      const currentEvenMinute =
        currentMinute % 2 === 0 ? currentMinute : currentMinute - 1

      // Calculate the two intervals we want to fetch
      const currentInterval = new Date(now)
      currentInterval.setMinutes(currentEvenMinute, 0, 0)

      const previousInterval = new Date(
        currentInterval.getTime() - 2 * 60 * 1000
      )

      // Fetch from before the previous interval to ensure we get both
      const fromDate = new Date(previousInterval.getTime() - 30 * 1000) // 30 seconds before previous interval
      const toDate = new Date() // Current time

      const newTickerData = await FetchStrengthData.fetchMultipleTickersData(
        tickers,
        fromDate,
        toDate
      )
      console.log('[newTickerData before forward-fill]', newTickerData)

      // Process each ticker's data to forward-fill missing values
      const processedTickerData = newTickerData.map((tickerData) => {
        if (!tickerData || tickerData.length < 2) {
          // Not enough data to process
          return tickerData
        }

        // Sort by timenow descending (newest first)
        const sortedData = [...tickerData].sort(
          (a, b) => b.timenow.getTime() - a.timenow.getTime()
        )

        // We need at least 2 rows to forward-fill
        // Index 0: Latest row (unreliable placeholder, ignore)
        // Index 1: Current real-time update (may have missing values)
        // Index 2: Historical data (usually complete)
        if (sortedData.length >= 3) {
          // Forward-fill index 1 from index 2
          const filledRow = forwardFillStrengthData(sortedData[1], sortedData[2])

          // Return only the filled row for merging (ignore the unreliable latest)
          return [filledRow]
        } else if (sortedData.length === 2) {
          // If we only have 2 rows, use the older one (index 1)
          return [sortedData[1]]
        } else {
          // Only one row, use it as is
          return sortedData
        }
      })

      console.log('[newTickerData after forward-fill]', processedTickerData)

      if (isMountedRef.current) {
        setRawData((prevData) => {
          // Track the latest timestamp after merge
          let newLatestTimestamp = lastDataTimestampRef.current

          // Merge new data with existing data for each ticker
          const mergedData = prevData.map((existingData, index) => {
            const newData = processedTickerData[index]
            if (!newData || newData.length === 0) return existingData
            if (!existingData) return newData

            // Merge and deduplicate data
            const merged = FetchStrengthData.mergeData(existingData, newData)

            // Update latest timestamp
            if (merged.length > 0) {
              const lastItem = merged[merged.length - 1]
              if (
                lastItem &&
                (!newLatestTimestamp || lastItem.timenow > newLatestTimestamp)
              ) {
                newLatestTimestamp = lastItem.timenow
              }
            }

            return merged
          })

          // Update the last data timestamp for next fetch
          lastDataTimestampRef.current = newLatestTimestamp

          return mergedData
        })

        setLastUpdateTime(new Date())
      }
    } catch (err) {
      console.error('Error fetching realtime update:', err)
      // Don't set error state for realtime updates to avoid disrupting the UI
    }
  }, [tickers, enabled])

  /**
   * Setup real-time updates
   */
  const setupRealtimeUpdates = useCallback(() => {
    // Clear any existing interval
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current)
      updateIntervalRef.current = null
    }

    // Only setup if realtime is enabled and we have initial data
    if (isRealtime && rawData.length > 0) {
      // Start periodic updates
      updateIntervalRef.current = setInterval(() => {
        fetchRealtimeUpdate()
      }, updateIntervalMs)

      // Also fetch immediately to catch up if needed
      fetchRealtimeUpdate()
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
    }
  }, [isRealtime, rawData.length, fetchRealtimeUpdate, updateIntervalMs])

  // Effect for initial data load
  useEffect(() => {
    isMountedRef.current = true
    loadInitialData()

    return () => {
      isMountedRef.current = false
    }
  }, [loadInitialData])

  // Effect for real-time updates
  useEffect(() => {
    const cleanup = setupRealtimeUpdates()
    return cleanup
  }, [setupRealtimeUpdates])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
      }
      isMountedRef.current = false
    }
  }, [])

  return {
    rawData,
    isLoading,
    error,
    lastUpdateTime,
    isRealtime,
  }
}
