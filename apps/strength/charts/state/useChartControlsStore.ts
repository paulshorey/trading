import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { createURLStorage, getQueryParams } from './lib/urlSync'
import {
  getDefaultTickers,
  getDefaultHoursBack,
  getDefaultInterval,
} from './config'

// Re-export config for backward compatibility
export {
  strengthIntervals,
  intervalsOptions,
  hoursBackOptions,
  tickersByMarket,
  getAllTickers,
} from './config'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

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
  const defaultState: State = {
    hoursBack: getDefaultHoursBack(),
    interval: getDefaultInterval(),
    chartTickers: getDefaultTickers(),
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
