/**
 * Index constants for CandleTuple fields
 * See CandleTuple type in candles.ts for full documentation
 */
export const IDX = {
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
  // VWAP OHLC
  VWAP_OPEN: 14,
  VWAP_HIGH: 15,
  VWAP_LOW: 16,
  VWAP_CLOSE: 17,
  // SPREAD_BPS OHLC
  SPREAD_BPS_OPEN: 18,
  SPREAD_BPS_HIGH: 19,
  SPREAD_BPS_LOW: 20,
  SPREAD_BPS_CLOSE: 21,
  // PRICE_PCT OHLC
  PRICE_PCT_OPEN: 22,
  PRICE_PCT_HIGH: 23,
  PRICE_PCT_LOW: 24,
  PRICE_PCT_CLOSE: 25,
  // Line metrics
  BOOK_IMBALANCE_CLOSE: 26,
  BIG_TRADES: 27,
  BIG_VOLUME: 28,
  VD_STRENGTH: 29,
} as const

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
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsl(221.01 100% 72.75%)',
    top: 0,
    bottom: 0.4,
  },
  vwap: {
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsl(45 100% 50%)',
    top: 0,
    bottom: 0.4,
  },
  cvd: {
    // ohlc
    // range: unbounded
    enabled: true,
    color: 'hsla(115.87 100% 62.94% / 0.75)',
    top: 0.125,
    bottom: 0.5,
  },

  // trend
  rsi: {
    // line
    // range: 100 to 0
    enabled: true,
    color: 'hsl(40 100% 50%)',
    top: 0.35,
    bottom: 0.15,
  },
  // HL/LH trend
  bookImbalance: {
    // invert
    // line
    // range: 1 to -1
    enabled: false,
    color: 'hsl(0 70% 60%)',
    // color: 'hsl(160 60% 50%)',
    top: 0.35,
    bottom: 0.15,
  },

  // 0-middle volatility:
  pricePct: {
    // ohlc
    // range: ? recent: 17.17 to -25.41
    enabled: false,
    color: 'hsl(15 90% 55%)', // red-orange
    top: 0.6,
    bottom: 0,
  },
  evr: {
    // ohlc
    // range: ? recent: 2.46 to -1.9 (scaled x8 in dataTransformers.ts)
    // shares scale with pricePct (priceScaleId: 'metrics')
    enabled: false,
    color: 'hsl(280 70% 65%)',
    top: 0.6,
    bottom: 0,
  },

  // 0-floor histogram:
  volume: {
    // line
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(50 100% 100%)',
    top: 0.7,
    bottom: 0,
  },
  bigTrades: {
    // line
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(320 70% 55%)', // magenta
    top: 0.75,
    bottom: 0,
  },
  bigVolume: {
    // line
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(260 60% 60%)',
    top: 0.75,
    bottom: 0,
  },
  vdStrength: {
    // line
    // range: unbounded positive to 0
    enabled: true,
    color: 'hsl(50 80% 55%)',
    top: 0.85,
    bottom: 0,
  },

  // not used
  spreadBps: {
    // ohlc
    // range: ? recent: 1.84 to - 80.25
    enabled: false,
    color: 'hsl(200 80% 55%)',
    top: 0.8,
    bottom: 0,
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
