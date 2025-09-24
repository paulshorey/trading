import { useEffect, useRef, useState, useCallback } from 'react'
import { StrengthRowGet } from '@apps/common/sql/strength'
import { StrengthDataService } from './strengthDataService'

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
  maxDataHours = 240,
  updateIntervalMs = 60000, // 1 minute default
}: UseRealtimeStrengthDataOptions): UseRealtimeStrengthDataResult {
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const [isRealtime, setIsRealtime] = useState(false)

  // Track the last fetch time for each ticker
  const lastFetchTimeRef = useRef<Date | null>(null)
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
      const initialDate = StrengthDataService.getInitialDataDate(maxDataHours)
      const allTickerData = await StrengthDataService.fetchMultipleTickersData(
        tickers,
        initialDate
      )

      if (isMountedRef.current) {
        setRawData(allTickerData)
        lastFetchTimeRef.current = new Date()
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
   * Fetch incremental updates for real-time data
   */
  const fetchRealtimeUpdate = useCallback(async () => {
    if (!enabled || tickers.length === 0 || !lastFetchTimeRef.current) return

    try {
      // Fetch data from the last fetch time to now
      const fromDate = StrengthDataService.prepareDate(lastFetchTimeRef.current)
      const toDate = new Date() // Current time

      const newTickerData = await StrengthDataService.fetchMultipleTickersData(
        tickers,
        fromDate,
        toDate
      )

      if (isMountedRef.current) {
        setRawData((prevData) => {
          // Merge new data with existing data for each ticker
          return prevData.map((existingData, index) => {
            const newData = newTickerData[index]
            if (!newData || newData.length === 0) return existingData
            if (!existingData) return newData

            // Merge and deduplicate data
            return StrengthDataService.mergeData(existingData, newData)
          })
        })

        lastFetchTimeRef.current = new Date()
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
