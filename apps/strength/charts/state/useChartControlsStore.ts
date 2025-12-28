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
 * Filter out intervals that are too noisy or not useful for default display
 */
const getDefaultIntervals = (intervals: readonly string[]): string[] => {
  const excludedIntervals = ['30S', '7', '19']
  return intervals.filter((i) => !excludedIntervals.includes(i))
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
export const hoursBackInitial = hoursBackOptions[hoursBackOptions.length - 3]!

/**
 * Market categories and their ticker options
 * This defines what tickers are available for selection
 */
export const tickersByMarket = [
  {
    market: '---equities---',
    tickers: [
      { label: 'All Indexes', value: ['NQ1!', 'ES1!', 'RTY1!'] },
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
    market: '---crypto---',
    tickers: [
      { label: 'BTC + SOL', value: ['BTCUSD', 'SOLUSD'] },
      { label: 'BTCUSD', value: ['BTCUSD'] },
      { label: 'SOLUSD', value: ['SOLUSD'] },
    ],
  },
]

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Individual interval strength data - keyed by interval string
 * Each interval (e.g., "30S", "1", "3") has its own line data
 */
export type StrengthIntervalsData = Record<string, LineData[] | null>

/**
 * Individual ticker price data - keyed by ticker symbol
 * Each ticker (e.g., "ES1!", "NQ1!") has its own line data
 */
export type PriceTickersData = Record<string, LineData[] | null>

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

  // Aggregated data for charts (averaged from intervals/tickers)
  strengthAverage: LineData[] | null
  priceAverage: LineData[] | null

  // Individual interval strength data (one line per interval)
  strengthIntervals: StrengthIntervalsData

  // Individual ticker price data (one line per ticker)
  priceTickers: PriceTickersData

  // Toggle for showing aggregate average strength line (default: true)
  showStrengthLine: boolean

  // Toggle for showing individual interval strength lines (default: false)
  showIntervalLines: boolean

  // Toggle for showing aggregate average price line (default: true)
  showPriceLine: boolean

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
  setStrengthAverage: (data: LineData[] | null) => void
  setPriceAverage: (data: LineData[] | null) => void
  setStrengthIntervals: (data: StrengthIntervalsData) => void
  setPriceTickers: (data: PriceTickersData) => void

  // Display toggles
  setShowStrengthLine: (show: boolean) => void
  setShowIntervalLines: (show: boolean) => void
  setShowPriceLine: (show: boolean) => void
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
    hoursBack: hoursBackInitial,
    interval: getDefaultIntervals(strengthIntervals),
    chartTickers: defaultTickers,
    timeRange: null,
    cursorTime: null,
    strengthAverage: null,
    priceAverage: null,
    strengthIntervals: {},
    priceTickers: {},
    showStrengthLine: false,
    showIntervalLines: true,
    showPriceLine: false,
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
    (set, get) => ({
      ...getInitialState(),

      // Configuration setters
      setHoursBack: (hours: string) => {
        const hoursNum = parseInt(hours)
        let interval = [...get().interval]
        if (hoursNum > 12) {
          interval = interval.filter((i) => i !== '30S')
        }
        if (hoursNum > 24) {
          interval = interval.filter((i) => i !== '1')
        }
        if (hoursNum > 48) {
          interval = interval.filter((i) => i !== '5')
        }
        set({ hoursBack: hours, interval })
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
      setStrengthAverage: (data: LineData[] | null) => {
        set({ strengthAverage: data })
      },

      setPriceAverage: (data: LineData[] | null) => {
        set({ priceAverage: data })
      },

      setStrengthIntervals: (data: StrengthIntervalsData) => {
        set({ strengthIntervals: { ...data } })
      },

      setPriceTickers: (data: PriceTickersData) => {
        set({ priceTickers: { ...data } })
      },

      // Display toggles
      setShowStrengthLine: (show: boolean) => {
        set({ showStrengthLine: show })
      },

      setShowIntervalLines: (show: boolean) => {
        set({ showIntervalLines: show })
      },

      setShowPriceLine: (show: boolean) => {
        set({ showPriceLine: show })
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
