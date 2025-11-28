/**
 * Chart Controls Zustand Store
 *
 * Central state management for the charts mini-app.
 * Handles user preferences (tickers, intervals, time range) and chart data.
 *
 * State is automatically synced with URL query parameters for bookmarkable URLs.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'

import { createURLStorage, getQueryParams } from './urlSync'
import {
  intervalsOptions,
  getDefaultTickers,
  getDefaultHoursBack,
  getDefaultInterval,
} from './options'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Store state - what data is stored
 */
type State = {
  // User preferences (synced with URL)
  hoursBack: string
  interval: string[]
  chartTickers: string[]

  // Derived/computed state (not synced with URL)
  timeRange: { from: Time; to: Time } | null
  cursorTime: Time | null
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Internal state
  isHydrated: boolean
}

/**
 * Store actions - how to update state
 */
type Actions = {
  // User preference setters
  setHoursBack: (hours: string) => void
  setInterval: (intervals: string[]) => void
  setChartTickers: (tickers: string[]) => void

  // Computed state setters
  setTimeRange: (range: { from: Time; to: Time } | null) => void
  setCursorTime: (time: Time | null) => void
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
 */
const URL_SYNC_KEYS = ['hoursBack', 'interval', 'tickers']

// ============================================================================
// INITIAL STATE
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

  // Override with URL params if available (client-side only)
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
// STORE
// ============================================================================

export const useChartControlsStore = create<ChartControlsStore>()(
  persist(
    (set) => ({
      ...getInitialState(),

      // User preference setters
      setHoursBack: (hours) => set({ hoursBack: hours }),

      setInterval: (intervals) => set({ interval: [...intervals] }),

      setChartTickers: (tickers) => set({ chartTickers: [...tickers] }),

      // Computed state setters
      setTimeRange: (range) => set({ timeRange: range }),

      setCursorTime: (time) => set({ cursorTime: time }),

      setAggregatedStrengthData: (data) =>
        set({ aggregatedStrengthData: data }),

      setAggregatedPriceData: (data) => set({ aggregatedPriceData: data }),

      // Utility actions
      resetToDefaults: () => set(getInitialState()),

      setIsHydrated: (hydrated) => set({ isHydrated: hydrated }),
    }),
    {
      name: 'chart-controls',
      storage: createJSONStorage(() => createURLStorage(URL_SYNC_KEYS)),
      partialize: (state) => ({
        hoursBack: state.hoursBack,
        interval: state.interval,
        tickers: state.chartTickers,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setIsHydrated(true)
      },
      skipHydration: false,
    }
  )
)

// Re-export options for convenience (backwards compatibility)
export {
  strengthIntervals,
  intervalsOptions,
  hoursBackOptions,
  tickersByMarket,
  getAllTickers,
} from './options'


