import { useCallback, useRef } from 'react'
import type { Candle } from '@/lib/market-data/candles'
import { POLL_INTERVAL_MS, RECENT_CANDLES, buildCandlesUrl } from './constants'
import { usePlotData } from './usePlotData'
import type { SeriesRefs, AbsorptionRefs } from './useChart'

interface UsePollDataProps {
  dataRef: React.MutableRefObject<Candle[]>
  seriesRefs: SeriesRefs
  absorptionRefs: AbsorptionRefs
}

interface UsePollDataReturn {
  fetchCandles: (limit: number) => Promise<Candle[]>
  plotChartData: (candles: Candle[]) => void
  applyRecentCandles: (recentCandles: Candle[]) => void
  startPolling: () => void
  stopPolling: () => void
}

export function usePollData({
  dataRef,
  seriesRefs,
  absorptionRefs,
}: UsePollDataProps): UsePollDataReturn {
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)
  const hasStartedPollingRef = useRef(false)

  const { plotChartData } = usePlotData({ seriesRefs, absorptionRefs })

  const fetchCandles = useCallback(async (limit: number) => {
    const response = await fetch(buildCandlesUrl(limit))
    if (!response.ok) {
      throw new Error(`Failed to fetch candles: ${response.status}`)
    }
    return (await response.json()) as Candle[]
  }, [])

  const applyRecentCandles = useCallback(
    (recentCandles: Candle[]) => {
      const existing = dataRef.current
      if (existing.length === 0) {
        dataRef.current = recentCandles
        plotChartData(recentCandles)
        return
      }

      // Create index for fast lookup of existing candles by timestamp
      const startIndex = Math.max(0, existing.length - recentCandles.length - 2)
      const indexByTime = new Map<number, number>()
      for (let i = startIndex; i < existing.length; i += 1) {
        const candle = existing[i]
        if (!candle) continue
        indexByTime.set(candle.time, i)
      }

      let didUpdate = false

      for (const candle of recentCandles) {
        const existingIndex = indexByTime.get(candle.time)
        if (existingIndex !== undefined) {
          const existingCandle = existing[existingIndex]
          if (existingCandle && existingCandle.close !== candle.close) {
            existing[existingIndex] = candle
            didUpdate = true
          }
          continue
        }

        const lastExisting = existing[existing.length - 1]
        if (lastExisting && candle.time > lastExisting.time) {
          existing.push(candle)
          didUpdate = true
        }
      }

      if (didUpdate) {
        plotChartData(existing)
      }
    },
    [dataRef, plotChartData]
  )

  const pollLatest = useCallback(async () => {
    if (isPollingRef.current) return
    isPollingRef.current = true
    try {
      const recentCandles = await fetchCandles(RECENT_CANDLES)
      if (recentCandles.length > 0) {
        applyRecentCandles(recentCandles)
      }
    } catch (err) {
      console.error('Error fetching recent candles:', err)
    } finally {
      isPollingRef.current = false
    }
  }, [applyRecentCandles, fetchCandles])

  const startPolling = useCallback(() => {
    if (hasStartedPollingRef.current) return
    hasStartedPollingRef.current = true

    if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    pollRef.current = setInterval(() => {
      void pollLatest()
    }, POLL_INTERVAL_MS)
  }, [pollLatest])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    hasStartedPollingRef.current = false
  }, [])

  return {
    fetchCandles,
    plotChartData,
    applyRecentCandles,
    startPolling,
    stopPolling,
  }
}
