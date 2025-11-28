/**
 * Real-time Strength Data Hook
 *
 * Manages data fetching lifecycle:
 * 1. Initial historical data load
 * 2. Real-time polling every 60 seconds
 * 3. Forward-fill for missing values
 * 4. Data merging for incremental updates
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { StrengthRowGet } from '@lib/common/sql/strength'
import { StrengthDataApi } from './api'
import { HOURS_BACK_INITIAL } from '../constants'
import { strengthIntervals } from '../state'

export interface UseStrengthDataOptions {
  tickers: string[]
  enabled?: boolean
  maxDataHours?: number
  updateIntervalMs?: number
}

export interface UseStrengthDataResult {
  rawData: (StrengthRowGet[] | null)[]
  isLoading: boolean
  error: string | null
  lastUpdateTime: Date | null
  isRealtime: boolean
}

/**
 * Hook for managing real-time strength data updates
 * Fetches initial historical data and polls for new data every minute
 */
export function useStrengthData({
  tickers,
  enabled = true,
  maxDataHours = HOURS_BACK_INITIAL,
  updateIntervalMs = 60000,
}: UseStrengthDataOptions): UseStrengthDataResult {
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const [isRealtime, setIsRealtime] = useState(false)

  const lastDataTimestampRef = useRef<Date | null>(null)
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  /**
   * Forward-fill missing strength values from historical data
   */
  const forwardFillStrengthData = (
    currentRow: StrengthRowGet,
    historicalRow: StrengthRowGet
  ): StrengthRowGet => {
    const filled = { ...currentRow }

    strengthIntervals.forEach((interval) => {
      if (filled[interval] === null && historicalRow[interval] !== null) {
        filled[interval] = historicalRow[interval]
      }
    })

    if (filled.price === 0 || filled.price === null) {
      filled.price = historicalRow.price || 0
    }

    return filled
  }

  /**
   * Load initial historical data
   */
  const loadInitialData = useCallback(async () => {
    if (!enabled || tickers.length === 0) return

    setIsLoading(true)
    setError(null)

    try {
      const initialDate = StrengthDataApi.getInitialDataDate(maxDataHours)
      const allTickerData = await StrengthDataApi.fetchMultipleTickersData(
        tickers,
        initialDate
      )

      if (isMountedRef.current) {
        let latestTimestamp: Date | null = null
        allTickerData.forEach((tickerData) => {
          if (tickerData && tickerData.length > 0) {
            const lastItem = tickerData[tickerData.length - 1]
            if (lastItem && (!latestTimestamp || lastItem.timenow > latestTimestamp)) {
              latestTimestamp = lastItem.timenow
            }
          }
        })

        setRawData(allTickerData)
        lastDataTimestampRef.current = latestTimestamp
        setLastUpdateTime(new Date())
        setIsLoading(false)
        setIsRealtime(true)
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
    if (!enabled || tickers.length === 0 || !lastDataTimestampRef.current) return

    try {
      const now = new Date()
      const currentMinute = now.getMinutes()
      const currentEvenMinute = currentMinute % 2 === 0 ? currentMinute : currentMinute - 1

      const currentInterval = new Date(now)
      currentInterval.setMinutes(currentEvenMinute, 0, 0)

      const previousInterval = new Date(currentInterval.getTime() - 2 * 60 * 1000)
      const fromDate = new Date(previousInterval.getTime() - 30 * 1000)
      const toDate = new Date()

      const newTickerData = await StrengthDataApi.fetchMultipleTickersData(
        tickers,
        fromDate,
        toDate
      )

      // Process with forward-fill
      const processedTickerData = newTickerData.map((tickerData) => {
        if (!tickerData || tickerData.length < 2) return tickerData

        const sortedData = [...tickerData].sort(
          (a, b) => b.timenow.getTime() - a.timenow.getTime()
        )

        if (sortedData.length >= 3 && sortedData[1] && sortedData[2]) {
          const filledRow = forwardFillStrengthData(sortedData[1], sortedData[2])
          return [filledRow]
        } else if (sortedData.length === 2 && sortedData[1]) {
          return [sortedData[1]]
        }
        return sortedData
      })

      if (isMountedRef.current) {
        setRawData((prevData) => {
          let newLatestTimestamp = lastDataTimestampRef.current

          const mergedData = prevData.map((existingData, index) => {
            const newData = processedTickerData[index]
            if (!newData || newData.length === 0) return existingData
            if (!existingData) return newData

            const merged = StrengthDataApi.mergeData(existingData, newData)

            if (merged.length > 0) {
              const lastItem = merged[merged.length - 1]
              if (lastItem && (!newLatestTimestamp || lastItem.timenow > newLatestTimestamp)) {
                newLatestTimestamp = lastItem.timenow
              }
            }

            return merged
          })

          lastDataTimestampRef.current = newLatestTimestamp
          return mergedData
        })

        setLastUpdateTime(new Date())
      }
    } catch (err) {
      console.error('Error fetching realtime update:', err)
    }
  }, [tickers, enabled])

  /**
   * Setup real-time updates
   */
  const setupRealtimeUpdates = useCallback(() => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current)
      updateIntervalRef.current = null
    }

    if (isRealtime && rawData.length > 0) {
      updateIntervalRef.current = setInterval(fetchRealtimeUpdate, updateIntervalMs)
      fetchRealtimeUpdate()
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
    }
  }, [isRealtime, rawData.length, fetchRealtimeUpdate, updateIntervalMs])

  // Initial data load
  useEffect(() => {
    isMountedRef.current = true
    loadInitialData()
    return () => {
      isMountedRef.current = false
    }
  }, [loadInitialData])

  // Real-time updates
  useEffect(() => {
    return setupRealtimeUpdates()
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

// Backwards compatibility alias
export const useRealtimeStrengthData = useStrengthData


