'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LineData,
  BarSeries,
  BarData,
  Time,
} from 'lightweight-charts'
import { useChartEventPatcher } from './useChartEventPatcher'
import { VerticalLinePrimitive } from '../tradingview/lib/primitives/VerticalLinePrimitive'
import type { CandleTuple } from '@/lib/market-data/candles'

/**
 * Index constants for CandleTuple fields
 * See CandleTuple type in candles.ts for full documentation
 */
const IDX = {
  TIMESTAMP: 0,
  // Price OHLC
  OPEN: 1,
  HIGH: 2,
  LOW: 3,
  CLOSE: 4,
  VOLUME: 5,
  // CVD OHLC
  CVD_OPEN: 6,
  CVD_HIGH: 7,
  CVD_LOW: 8,
  CVD_CLOSE: 9,
  // EVR OHLC
  EVR_OPEN: 10,
  EVR_HIGH: 11,
  EVR_LOW: 12,
  EVR_CLOSE: 13,
  // SMP OHLC
  SMP_OPEN: 14,
  SMP_HIGH: 15,
  SMP_LOW: 16,
  SMP_CLOSE: 17,
  // VWAP OHLC
  VWAP_OPEN: 18,
  VWAP_HIGH: 19,
  VWAP_LOW: 20,
  VWAP_CLOSE: 21,
  // VD_RATIO OHLC
  VD_RATIO_OPEN: 22,
  VD_RATIO_HIGH: 23,
  VD_RATIO_LOW: 24,
  VD_RATIO_CLOSE: 25,
  // SPREAD_BPS OHLC
  SPREAD_BPS_OPEN: 26,
  SPREAD_BPS_HIGH: 27,
  SPREAD_BPS_LOW: 28,
  SPREAD_BPS_CLOSE: 29,
  // PRICE_PCT OHLC
  PRICE_PCT_OPEN: 30,
  PRICE_PCT_HIGH: 31,
  PRICE_PCT_LOW: 32,
  PRICE_PCT_CLOSE: 33,
  // Line metrics
  BOOK_IMBALANCE_CLOSE: 34,
  BIG_TRADES: 35,
  BIG_VOLUME: 36,
  DIVERGENCE: 37,
  VD_STRENGTH: 38,
} as const

// Configuration
const TICKER = 'ES'
const POLL_INTERVAL_MS = 1000
const RECENT_CANDLES = 22

// UI colors
const COLORS = {
  background: '#1a1a2e',
  text: '#C3BCDB',
  gridLine: '#333344',
  crosshair: '#71649C',
}

// Series configuration: enabled, color, and scale margins (top/bottom)
// Set `enabled: false` to hide a series from the chart
const SERIES = {
  // Main series
  price: {
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsl(221.01 100% 72.75%)',
    top: 0,
    bottom: 0.5,
  },
  vwap: {
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsl(45 100% 50%)',
    top: 0,
    bottom: 0.5,
  },
  cvd: {
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsla(115.87 100% 62.94% / 0.75)',
    top: 0.125,
    bottom: 0.625,
  },
  rsi: {
    // line
    // range: 100 to 0
    enabled: true,
    color: 'hsl(30 100% 50%)',
    top: 0.25,
    bottom: 0.5,
  },
  evr: {
    // ohlc
    // range: ? recent: 2.46 to -1.9
    enabled: true,
    color: 'hsl(280 70% 65%)',
    top: 0.5,
    bottom: 0.45,
  },
  smp: {
    // ohlc
    // range: ? recent: 80 to -88
    enabled: true,
    color: 'hsl(340 80% 60%)',
    top: 0.55,
    bottom: 0.35,
  },
  vdRatio: {
    // line
    // range: 1 to -1
    enabled: true,
    color: 'hsl(180 70% 50%)',
    top: 0.65,
    bottom: 0.3,
  },
  pricePct: {
    // ohlc
    // range: ? recent: 17.17 to -25.41
    enabled: true,
    color: 'hsl(15 90% 55%)', // red-orange
    top: 0.65,
    bottom: 0.1,
  },
  divergence: {
    // line
    // range: 1 to -1
    enabled: true,
    color: 'hsl(95 60% 50%)', // green
    top: 0.725,
    bottom: 0.225,
  },
  // HL/LH trend
  bookImbalance: {
    // line
    // range: 1 to -1
    enabled: true,
    color: 'hsl(160 60% 50%)',
    top: 0.75,
    bottom: 0.05,
  },
  // 0-based positive values:
  bigTrades: {
    // ohlc
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(320 70% 55%)', // magenta
    top: 0.75,
    bottom: 0,
  },
  bigVolume: {
    // ohlc
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(260 60% 60%)',
    top: 0.75,
    bottom: 0,
  },
  vdStrength: {
    // ohlc
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(50 80% 55%)',
    top: 0.9,
    bottom: 0,
  },
  spreadBps: {
    // ohlc
    // range: ? recent: 1.84 to - 80.25
    enabled: true,
    color: 'hsl(200 80% 55%)',
    top: 0.8,
    bottom: 0,
  },
}

// Extra width to extend chart past screen edge, pushing price scale's internal padding off-screen
// This makes the price numbers appear flush against the right edge
// Value is in scaled pixels (at 2x scale factor, 20px = 10px visual on screen)
// The price scale has ~5-8px internal padding, so 10px visual should fully cover it
const PRICE_SCALE_RIGHT_OFFSET = 20

// RSI period
const RSI_PERIOD = 14

// Absorption marker configuration
const ABSORPTION_MARKER = {
  color: 'hsla(50, 100%, 50%, 0.8)', // yellow
  width: 1,
  labelText: '',
  labelBackgroundColor: 'hsla(50, 100%, 40%, 0.9)',
  labelTextColor: 'white',
  showLabel: false,
  lineStyle: 'dotted' as const,
}

const BASE_CANDLES_URL = `/api/v1/market-data/candles?ticker=${TICKER}&timeframe=1m`

function buildCandlesUrl(limit: number) {
  return `${BASE_CANDLES_URL}&limit=${limit}`
}

/**
 * Convert candles to BarData format for price OHLC bars
 */
function candlesToPriceOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.OPEN],
    high: candle[IDX.HIGH],
    low: candle[IDX.LOW],
    close: candle[IDX.CLOSE],
  }))
}

/**
 * Convert candles to BarData format for CVD OHLC bars
 * Values are inverted (negated) for display
 */
function candlesToCvdOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: -candle[IDX.CVD_OPEN],
    high: -candle[IDX.CVD_LOW], // Inverted: low becomes high
    low: -candle[IDX.CVD_HIGH], // Inverted: high becomes low
    close: -candle[IDX.CVD_CLOSE],
  }))
}

/**
 * Convert candles to BarData format for EVR OHLC bars
 */
function candlesToEvrOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.EVR_OPEN],
    high: candle[IDX.EVR_HIGH],
    low: candle[IDX.EVR_LOW],
    close: candle[IDX.EVR_CLOSE],
  }))
}

/**
 * Convert candles to BarData format for SMP OHLC bars
 */
function candlesToSmpOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.SMP_OPEN],
    high: candle[IDX.SMP_HIGH],
    low: candle[IDX.SMP_LOW],
    close: candle[IDX.SMP_CLOSE],
  }))
}

/**
 * Convert candles to BarData format for VWAP OHLC bars
 * Filters out candles with missing VWAP data (0 or null) to avoid skewing the scale
 */
function candlesToVwapOhlc(candles: CandleTuple[]): BarData[] {
  return candles
    .filter(
      (candle) =>
        candle[IDX.VWAP_OPEN] &&
        candle[IDX.VWAP_HIGH] &&
        candle[IDX.VWAP_LOW] &&
        candle[IDX.VWAP_CLOSE]
    )
    .map((candle) => ({
      time: (candle[IDX.TIMESTAMP] / 1000) as Time,
      open: candle[IDX.VWAP_OPEN],
      high: candle[IDX.VWAP_HIGH],
      low: candle[IDX.VWAP_LOW],
      close: candle[IDX.VWAP_CLOSE],
    }))
}

/**
 * Convert candles to BarData format for VD_RATIO OHLC bars
 */
function candlesToVdRatioOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.VD_RATIO_OPEN],
    high: candle[IDX.VD_RATIO_HIGH],
    low: candle[IDX.VD_RATIO_LOW],
    close: candle[IDX.VD_RATIO_CLOSE],
  }))
}

/**
 * Convert candles to BarData format for SPREAD_BPS OHLC bars
 */
function candlesToSpreadBpsOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.SPREAD_BPS_OPEN],
    high: candle[IDX.SPREAD_BPS_HIGH],
    low: candle[IDX.SPREAD_BPS_LOW],
    close: candle[IDX.SPREAD_BPS_CLOSE],
  }))
}

/**
 * Convert candles to BarData format for PRICE_PCT OHLC bars
 */
function candlesToPricePctOhlc(candles: CandleTuple[]): BarData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    open: candle[IDX.PRICE_PCT_OPEN],
    high: candle[IDX.PRICE_PCT_HIGH],
    low: candle[IDX.PRICE_PCT_LOW],
    close: candle[IDX.PRICE_PCT_CLOSE],
  }))
}

/**
 * Convert candles to LineData format for book_imbalance_close
 */
function candlesToBookImbalanceData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    value: candle[IDX.BOOK_IMBALANCE_CLOSE],
  }))
}

/**
 * Convert candles to LineData format for big_trades
 */
function candlesToBigTradesData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    value: candle[IDX.BIG_TRADES],
  }))
}

/**
 * Convert candles to LineData format for big_volume
 */
function candlesToBigVolumeData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    value: candle[IDX.BIG_VOLUME],
  }))
}

/**
 * Convert candles to LineData format for divergence
 */
function candlesToDivergenceData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    value: candle[IDX.DIVERGENCE],
  }))
}

/**
 * Convert candles to LineData format for vd_strength
 */
function candlesToVdStrengthData(candles: CandleTuple[]): LineData[] {
  return candles.map((candle) => ({
    time: (candle[IDX.TIMESTAMP] / 1000) as Time,
    value: candle[IDX.VD_STRENGTH],
  }))
}

/**
 * Calculate RSI (Relative Strength Index) for a given period
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over the period
 */
function calculateRSI(
  candles: CandleTuple[],
  period: number = RSI_PERIOD
): LineData[] {
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
      changes.push(current[IDX.CLOSE] - previous[IDX.CLOSE]) // Close price difference
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
      time: (firstCandle[IDX.TIMESTAMP] / 1000) as Time,
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
        time: (candle[IDX.TIMESTAMP] / 1000) as Time,
        value: rsi,
      })
    }
  }

  return result
}

/**
 * Detect absorption points where all conditions are met:
 * - divergence != 0 (price moved against aggressor)
 * - ABS(vd_ratio_close) > 0.2 (aggressive imbalance)
 * - spread_bps_close IS NOT NULL (spread data exists)
 * - big_trades > 0 (institutional-size trades present)
 *
 * Returns timestamps of candles that meet all criteria
 */
function detectAbsorptionPoints(candles: CandleTuple[]): number[] {
  const absorptionTimestamps: number[] = []

  for (const candle of candles) {
    const vdRatioClose = candle[IDX.VD_RATIO_CLOSE]
    const spreadBpsClose = candle[IDX.SPREAD_BPS_CLOSE]
    const divergence = candle[IDX.DIVERGENCE]
    const bigTrades = candle[IDX.BIG_TRADES]

    const hasDivergence = divergence !== 0
    const hasImbalance = Math.abs(vdRatioClose) > 0.2
    const hasSpreadData = spreadBpsClose != null
    const hasBigTrades = bigTrades > 0

    if (hasDivergence && hasImbalance && hasSpreadData && hasBigTrades) {
      absorptionTimestamps.push(candle[IDX.TIMESTAMP])
    }
  }

  return absorptionTimestamps
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
  const dataRef = useRef<CandleTuple[]>([])
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)
  const hasStartedPollingRef = useRef(false)
  const hasInitialized = useRef(false)

  // Main series refs
  const priceSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const cvdSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  // OHLC bar series refs
  const evrSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const smpSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const vdRatioSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const spreadBpsSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const pricePctSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)

  // Line series refs
  const bookImbalanceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bigTradesSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bigVolumeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const divergenceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const vdStrengthSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  // Absorption marker refs
  const absorptionMarkersRef = useRef<VerticalLinePrimitive[]>([])
  const absorptionTimestampsRef = useRef<Set<number>>(new Set())

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
    // Update price series
    if (priceSeriesRef.current) {
      priceSeriesRef.current.setData(candlesToPriceOhlc(candles))
    }

    // Update CVD series (OHLC bars)
    if (cvdSeriesRef.current) {
      cvdSeriesRef.current.setData(candlesToCvdOhlc(candles))
    }

    // Update RSI
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(calculateRSI(candles, RSI_PERIOD))
    }

    // Update OHLC bar series
    if (evrSeriesRef.current) {
      evrSeriesRef.current.setData(candlesToEvrOhlc(candles))
    }
    if (smpSeriesRef.current) {
      smpSeriesRef.current.setData(candlesToSmpOhlc(candles))
    }
    if (vwapSeriesRef.current) {
      vwapSeriesRef.current.setData(candlesToVwapOhlc(candles))
    }
    if (vdRatioSeriesRef.current) {
      vdRatioSeriesRef.current.setData(candlesToVdRatioOhlc(candles))
    }
    if (spreadBpsSeriesRef.current) {
      spreadBpsSeriesRef.current.setData(candlesToSpreadBpsOhlc(candles))
    }
    if (pricePctSeriesRef.current) {
      pricePctSeriesRef.current.setData(candlesToPricePctOhlc(candles))
    }

    // Update line series
    if (bookImbalanceSeriesRef.current) {
      bookImbalanceSeriesRef.current.setData(
        candlesToBookImbalanceData(candles)
      )
    }
    if (bigTradesSeriesRef.current) {
      bigTradesSeriesRef.current.setData(candlesToBigTradesData(candles))
    }
    if (bigVolumeSeriesRef.current) {
      bigVolumeSeriesRef.current.setData(candlesToBigVolumeData(candles))
    }
    if (divergenceSeriesRef.current) {
      divergenceSeriesRef.current.setData(candlesToDivergenceData(candles))
    }
    if (vdStrengthSeriesRef.current) {
      vdStrengthSeriesRef.current.setData(candlesToVdStrengthData(candles))
    }

    // Update absorption markers
    if (priceSeriesRef.current) {
      const absorptionTimestamps = detectAbsorptionPoints(candles)

      // Add markers for new absorption points (avoid duplicates)
      for (const timestamp of absorptionTimestamps) {
        if (!absorptionTimestampsRef.current.has(timestamp)) {
          const marker = new VerticalLinePrimitive(
            (timestamp / 1000) as Time,
            ABSORPTION_MARKER
          )
          priceSeriesRef.current.attachPrimitive(marker)
          absorptionMarkersRef.current.push(marker)
          absorptionTimestampsRef.current.add(timestamp)
        }
      }
    }
  }, [])

  const applyRecentCandles = useCallback(
    (recentCandles: CandleTuple[]) => {
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
        indexByTime.set(candle[IDX.TIMESTAMP], i)
      }

      let didUpdate = false

      for (const candle of recentCandles) {
        const existingIndex = indexByTime.get(candle[IDX.TIMESTAMP])
        if (existingIndex !== undefined) {
          // Update existing candle if different
          const existingCandle = existing[existingIndex]
          if (
            existingCandle &&
            existingCandle[IDX.CLOSE] !== candle[IDX.CLOSE]
          ) {
            existing[existingIndex] = candle
            didUpdate = true
          }
          continue
        }

        // Add new candle if it's newer than the last one
        const lastExisting = existing[existing.length - 1]
        if (
          lastExisting &&
          candle[IDX.TIMESTAMP] > lastExisting[IDX.TIMESTAMP]
        ) {
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
    // Prevent duplicate polling in React Strict Mode (dev mode runs useEffect twice)
    if (hasStartedPollingRef.current) return
    hasStartedPollingRef.current = true

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
        textColor: COLORS.text,
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
        rightBarStaysOnScroll: true, // Keep right bar visible when scrolling
      },
      crosshair: {
        mode: 0,
        vertLine: {
          visible: true,
          color: COLORS.crosshair,
          width: 1,
          style: 0,
        },
        horzLine: {
          visible: true,
          color: COLORS.crosshair,
          width: 1,
          style: 0,
        },
      },
      handleScroll: true,
      handleScale: false, // Disable built-in scale handling, we handle zoom ourselves
      localization: {
        timeFormatter,
      },
    })

    chartRef.current = chart
    hasInitialized.current = true

    // ========== MAIN SERIES ==========

    // Add CVD series as OHLC bars (left axis - separate scale)
    // Added first so it renders behind price
    if (SERIES.cvd.enabled) {
      const cvdSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.cvd.color,
        downColor: SERIES.cvd.color,
        priceScaleId: 'left',
        priceLineVisible: false,
        lastValueVisible: true,
      })
      cvdSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.cvd.top, bottom: SERIES.cvd.bottom },
        autoScale: true,
      })
      cvdSeriesRef.current = cvdSeries
    }

    // Add price series as OHLC bars (right axis)
    if (SERIES.price.enabled) {
      const priceSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.price.color,
        downColor: SERIES.price.color,
        priceScaleId: 'right',
        priceLineVisible: false,
        lastValueVisible: true,
      })
      priceSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.price.top, bottom: SERIES.price.bottom },
        autoScale: true,
      })
      priceSeriesRef.current = priceSeries
    }

    // RSI series (overlay)
    if (SERIES.rsi.enabled) {
      const rsiSeries = chart.addSeries(LineSeries, {
        color: SERIES.rsi.color,
        lineWidth: 1,
        priceScaleId: 'rsi',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      rsiSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.rsi.top, bottom: SERIES.rsi.bottom },
        autoScale: true,
      })
      rsiSeriesRef.current = rsiSeries
    }

    // ========== ADDITIONAL OHLC BAR SERIES ==========

    // EVR OHLC bars
    if (SERIES.evr.enabled) {
      const evrSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.evr.color,
        downColor: SERIES.evr.color,
        priceScaleId: 'evr',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      evrSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.evr.top, bottom: SERIES.evr.bottom },
        autoScale: true,
      })
      evrSeriesRef.current = evrSeries
    }

    // SMP OHLC bars
    if (SERIES.smp.enabled) {
      const smpSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.smp.color,
        downColor: SERIES.smp.color,
        priceScaleId: 'smp',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      smpSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.smp.top, bottom: SERIES.smp.bottom },
        autoScale: true,
      })
      smpSeriesRef.current = smpSeries
    }

    // VWAP OHLC bars (shares scale with price)
    if (SERIES.vwap.enabled) {
      const vwapSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.vwap.color,
        downColor: SERIES.vwap.color,
        priceScaleId: 'right', // Same scale as price
        priceLineVisible: false,
        lastValueVisible: false,
      })
      vwapSeriesRef.current = vwapSeries
    }

    // VD_RATIO OHLC bars
    if (SERIES.vdRatio.enabled) {
      const vdRatioSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.vdRatio.color,
        downColor: SERIES.vdRatio.color,
        priceScaleId: 'vdRatio',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      vdRatioSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.vdRatio.top,
          bottom: SERIES.vdRatio.bottom,
        },
        autoScale: true,
      })
      vdRatioSeriesRef.current = vdRatioSeries
    }

    // SPREAD_BPS OHLC bars
    if (SERIES.spreadBps.enabled) {
      const spreadBpsSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.spreadBps.color,
        downColor: SERIES.spreadBps.color,
        priceScaleId: 'spreadBps',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      spreadBpsSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.spreadBps.top,
          bottom: SERIES.spreadBps.bottom,
        },
        autoScale: true,
      })
      spreadBpsSeriesRef.current = spreadBpsSeries
    }

    // PRICE_PCT OHLC bars
    if (SERIES.pricePct.enabled) {
      const pricePctSeries = chart.addSeries(BarSeries, {
        upColor: SERIES.pricePct.color,
        downColor: SERIES.pricePct.color,
        priceScaleId: 'pricePct',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      pricePctSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.pricePct.top,
          bottom: SERIES.pricePct.bottom,
        },
        autoScale: true,
      })
      pricePctSeriesRef.current = pricePctSeries
    }

    // ========== LINE SERIES ==========

    // Book Imbalance line
    if (SERIES.bookImbalance.enabled) {
      const bookImbalanceSeries = chart.addSeries(LineSeries, {
        color: SERIES.bookImbalance.color,
        lineWidth: 1,
        priceScaleId: 'bookImbalance',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      bookImbalanceSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bookImbalance.top,
          bottom: SERIES.bookImbalance.bottom,
        },
        autoScale: true,
      })
      bookImbalanceSeriesRef.current = bookImbalanceSeries
    }

    // Big Trades line
    if (SERIES.bigTrades.enabled) {
      const bigTradesSeries = chart.addSeries(LineSeries, {
        color: SERIES.bigTrades.color,
        lineWidth: 1,
        priceScaleId: 'bigTrades',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      bigTradesSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bigTrades.top,
          bottom: SERIES.bigTrades.bottom,
        },
        autoScale: true,
      })
      bigTradesSeriesRef.current = bigTradesSeries
    }

    // Big Volume line
    if (SERIES.bigVolume.enabled) {
      const bigVolumeSeries = chart.addSeries(LineSeries, {
        color: SERIES.bigVolume.color,
        lineWidth: 1,
        priceScaleId: 'bigVolume',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      bigVolumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bigVolume.top,
          bottom: SERIES.bigVolume.bottom,
        },
        autoScale: true,
      })
      bigVolumeSeriesRef.current = bigVolumeSeries
    }

    // Divergence line
    if (SERIES.divergence.enabled) {
      const divergenceSeries = chart.addSeries(LineSeries, {
        color: SERIES.divergence.color,
        lineWidth: 1,
        priceScaleId: 'divergence',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      divergenceSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.divergence.top,
          bottom: SERIES.divergence.bottom,
        },
        autoScale: true,
      })
      divergenceSeriesRef.current = divergenceSeries
    }

    // VD Strength line
    if (SERIES.vdStrength.enabled) {
      const vdStrengthSeries = chart.addSeries(LineSeries, {
        color: SERIES.vdStrength.color,
        lineWidth: 1,
        priceScaleId: 'vdStrength',
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      vdStrengthSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.vdStrength.top,
          bottom: SERIES.vdStrength.bottom,
        },
        autoScale: true,
      })
      vdStrengthSeriesRef.current = vdStrengthSeries
    }

    // Custom zoom handler anchored on the last data bar
    // Requires cmd (Mac) or ctrl (Windows) + scroll to zoom
    const handleWheel = (e: WheelEvent) => {
      // Only handle zoom gestures: ctrl/cmd+wheel or trackpad pinch
      const isZoomGesture = e.ctrlKey || e.metaKey
      if (!isZoomGesture) return // Let lightweight-charts handle regular scroll/pan

      e.preventDefault()
      e.stopPropagation()

      const timeScale = chart.timeScale()
      const visibleRange = timeScale.getVisibleLogicalRange()
      if (!visibleRange) return

      // Get the last bar's logical index
      const dataLength = dataRef.current.length
      if (dataLength === 0) return
      const lastBarIndex = dataLength - 1

      // Calculate zoom factor based on wheel delta
      // Smaller factor for smoother zoom
      const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95 // zoom out : zoom in

      // Current range
      const currentFrom = visibleRange.from
      const currentTo = visibleRange.to
      const currentWidth = currentTo - currentFrom

      // Calculate the gap between the last bar and the visible right edge
      // This gap should be preserved after zoom
      const rightGap = currentTo - lastBarIndex

      // New width after zoom
      const newWidth = currentWidth * zoomFactor

      // Minimum and maximum zoom limits
      const minBars = 10
      const maxBars = 50000
      if (newWidth < minBars || newWidth > maxBars) return

      // Anchor on the last bar: keep lastBarIndex in the same position
      // newTo = lastBarIndex + rightGap (preserves the gap)
      const newTo = lastBarIndex + rightGap
      const newFrom = newTo - newWidth

      // Apply the new range with last bar anchored
      timeScale.setVisibleLogicalRange({
        from: newFrom,
        to: newTo,
      })
    }

    // Use capture phase to intercept before lightweight-charts
    const container = containerRef.current
    container.addEventListener('wheel', handleWheel, {
      passive: false,
      capture: true,
    })

    return () => {
      container.removeEventListener('wheel', handleWheel, { capture: true })
      chart.remove()
      chartRef.current = null
      // Main series
      priceSeriesRef.current = null
      cvdSeriesRef.current = null
      rsiSeriesRef.current = null
      // OHLC bar series
      evrSeriesRef.current = null
      smpSeriesRef.current = null
      vwapSeriesRef.current = null
      vdRatioSeriesRef.current = null
      spreadBpsSeriesRef.current = null
      pricePctSeriesRef.current = null
      // Line series
      bookImbalanceSeriesRef.current = null
      bigTradesSeriesRef.current = null
      bigVolumeSeriesRef.current = null
      divergenceSeriesRef.current = null
      vdStrengthSeriesRef.current = null
      // Absorption markers
      absorptionMarkersRef.current = []
      absorptionTimestampsRef.current.clear()
      hasInitialized.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial data
  useEffect(() => {
    let isMounted = true
    const SCREEN_CANDLES = 2 * (width - PRICE_SCALE_RIGHT_OFFSET - 80) // subtract right price scale width
    fetchCandles(SCREEN_CANDLES)
      .then((initialCandles) => {
        if (!isMounted) return
        if (initialCandles.length > 0) {
          dataRef.current = initialCandles
          updateChartData(initialCandles)

          // Show ~50% of the data, zoomed in with the latest candle visible
          if (chartRef.current) {
            const totalBars = initialCandles.length
            const barsToShow = Math.floor(totalBars * 0.5)
            const lastBarIndex = totalBars - 1
            const fromIndex = lastBarIndex - barsToShow

            chartRef.current.timeScale().setVisibleLogicalRange({
              from: fromIndex,
              to: lastBarIndex + 2, // Small padding on the right
            })
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
        pollRef.current = null
      }
      hasStartedPollingRef.current = false
    }
  }, [fetchCandles, updateChartData, startPolling])

  // Update chart dimensions
  useEffect(() => {
    if (!chartRef.current || !hasInitialized.current) return
    chartRef.current.applyOptions({
      width: width + PRICE_SCALE_RIGHT_OFFSET,
      height,
    })
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
            color: '#ff6b6b',
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
            color: COLORS.text,
            zIndex: 10,
          }}
        >
          Loading real-time data...
        </div>
      )}
    </div>
  )
}
