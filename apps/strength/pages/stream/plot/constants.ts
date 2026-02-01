import { Candle } from '@/lib/market-data/candles'
import { BarData, LineData, Time } from 'lightweight-charts'
import { calculateRSI } from '../lib/indicators'

// API Configuration
export const TICKER = 'ES'
export const POLL_INTERVAL_MS = 1000
export const RECENT_CANDLES = 22
export const RSI_PERIOD = 14

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

// Series configuration: enabled, color, and scale margins (top/bottom)
// Set `enabled: false` to hide a series from the chart
export const SERIES = {
  // Main series
  price: {
    seriesType: 'Bar',
    // range: unbounded
    enabled: true,
    color: 'hsl(221.01 100% 72.75%)',
    top: 0,
    bottom: 0.4,
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
    // range: unbounded
    enabled: false,
    color: 'hsl(45 100% 50%)',
    top: 0,
    bottom: 0.4,
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
    // range: unbounded
    enabled: true,
    color: 'hsla(115.87 100% 62.94% / 0.75)',
    top: 0.125,
    bottom: 0.5,
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

  // trend
  rsi: {
    seriesType: 'Line',
    // range: 100 to 0
    enabled: true,
    color: 'hsl(40 100% 50%)',
    top: 0.35,
    bottom: 0.15,
    formatter: function (candles: Candle[]): LineData[] {
      return calculateRSI(candles, RSI_PERIOD)
    },
  },
  // HL/LH trend
  bookImbalance: {
    // invert
    seriesType: 'Line',
    // range: 1 to -1
    enabled: false,
    color: 'hsl(0 70% 60%)',
    // color: 'hsl(160 60% 50%)',
    top: 0.35,
    bottom: 0.15,
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
    // range: ? recent: 17.17 to -25.41
    enabled: false,
    color: 'hsl(15 90% 55%)', // red-orange
    top: 0.6,
    bottom: 0,
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
    // range: ? recent: 2.46 to -1.9 (scaled x8 in dataTransformers.ts)
    // shares scale with pricePct (priceScaleId: 'metrics')
    enabled: false,
    color: 'hsl(280 70% 65%)',
    top: 0.6,
    bottom: 0,
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
    enabled: true,
    seriesType: 'Line',
    // range: unbounded positive to 0
    color: 'hsl(50 100% 100%)',
    top: 0.8,
    bottom: 0,
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
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(320 70% 55%)', // magenta
    top: 0.75,
    bottom: 0,
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.big_trades,
      }))
    },
  },
  bigVolume: {
    seriesType: 'Line',
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(260 60% 60%)',
    top: 0.75,
    bottom: 0,
    formatter: function (candles: Candle[]): LineData[] {
      return candles.map((candle) => ({
        time: (candle.time / 1000) as Time,
        value: candle.big_volume,
      }))
    },
  },
  vdStrength: {
    seriesType: 'Line',
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(50 80% 55%)',
    top: 0.85,
    bottom: 0,
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
    // range: ? recent: 1.84 to - 80.25
    enabled: false,
    color: 'hsl(200 80% 55%)',
    top: 0.8,
    bottom: 0,
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
