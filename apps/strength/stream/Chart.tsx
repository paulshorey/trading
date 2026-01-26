'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LineData,
  Time,
} from 'lightweight-charts'
import { useChartEventPatcher } from './useChartEventPatcher'

// Type for candle data from API: [timestamp_ms, open, high, low, close, volume]
type CandleTuple = [number, number, number, number, number, number]

// Configuration
const TICKER = 'ES'
const SMA_PERIOD = 20
const INITIAL_CANDLES = 5000
const POLL_INTERVAL_MS = 10_000
const RECENT_CANDLES = SMA_PERIOD + 2

// Color palette
const COLORS = {
  price: 'hsl(233 100% 75%)', // Blue
  indicator: 'hsl(120 70.8% 44.31%)', // Green
  background: '#ffffff',
  gridLine: '#CDCCC835',
}

const BASE_CANDLES_URL = `/api/v1/market-data/candles?ticker=${TICKER}&timeframe=1m`

function buildCandlesUrl(limit: number) {
  return `${BASE_CANDLES_URL}&limit=${limit}`
}

/**
 * Calculate Simple Moving Average (SMA)
 * Returns array of LineData with value for each point that has enough history
 */
function calculateSMA(candles: CandleTuple[], period: number): LineData[] {
  if (candles.length < period) return []

  const result: LineData[] = []

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      // Use close price (index 4)
      sum += candles[i - j]![4]
    }
    const avg = sum / period
    // Convert timestamp from ms to seconds for lightweight-charts
    result.push({
      time: (candles[i]![0] / 1000) as Time,
      value: avg,
    })
  }

  return result
}

/**
 * Convert candles to LineData format for price series
 */
function candlesToLineData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[0] / 1000) as Time, // Convert ms to seconds
    value: candle[4], // Close price
  }))
}

function timeFormatter(time: Time) {
  const date = new Date((time as number) * 1000)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString()
  const day = date.getDate().toString()
  return `${month}/${day} ${hours}:${minutes}`
}

interface ChartProps {
  width: number
  height: number
}

export function Chart({ width, height }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const indicatorSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const dataRef = useRef<CandleTuple[]>([])
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)
  const hasInitialized = useRef(false)

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Patch mouse events to handle 2x scale factor
  // This ensures crosshair lines up correctly with cursor position
  useChartEventPatcher(containerRef)

  const fetchCandles = useCallback(async (limit: number) => {
    const response = await fetch(buildCandlesUrl(limit))
    if (!response.ok) {
      throw new Error(`Failed to fetch candles: ${response.status}`)
    }
    return (await response.json()) as CandleTuple[]
  }, [])

  const updateChartData = useCallback((candles: CandleTuple[]) => {
    if (!priceSeriesRef.current || !indicatorSeriesRef.current) return

    // Convert candles to line data for price
    const priceData = candlesToLineData(candles)

    // Calculate SMA indicator
    const smaData = calculateSMA(candles, SMA_PERIOD)

    // Update both series
    priceSeriesRef.current.setData(priceData)
    indicatorSeriesRef.current.setData(smaData)
  }, [])

  const applyRecentCandles = useCallback(
    (recentCandles: CandleTuple[]) => {
      if (!priceSeriesRef.current || !indicatorSeriesRef.current) return

      const existing = dataRef.current
      if (existing.length === 0) {
        dataRef.current = recentCandles
        updateChartData(recentCandles)
        return
      }

      // Create index for fast lookup of existing candles by timestamp
      const startIndex = Math.max(0, existing.length - recentCandles.length - 2)
      const indexByTime = new Map<number, number>()
      for (let i = startIndex; i < existing.length; i += 1) {
        const candle = existing[i]
        if (!candle) continue
        indexByTime.set(candle[0], i)
      }

      let didUpdate = false

      for (const candle of recentCandles) {
        const existingIndex = indexByTime.get(candle[0])
        if (existingIndex !== undefined) {
          // Update existing candle if different
          const existingCandle = existing[existingIndex]
          if (existingCandle && existingCandle[4] !== candle[4]) {
            existing[existingIndex] = candle
            didUpdate = true
          }
          continue
        }

        // Add new candle if it's newer than the last one
        const lastExisting = existing[existing.length - 1]
        if (lastExisting && candle[0] > lastExisting[0]) {
          existing.push(candle)
          didUpdate = true
        }
      }

      if (didUpdate) {
        updateChartData(existing)
      }
    },
    [updateChartData]
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
    if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    pollRef.current = setInterval(() => {
      void pollLatest()
    }, POLL_INTERVAL_MS)
  }, [pollLatest])

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current || hasInitialized.current) return

    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: {
        background: { color: COLORS.background },
        textColor: '#333',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: COLORS.gridLine },
      },
      rightPriceScale: {
        visible: true,
        minimumWidth: 80,
      },
      leftPriceScale: {
        visible: true,
        minimumWidth: 80,
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: timeFormatter,
      },
      crosshair: {
        mode: 0,
        vertLine: {
          visible: true,
          color: '#758391',
          width: 1,
          style: 0,
        },
        horzLine: {
          visible: true,
          color: '#758391',
          width: 1,
          style: 0,
        },
      },
      handleScroll: true,
      handleScale: true,
      localization: {
        timeFormatter,
      },
    })

    chartRef.current = chart
    hasInitialized.current = true

    // Add price series (right axis - default)
    const priceSeries = chart.addSeries(LineSeries, {
      color: COLORS.price,
      lineWidth: 2,
      priceScaleId: 'right',
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    priceSeriesRef.current = priceSeries

    // Add SMA indicator series (left axis)
    const indicatorSeries = chart.addSeries(LineSeries, {
      color: COLORS.indicator,
      lineWidth: 1,
      priceScaleId: 'left',
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    indicatorSeriesRef.current = indicatorSeries

    return () => {
      chart.remove()
      chartRef.current = null
      priceSeriesRef.current = null
      indicatorSeriesRef.current = null
      hasInitialized.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial data
  useEffect(() => {
    let isMounted = true

    fetchCandles(INITIAL_CANDLES)
      .then((initialCandles) => {
        if (!isMounted) return
        if (initialCandles.length > 0) {
          dataRef.current = initialCandles
          updateChartData(initialCandles)

          // Fit content to show all data
          if (chartRef.current) {
            chartRef.current.timeScale().fitContent()
          }
        }
        setIsLoading(false)
        startPolling()
      })
      .catch((err) => {
        console.error('Error loading initial candles:', err)
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load data')
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
      if (pollRef.current) {
        clearInterval(pollRef.current)
      }
    }
  }, [fetchCandles, updateChartData, startPolling])

  // Update chart dimensions
  useEffect(() => {
    if (!chartRef.current || !hasInitialized.current) return
    chartRef.current.applyOptions({ width, height })
  }, [width, height])

  if (error) {
    return (
      <div
        style={{
          width: width + 'px',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: height + 'px',
            color: 'red',
            background: COLORS.background,
          }}
        >
          Error: {error}
        </div>
      </div>
    )
  }

  // Match tradingview/components/Chart.tsx structure:
  // - Outer div with explicit width in px
  // - position: relative for absolute positioning of overlays
  // - Chart container div inside with explicit dimensions for correct event patching
  return (
    <div
      style={{
        width: width + 'px',
        position: 'relative',
      }}
    >
      {/* Chart container - lightweight-charts will render here */}
      {/* Match tradingview container styling for consistent event patching */}
      <div ref={containerRef} className="z-10" />

      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: COLORS.background,
            zIndex: 10,
          }}
        >
          Loading real-time data...
        </div>
      )}
    </div>
  )
}
