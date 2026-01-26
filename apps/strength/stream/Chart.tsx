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

// Type for candle data from API: [timestamp_ms, open, high, low, close, volume, cvd]
type CandleTuple = [number, number, number, number, number, number, number]

// Configuration
const TICKER = 'ES'
const INITIAL_CANDLES = 5000
const POLL_INTERVAL_MS = 10_000
const RECENT_CANDLES = 22

// Color palette
const COLORS = {
  price: 'hsl(233 100% 75%)', // Blue
  cvd: 'hsl(120 100% 45%)', // Bright green
  rsi: 'hsl(30 100% 50%)', // Orange
  background: '#ffffff',
  gridLine: '#CDCCC835',
}

// Extra width to extend chart past screen edge, pushing price scale's internal padding off-screen
// This makes the price numbers appear flush against the right edge
// Value is in scaled pixels (at 2x scale factor, 20px = 10px visual on screen)
// The price scale has ~5-8px internal padding, so 10px visual should fully cover it
const PRICE_SCALE_RIGHT_OFFSET = 20

// RSI period
const RSI_PERIOD = 14

const BASE_CANDLES_URL = `/api/v1/market-data/candles?ticker=${TICKER}&timeframe=1m`

function buildCandlesUrl(limit: number) {
  return `${BASE_CANDLES_URL}&limit=${limit}`
}

/**
 * Convert candles to LineData format for CVD series
 * CVD is at index 6 of the tuple
 */
function candlesToCvdData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[0] / 1000) as Time, // Convert ms to seconds
    value: candle[6], // CVD value
  }))
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

/**
 * Calculate RSI (Relative Strength Index) for a given period
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over the period
 */
function calculateRSI(candles: CandleTuple[], period: number = RSI_PERIOD): LineData[] {
  if (candles.length < period + 1) {
    return []
  }

  const result: LineData[] = []

  // Calculate price changes
  const changes: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]
    const previous = candles[i - 1]
    if (current && previous) {
      changes.push(current[4] - previous[4]) // Close price difference
    }
  }

  // Calculate initial average gain and loss using SMA
  let avgGain = 0
  let avgLoss = 0

  for (let i = 0; i < period; i++) {
    const change = changes[i]
    if (change !== undefined) {
      if (change > 0) {
        avgGain += change
      } else {
        avgLoss += Math.abs(change)
      }
    }
  }

  avgGain /= period
  avgLoss /= period

  // First RSI value
  // Handle edge cases: flat market (no gains/losses) = 50, all gains = 100
  const firstRSI =
    avgGain === 0 && avgLoss === 0
      ? 50 // Neutral when no price movement
      : avgLoss === 0
        ? 100 // All gains, no losses = extreme overbought
        : 100 - 100 / (1 + avgGain / avgLoss)

  const firstCandle = candles[period]
  if (firstCandle) {
    result.push({
      time: (firstCandle[0] / 1000) as Time,
      value: firstRSI,
    })
  }

  // Calculate subsequent RSI values using smoothed moving average (Wilder's smoothing)
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]
    if (change === undefined) continue

    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    // Wilder's smoothing: avgGain = (prevAvgGain * (period - 1) + currentGain) / period
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    // Handle edge cases: flat market (no gains/losses) = 50, all gains = 100
    const rsi =
      avgGain === 0 && avgLoss === 0
        ? 50 // Neutral when no price movement
        : avgLoss === 0
          ? 100 // All gains, no losses = extreme overbought
          : 100 - 100 / (1 + avgGain / avgLoss)

    const candle = candles[i + 1]
    if (candle) {
      result.push({
        time: (candle[0] / 1000) as Time,
        value: rsi,
      })
    }
  }

  return result
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
  const cvdSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
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
    if (!priceSeriesRef.current || !cvdSeriesRef.current) return

    // Convert candles to line data for price
    const priceData = candlesToLineData(candles)

    // Convert candles to CVD data
    const cvdData = candlesToCvdData(candles)

    // Calculate RSI data
    const rsiData = calculateRSI(candles, RSI_PERIOD)

    // Update all series
    priceSeriesRef.current.setData(priceData)
    cvdSeriesRef.current.setData(cvdData)
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(rsiData)
    }
  }, [])

  const applyRecentCandles = useCallback(
    (recentCandles: CandleTuple[]) => {
      if (!priceSeriesRef.current || !cvdSeriesRef.current) return

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

    // Extend chart width past screen edge to push price scale's internal padding off-screen
    // This makes the price numbers appear flush against the right edge
    const chartWidth = width + PRICE_SCALE_RIGHT_OFFSET

    const chart = createChart(containerRef.current, {
      width: chartWidth,
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
        borderVisible: false, // Remove border between price scale and chart area
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: timeFormatter,
        borderVisible: false, // Remove time scale border
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

    // Add price series (right axis - middle 50%)
    const priceSeries = chart.addSeries(LineSeries, {
      color: COLORS.price,
      lineWidth: 2,
      priceScaleId: 'right',
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    // Position price in the top 75% of the chart
    priceSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0,
        bottom: 0.25,
      },
      autoScale: true,
    })
    priceSeriesRef.current = priceSeries

    // Add CVD series (left axis - separate scale, top 50%)
    const cvdSeries = chart.addSeries(LineSeries, {
      color: COLORS.cvd,
      lineWidth: 1,
      priceScaleId: 'left',
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    // Position CVD at the top 50% of the chart
    cvdSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0,
        bottom: 0.5, // End at 50% from bottom
      },
      autoScale: true,
    })
    cvdSeriesRef.current = cvdSeries

    // Add RSI series (overlay scale - hidden axis, positioned at bottom)
    // Using a unique priceScaleId creates a separate overlay scale
    const rsiSeries = chart.addSeries(LineSeries, {
      color: COLORS.rsi,
      lineWidth: 1,
      priceScaleId: 'rsi', // Unique ID for overlay scale (no visible axis)
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    // Position RSI at the bottom 50% of the chart
    rsiSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.5, // Start at 50% from top
        bottom: 0, // End at bottom
      },
      autoScale: true,
    })
    rsiSeriesRef.current = rsiSeries

    return () => {
      chart.remove()
      chartRef.current = null
      priceSeriesRef.current = null
      cvdSeriesRef.current = null
      rsiSeriesRef.current = null
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
    chartRef.current.applyOptions({ width: width + PRICE_SCALE_RIGHT_OFFSET, height })
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
  // - overflow: hidden clips the extra chart width (price scale padding pushed off-screen)
  // - Chart container div inside with explicit dimensions for correct event patching
  return (
    <div
      style={{
        width: width + 'px',
        position: 'relative',
        overflow: 'hidden', // Clip the extra chart width that extends past screen edge
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
