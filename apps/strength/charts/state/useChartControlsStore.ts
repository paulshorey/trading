import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { createURLStorage, getQueryParams } from './urlSync'
import { NEW_INTERVALS } from '@lib/common/sql/strength/constants'

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================
export const strengthIntervals = NEW_INTERVALS

/**
 * Available interval configurations for strength data aggregation
 * Each option represents a set of intervals to average together
 */
export const intervalsOptions = [
  {
    value: strengthIntervals,
    label: 'all',
  },
  {
    value: strengthIntervals.slice(Math.ceil(strengthIntervals.length / 2)),
    label: 'long',
  },
  {
    value: strengthIntervals.slice(0, Math.ceil(strengthIntervals.length / 2)),
    label: 'short',
  },
]
for (const interval of strengthIntervals) {
  intervalsOptions.push({ value: [interval], label: interval })
}

/**
 * Available time range options for historical data
 */
export const hoursBackOptions = [
  '120h',
  '96h',
  '72h',
  '48h',
  '24h',
  '12h',
  '6h',
]

/**
 * Market categories and their ticker options
 * This defines what tickers are available for selection
 */
export const tickersByMarket = [
  {
    market: '---meta---',
    tickers: [
      { label: 'Bullish', value: ['NQ1!', 'RTY1!', 'HG1!', 'CX'] },
      { label: 'Bearish', value: ['VX1!', 'UVIX', 'ZN1!', 'CL1!', 'Forex'] },
      { label: 'VX1!', value: ['VX1!'] },
      { label: 'UVIX', value: ['UVIX'] },
      { label: 'ZN1!', value: ['ZN1!'] },
      { label: 'Other Currencies', value: ['Forex'] },
    ],
  },
  {
    market: '---equities---',
    tickers: [
      { label: 'US Equities', value: ['NQ1!', 'ES1!', 'RTY1!'] },
      { label: 'NQ1!', value: ['NQ1!'] },
      { label: 'ES1!', value: ['ES1!'] },
      { label: 'RTY1!', value: ['RTY1!'] },
    ],
  },
  {
    market: '---metals---',
    tickers: [
      { label: 'Monetary', value: ['GC1!', 'SI1!'] },
      { label: 'Precious', value: ['GC1!', 'SI1!', 'PL1!'] },
      { label: 'GC1!', value: ['GC1!'] },
      { label: 'SI1!', value: ['SI1!'] },
      { label: 'PL1!', value: ['PL1!'] },
      { label: 'HG1!', value: ['HG1!'] },
    ],
  },
  {
    market: '---commodities---',
    tickers: [
      { label: 'CL1!', value: ['CL1!'] },
      { label: 'XC1!', value: ['XC1!'] },
      { label: 'XW1!', value: ['XW1!'] },
      { label: 'SB1!', value: ['SB1!'] },
      { label: 'ZL1!', value: ['ZL1!'] },
    ],
  },
  {
    market: '---crypto---',
    tickers: [
      { label: 'Crypto', value: ['CX'] },
      { label: 'BTCUSD', value: ['BTCUSD'] },
      { label: 'ETHUSD', value: ['ETHUSD'] },
      { label: 'SOLUSD', value: ['SOLUSD'] },
      { label: 'XRPUSD', value: ['XRPUSD'] },
      { label: 'BNBUSD', value: ['BNBUSD'] },
      { label: 'SUIUSD', value: ['SUIUSD'] },
      // { label: 'DOGEUSD', value: ['DOGEUSD'] },
      // { label: 'AVAXUSD', value: ['AVAXUSD'] },
      // { label: 'XLMUSD', value: ['XLMUSD'] },
    ],
  },
]

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Individual interval strength data - keyed by interval string
 */
export type IntervalStrengthData = Record<string, LineData[] | null>

/**
 * Individual ticker price data - keyed by ticker symbol
 */
export type TickerPriceData = Record<string, LineData[] | null>

/**
 * Store state for chart controls and data management
 * Simplified: Single chartTickers for both data fetching and display
 */
type State = {
  // Time range configuration
  hoursBack: string

  // Interval selection for strength data aggregation
  interval: string[]

  // Single ticker selection for both fetching and display
  chartTickers: string[]

  // Time and cursor states
  timeRange: { from: Time; to: Time } | null
  cursorTime: Time | null

  // Aggregated data for charts
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Individual interval strength data (one line per interval)
  intervalStrengthData: IntervalStrengthData

  // Individual ticker price data (one line per ticker)
  tickerPriceData: TickerPriceData

  // Toggle for showing individual interval lines (default: false)
  showIntervalLines: boolean

  // Toggle for showing individual ticker price lines (default: false)
  showTickerLines: boolean

  // Hydration state for URL sync
  isHydrated: boolean
}

/**
 * Store actions for updating state
 * Simplified: Fewer setter methods needed
 */
type Actions = {
  // Configuration setters
  setHoursBack: (hours: string) => void
  setInterval: (intervals: string[]) => void

  // Single ticker setter for all purposes
  setChartTickers: (tickers: string[]) => void

  // Time and cursor setters
  setTimeRange: (range: { from: Time; to: Time } | null) => void
  setCursorTime: (time: Time | null) => void

  // Data setters
  setAggregatedStrengthData: (data: LineData[] | null) => void
  setAggregatedPriceData: (data: LineData[] | null) => void
  setIntervalStrengthData: (data: IntervalStrengthData) => void
  setTickerPriceData: (data: TickerPriceData) => void

  // Display toggles
  setShowIntervalLines: (show: boolean) => void
  setShowTickerLines: (show: boolean) => void

  // Utility actions
  resetToDefaults: () => void
  setIsHydrated: (hydrated: boolean) => void
}

export type ChartControlsStore = State & Actions

// ============================================================================
// URL SYNC CONFIGURATION
// ============================================================================

/**
 * Keys to sync with URL query parameters
 * Simplified URL structure
 */
const URL_SYNC_KEYS = ['hoursBack', 'interval', 'tickers']

// ============================================================================
// INITIALIZATION LOGIC
// ============================================================================

/**
 * Get initial state from URL parameters or defaults
 */
const getInitialState = (): State => {
  // Default to CX (Crypto Index) ticker
  const defaultTickers = tickersByMarket[2]!.tickers[0]!.value

  const defaultState: State = {
    hoursBack: hoursBackOptions[hoursBackOptions.length - 3]!,
    interval: [...strengthIntervals],
    chartTickers: defaultTickers,
    timeRange: null,
    cursorTime: null,
    aggregatedStrengthData: null,
    aggregatedPriceData: null,
    intervalStrengthData: {},
    tickerPriceData: {},
    showIntervalLines: false,
    showTickerLines: true,
    isHydrated: false,
  }

  // Override with URL params if available
  if (typeof window !== 'undefined') {
    const urlParams = getQueryParams()

    if (urlParams.hoursBack !== undefined) {
      defaultState.hoursBack = urlParams.hoursBack
    }

    if (urlParams.interval !== undefined) {
      defaultState.interval = urlParams.interval
    }

    if (urlParams.tickers !== undefined) {
      defaultState.chartTickers = urlParams.tickers
    }
  }

  return defaultState
}

// ============================================================================
// STORE CREATION
// ============================================================================

export const useChartControlsStore = create<ChartControlsStore>()(
  persist(
    (set) => ({
      ...getInitialState(),

      // Configuration setters
      setHoursBack: (hours: string) => {
        set({ hoursBack: hours })
      },

      setInterval: (intervals: string[]) => {
        // Ensure new array reference for React effect triggering
        set({ interval: [...intervals] })
      },

      // Single ticker setter
      setChartTickers: (tickers: string[]) => {
        set({ chartTickers: [...tickers] })
      },

      // Time and cursor setters
      setTimeRange: (range: { from: Time; to: Time } | null) => {
        set({ timeRange: range })
      },

      setCursorTime: (time: Time | null) => {
        set({ cursorTime: time })
      },

      // Data setters
      setAggregatedStrengthData: (data: LineData[] | null) => {
        set({ aggregatedStrengthData: data })
      },

      setAggregatedPriceData: (data: LineData[] | null) => {
        set({ aggregatedPriceData: data })
      },

      setIntervalStrengthData: (data: IntervalStrengthData) => {
        set({ intervalStrengthData: { ...data } })
      },

      setTickerPriceData: (data: TickerPriceData) => {
        set({ tickerPriceData: { ...data } })
      },

      // Display toggles
      setShowIntervalLines: (show: boolean) => {
        set({ showIntervalLines: show })
      },

      setShowTickerLines: (show: boolean) => {
        set({ showTickerLines: show })
      },

      // Utility actions
      resetToDefaults: () => {
        set(getInitialState())
      },

      setIsHydrated: (hydrated: boolean) => {
        set({ isHydrated: hydrated })
      },
    }),
    {
      name: 'chart-controls',
      storage: createJSONStorage(() => createURLStorage(URL_SYNC_KEYS)),
      partialize: (state) => {
        // Direct mapping - no legacy names needed
        return {
          hoursBack: state.hoursBack,
          interval: state.interval,
          tickers: state.chartTickers,
        }
      },
      onRehydrateStorage: () => (state) => {
        state?.setIsHydrated(true)
      },
      skipHydration: false,
    }
  )
)

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all unique tickers from the ticker market structure
 */
export const getAllTickers = (): string[] => {
  const allTickers = new Set<string>()
  tickersByMarket.forEach((market) => {
    market.tickers.forEach((ticker) => {
      ticker.value.forEach((t) => allTickers.add(t))
    })
  })
  return Array.from(allTickers)
}
