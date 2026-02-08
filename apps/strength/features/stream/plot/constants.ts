import { Candle } from '@/lib/market-data/candles'
import { BarData, LineData, Time } from 'lightweight-charts'
import { calculateRSI, calculateATR, pivotPoints } from '../lib/indicators'

// API Configuration
export const TICKER = 'ES'
export const POLL_INTERVAL_MS = 1000
export const RECENT_CANDLES = 22 // I guess it needs to be enough to calculate indicators
export const RSI_PERIOD = 14
export const ATR_PERIOD = 5

// Extra width to extend chart past screen edge, pushing price scale's internal padding off-screen
// This makes the price numbers appear flush against the right edge
// Value is in scaled pixels (at 2x scale factor, 20px = 10px visual on screen)
export const PRICE_SCALE_RIGHT_OFFSET = 20

// UI colors
export const COLORS = {
  background: '#1a1a2e',
  text: '#C3BCDB',
  gridLine: '#333344',
  crosshair: '#71649C',
}

// Series configuration type
export interface SeriesConfig {
  seriesType: 'Bar' | 'Line'
  enabled: boolean
  color: string
  top: number
  bottom: number
  priceScaleId: string
  lastValueVisible?: boolean
  applyScaleMargins?: boolean
  formatter: (candles: Candle[]) => BarData[] | LineData[]
}

// Series configuration: enabled, color, scale margins (top/bottom), and chart options
// Set `enabled: false` to hide a series from the chart
export const SERIES: Record<string, SeriesConfig> = {
  // Main series
  price: {
    seriesType: 'Bar',
    enabled: true,
    color: 'hsl(221.01 100% 72.75%)',
    top: 0.05,
    bottom: 0.25,
    // Chart options
    priceScaleId: 'right',
    lastValueVisible: true,
    formatter: function (candles: Candle[]): BarData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }))
    },
  },
  vwap: {
    seriesType: 'Bar',
    enabled: false,
    color: 'hsl(45 100% 50%)',
    top: 0,
    bottom: 0.4,
    // Chart options
    priceScaleId: 'right',
    applyScaleMargins: false, // shares scale with price
    formatter: function (candles: Candle[]): BarData[] {
      return candles
        .filter(
          (candle) =>
            candle.vwap_open &&
            candle.vwap_high &&
            candle.vwap_low &&
            candle.vwap_close
        )
        .map((candle) => ({
          time: (candle.time / 1000) as Time,
          open: candle.vwap_open,
          high: candle.vwap_high,
          low: candle.vwap_low,
          close: candle.vwap_close,
        }))
    },
  },
  cvd: {
    seriesType: 'Bar',
    enabled: true,
    color: 'hsla(115.87 100% 62.94% / 0.75)',
    top: 0.125,
    bottom: 0.5,
    // Chart options - overlay scale (hidden) so pivots can use left scale
    priceScaleId: 'cvd',
    lastValueVisible: false,
    formatter: function (candles: Candle[]): BarData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        open: -candle.cvd_open,
        high: -candle.cvd_low, // Inverted: low becomes high
        low: -candle.cvd_high, // Inverted: high becomes low
        close: -candle.cvd_close,
      }))
    },
  },

  // pivot points (uses left price scale - visible on left side of chart)
  pivots: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(60 100% 70%)',
    top: 0,
    bottom: 0.95,
    // Chart options - 'left' makes scale visible on left; overlay scales are always hidden
    priceScaleId: 'pivots',
    formatter: function (candles: Candle[]): LineData[] {
      return pivotPoints(candles, 10)
    },
  },

  // relative strength
  rsi: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(40 100% 50%)',
    top: 0.35,
    bottom: 0.15,
    // Chart options
    priceScaleId: 'rsi',
    lastValueVisible: true,
    formatter: function (candles: Candle[]): LineData[] {
      return calculateRSI(candles, RSI_PERIOD)
    },
  },
  // volatility (average true range)
  atr: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(180 70% 50%)', // cyan
    top: 0.65,
    bottom: 0,
    // Chart options
    priceScaleId: 'atr',
    formatter: function (candles: Candle[]): LineData[] {
      return calculateATR(candles, ATR_PERIOD)
    },
  },
  // HL/LH trend
  bookImbalance: {
    seriesType: 'Line',
    enabled: false,
    color: 'hsl(0 70% 60%)',
    top: 0.35,
    bottom: 0.15,
    // Chart options
    priceScaleId: 'bookImbalance',
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.book_imbalance_close,
      }))
    },
  },

  // 0-middle volatility:
  pricePct: {
    seriesType: 'Bar',
    enabled: false,
    color: 'hsl(15 90% 55%)', // red-orange
    top: 0.6,
    bottom: 0,
    // Chart options
    priceScaleId: 'metrics',
    formatter: function (candles: Candle[]): BarData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        open: candle.price_pct_open,
        high: candle.price_pct_high,
        low: candle.price_pct_low,
        close: candle.price_pct_close,
      }))
    },
  },
  evr: {
    seriesType: 'Bar',
    enabled: false,
    color: 'hsl(280 70% 65%)',
    top: 0.6,
    bottom: 0,
    // Chart options (shares scale with pricePct)
    priceScaleId: 'metrics',
    applyScaleMargins: false,
    formatter: function (candles: Candle[]): BarData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        open: candle.evr_open * 7,
        high: candle.evr_high * 7,
        low: candle.evr_low * 7,
        close: candle.evr_close * 7,
      }))
    },
  },

  // 0-floor histogram:
  volume: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(50 100% 100%)',
    top: 0.8,
    bottom: 0,
    // Chart options
    priceScaleId: 'volume',
    formatter: function (candles: Candle[]): LineData[] {
      const rsi = calculateRSI(candles, 70, 'volume')
      return rsi.map((candle) => ({
        time: candle.time as Time,
        value: candle.value,
      }))
    },
  },
  bigTrades: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(320 70% 55%)', // magenta
    top: 0.75,
    bottom: 0,
    // Chart options
    priceScaleId: 'bigTrades',
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.big_trades,
      }))
    },
  },
  bigVolume: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(260 60% 60%)',
    top: 0.75,
    bottom: 0,
    // Chart options
    priceScaleId: 'bigVolume',
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.big_volume,
      }))
    },
  },
  vdStrength: {
    seriesType: 'Line',
    enabled: true,
    color: 'hsl(50 80% 55%)',
    top: 0.85,
    bottom: 0,
    // Chart options
    priceScaleId: 'vdStrength',
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.vd_strength,
      }))
    },
  },

  // not used
  spreadBps: {
    seriesType: 'Bar',
    enabled: false,
    color: 'hsl(200 80% 55%)',
    top: 0.8,
    bottom: 0,
    // Chart options
    priceScaleId: 'spreadBps',
    formatter: function (candles: Candle[]): BarData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        open: normalizeSpreadBps(candle.spread_bps_open),
        high: normalizeSpreadBps(candle.spread_bps_high),
        low: normalizeSpreadBps(candle.spread_bps_low),
        close: normalizeSpreadBps(candle.spread_bps_close),
      }))
    },
  },
}

// Export type for series keys
export type SeriesKey = keyof typeof SERIES

// Helper to get series keys as array
export const SERIES_KEYS = Object.keys(SERIES) as SeriesKey[]

// Absorption marker configuration
export const ABSORPTION_MARKER = {
  color: 'hsla(50, 100%, 50%, 0.8)', // yellow
  width: 1,
  labelText: '',
  labelBackgroundColor: 'hsla(50, 100%, 40%, 0.9)',
  labelTextColor: 'white',
  showLabel: false,
  lineStyle: 'dotted' as const,
}

export const BASE_CANDLES_URL = `/api/v1/market-data/candles?ticker=${TICKER}&timeframe=1m`

export function buildCandlesUrl(limit: number) {
  return `${BASE_CANDLES_URL}&limit=${limit}`
}

// Helper function for spreadBps normalization
function normalizeSpreadBps(spreadBps: number): number {
  return Math.min(1, Math.max(-1, spreadBps * 10))
}
