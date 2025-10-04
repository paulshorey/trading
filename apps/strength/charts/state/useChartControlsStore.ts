import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { createURLStorage, getQueryParams } from './lib/urlSync'

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Available interval configurations for strength data aggregation
 * Each option represents a set of intervals to average together
 */
export const intervalsOptions = [
  { value: ['4', '12', '60', '240'], label: 'multi' },
  { value: ['1', '4', '12', '60', '240'], label: 'all' },
  { value: ['12', '60', '240'], label: 'long' },
  { value: ['1', '4', '12'], label: 'short' },
  { value: ['1'], label: '1m' },
  { value: ['4'], label: '5m' },
  { value: ['12'], label: '15m' },
  { value: ['60'], label: '1h' },
  { value: ['240'], label: '4h' },
]

/**
 * Available time range options for historical data
 */
export const hoursBackOptions = ['240h', '120h', '60h', '48h', '36h', '24h']

/**
 * Market categories and their ticker options
 * This defines what tickers are available for selection
 */
export const tickersByMarket = [
  {
    market: '',
    tickers: [{ label: 'TN1! Ten Year', value: ['TN1!'] }],
  },
  {
    market: '----------',
    tickers: [
      { label: 'US Equities', value: ['ES1!', 'YM1!'] },
      { label: 'ES1!', value: ['ES1!'] },
      { label: 'YM1!', value: ['YM1!'] },
    ],
  },
  {
    market: '----------',
    tickers: [
      { label: 'Metals', value: ['HG1!', 'GC1!', 'SI1!', 'PL1!'] },
      { label: 'Precious Metals', value: ['GC1!', 'SI1!', 'PL1!'] },
      { label: 'GC1!', value: ['GC1!'] },
      { label: 'SI1!', value: ['SI1!'] },
      { label: 'PL1!', value: ['PL1!'] },
      { label: 'HG1!', value: ['HG1!'] },
    ],
  },
  {
    market: '----------',
    tickers: [
      {
        label: 'Crypto Average',
        value: [
          'CX',
          'BTCUSD',
          'ETHUSD',
          'SOLUSD',
          'XRPUSD',
          'SUIUSD',
          'BNBUSD',
          'DOGEUSD',
          'AVAXUSD',
          'NEARUSD',
          'XLMUSD',
        ],
      },
      { label: 'CX', value: ['CX'] },
      { label: 'BTCUSD', value: ['BTCUSD'] },
      { label: 'ETHUSD', value: ['ETHUSD'] },
      { label: 'SOLUSD', value: ['SOLUSD'] },
      { label: 'XRPUSD', value: ['XRPUSD'] },
      { label: 'SUIUSD', value: ['SUIUSD'] },
      { label: 'BNBUSD', value: ['BNBUSD'] },
      { label: 'DOGEUSD', value: ['DOGEUSD'] },
      { label: 'AVAXUSD', value: ['AVAXUSD'] },
      { label: 'NEARUSD', value: ['NEARUSD'] },
      { label: 'XLMUSD', value: ['XLMUSD'] },
    ],
  },
]

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Store state for chart controls and data management
 */
type State = {
  // Time range configuration
  hoursBack: string

  // Interval selection for strength data aggregation
  controlInterval: string[]

  // Ticker selections
  dataPoolTickers: string[] // Tickers for which data is fetched (formerly marketTickers)
  strengthTickers: string[] // Tickers displayed in strength chart (formerly controlTickers)
  priceTickers: string[] // Tickers displayed in price chart

  // Time and cursor states
  timeRange: { from: Time; to: Time } | null
  cursorTime: Time | null

  // Aggregated data for charts
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Hydration state for URL sync
  isHydrated: boolean
}

/**
 * Store actions for updating state
 */
type Actions = {
  // Configuration setters
  setHoursBack: (hours: string) => void
  setControlInterval: (intervals: string[]) => void

  // Ticker selection setters
  setDataPoolTickers: (tickers: string[]) => void
  setStrengthTickers: (tickers: string[]) => void
  setPriceTickers: (tickers: string[]) => void

  // Convenience method to update all ticker selections at once
  setAllTickers: (tickers: string[]) => void

  // Time and cursor setters
  setTimeRange: (range: { from: Time; to: Time } | null) => void
  setCursorTime: (time: Time | null) => void

  // Data setters
  setAggregatedStrengthData: (data: LineData[] | null) => void
  setAggregatedPriceData: (data: LineData[] | null) => void

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
 * Note: Using legacy names for backward compatibility
 */
const URL_SYNC_KEYS = [
  'hoursBack',
  'controlInterval',
  'marketTickers', // Maps to dataPoolTickers
  'controlTickers', // Maps to strengthTickers
  'priceTickers',
]

// ============================================================================
// INITIALIZATION LOGIC
// ============================================================================

/**
 * Get initial state from URL parameters or defaults
 */
const getInitialState = (): State => {
  // Default to CX (Crypto Index) ticker
  const defaultTickers = tickersByMarket[3]!.tickers[1]!.value

  const defaultState: State = {
    hoursBack: hoursBackOptions[0]!,
    controlInterval: intervalsOptions[0]!.value,
    dataPoolTickers: defaultTickers,
    strengthTickers: defaultTickers,
    priceTickers: defaultTickers,
    timeRange: null,
    cursorTime: null,
    aggregatedStrengthData: null,
    aggregatedPriceData: null,
    isHydrated: false,
  }

  // Override with URL params if available
  if (typeof window !== 'undefined') {
    const urlParams = getQueryParams()

    if (urlParams.hoursBack !== undefined) {
      defaultState.hoursBack = urlParams.hoursBack
    }

    if (urlParams.controlInterval !== undefined) {
      defaultState.controlInterval = urlParams.controlInterval
    }

    // Map legacy URL param names to new state names
    if (urlParams.marketTickers !== undefined) {
      defaultState.dataPoolTickers = urlParams.marketTickers
    }

    if (urlParams.controlTickers !== undefined) {
      // Ensure strengthTickers are subset of dataPoolTickers
      const validTickers = urlParams.controlTickers.filter((ticker: string) =>
        defaultState.dataPoolTickers.includes(ticker)
      )
      defaultState.strengthTickers =
        validTickers.length > 0 ? validTickers : defaultState.dataPoolTickers
    }

    if (urlParams.priceTickers !== undefined) {
      // Ensure priceTickers are subset of dataPoolTickers
      const validTickers = urlParams.priceTickers.filter((ticker: string) =>
        defaultState.dataPoolTickers.includes(ticker)
      )
      defaultState.priceTickers =
        validTickers.length > 0 ? validTickers : defaultState.dataPoolTickers
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

      setControlInterval: (intervals: string[]) => {
        // Ensure new array reference for React effect triggering
        set({ controlInterval: [...intervals] })
      },

      // Ticker selection setters
      setDataPoolTickers: (tickers: string[]) => {
        set({ dataPoolTickers: [...tickers] })
      },

      setStrengthTickers: (tickers: string[]) => {
        set({ strengthTickers: [...tickers] })
      },

      setPriceTickers: (tickers: string[]) => {
        set({ priceTickers: [...tickers] })
      },

      setAllTickers: (tickers: string[]) => {
        // Convenience method to update all ticker selections at once
        // Used when changing markets
        set({
          dataPoolTickers: [...tickers],
          strengthTickers: [...tickers],
          priceTickers: [...tickers],
        })
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
        // Map internal names to legacy URL param names for backward compatibility
        return {
          hoursBack: state.hoursBack,
          controlInterval: state.controlInterval,
          marketTickers: state.dataPoolTickers, // Map to legacy name
          controlTickers: state.strengthTickers, // Map to legacy name
          priceTickers: state.priceTickers,
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
