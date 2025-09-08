import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'
import { createURLStorage, getQueryParams } from '../lib/urlSync'

// Available intervals configuration
export const intervalsOptions = [
  { value: ['15S'], label: '15 sec' },
  { value: ['3'], label: '3 min' },
  { value: ['7'], label: '7 min' },
  { value: ['44'], label: '44 min' },
  { value: ['59'], label: '59 min' },
  { value: ['180'], label: '180 min' },
  { value: ['15S', '3', '7'], label: 'short' },
  { value: ['44', '59', '180'], label: 'long' },
  { value: ['15S', '3', '7', '44', '59', '180'], label: 'all' },
]

// Available tickers configuration
export const tickersOptions = [
  {
    label: 'GC1!',
    value: ['GC1!'],
  },
  {
    label: 'ES1!, YM1!',
    value: ['ES1!', 'YM1!'],
  },
  {
    label: 'ES1!',
    value: ['ES1!'],
  },
  {
    label: 'YM1!',
    value: ['YM1!'],
  },
  {
    label: 'TN1!',
    value: ['TN1!'],
  },
  {
    label: 'ETH, BTC, SOL, XRP, SUI, BNB',
    value: ['ETHUSD', 'BTCUSD', 'SOLUSD', 'XRPUSD', 'SUIUSD', 'BNBUSD'],
  },
  {
    label: 'ETH',
    value: ['ETHUSD'],
  },
  {
    label: 'BTC',
    value: ['BTCUSD'],
  },
  {
    label: 'SOL',
    value: ['SOLUSD'],
  },
  {
    label: 'XRP',
    value: ['XRPUSD'],
  },
  {
    label: 'SUI',
    value: ['SUIUSD'],
  },
  {
    label: 'BNB',
    value: ['BNBUSD'],
  },
]

type State = {
  // Control states
  hoursBack: number
  controlInterval: string[]
  controlTickers: string[]
  priceTicker: string

  // Time and cursor states
  timeRange: { from: Time; to: Time } | null
  cursorTime: Time | null

  // Data states
  error: string | null
  rawData: (StrengthRowGet[] | null)[]
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Chart dimensions
  chartDimensions: { width: number; height: number }

  // Hydration state for URL sync
  isHydrated: boolean
}

type Actions = {
  // Control setters
  setHoursBack: (hours: number) => void
  setControlInterval: (intervals: string[]) => void
  setControlTickers: (tickers: string[]) => void
  setPriceTicker: (ticker: string) => void

  // Time and cursor setters
  setTimeRange: (range: { from: Time; to: Time } | null) => void
  setCursorTime: (time: Time | null) => void

  // Data setters
  setError: (error: string | null) => void
  setRawData: (data: (StrengthRowGet[] | null)[]) => void
  setAggregatedStrengthData: (data: LineData[] | null) => void
  setAggregatedPriceData: (data: LineData[] | null) => void

  // Chart dimensions setter
  setChartDimensions: (dimensions: { width: number; height: number }) => void

  // Utility actions
  resetToDefaults: () => void
  updateControlTickersAndPrice: (tickers: string[]) => void
  setIsHydrated: (hydrated: boolean) => void
}

export type ChartControlsStore = State & Actions

// Keys to sync with URL
const URL_SYNC_KEYS = [
  'hoursBack',
  'controlInterval',
  'controlTickers',
  'priceTicker',
]

// Get initial values from URL if available
const getInitialState = (): State => {
  // Start with defaults
  const defaultState: State = {
    // Control defaults
    hoursBack: 60,
    controlInterval: intervalsOptions[intervalsOptions.length - 1]!.value,
    controlTickers: tickersOptions[0]!.value,
    priceTicker: tickersOptions[0]!.value[0]!,

    // Time and cursor defaults
    timeRange: null,
    cursorTime: null,

    // Data defaults
    error: null,
    rawData: [],
    aggregatedStrengthData: null,
    aggregatedPriceData: null,

    // Chart dimensions defaults
    chartDimensions: { width: 320, height: 200 },

    // Hydration state - will be set to true after persist middleware loads
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

    if (urlParams.controlTickers !== undefined) {
      defaultState.controlTickers = urlParams.controlTickers
      // Update priceTicker if it's not in the new tickers list
      if (!urlParams.controlTickers.includes(defaultState.priceTicker)) {
        defaultState.priceTicker = urlParams.controlTickers[0] || ''
      }
    }

    if (urlParams.priceTicker !== undefined) {
      defaultState.priceTicker = urlParams.priceTicker
    }
  }

  return defaultState
}

export const useChartControlsStore = create<ChartControlsStore>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      // Control setters
      setHoursBack: (hours: number) => {
        set({ hoursBack: hours })
      },

      setControlInterval: (intervals: string[]) => {
        // Ensure we create a new array reference for proper React effect triggering
        set({ controlInterval: [...intervals] })
      },

      setControlTickers: (tickers: string[]) => {
        // Ensure we create a new array reference for proper React effect triggering
        set({ controlTickers: [...tickers] })
      },

      setPriceTicker: (ticker: string) => {
        set({ priceTicker: ticker })
      },

      // Time and cursor setters
      setTimeRange: (range: { from: Time; to: Time } | null) => {
        set({ timeRange: range })
      },

      setCursorTime: (time: Time | null) => {
        set({ cursorTime: time })
      },

      // Data setters
      setError: (error: string | null) => {
        set({ error: error })
      },

      setRawData: (data: (StrengthRowGet[] | null)[]) => {
        set({ rawData: data })
      },

      setAggregatedStrengthData: (data: LineData[] | null) => {
        set({ aggregatedStrengthData: data })
      },

      setAggregatedPriceData: (data: LineData[] | null) => {
        set({ aggregatedPriceData: data })
      },

      // Chart dimensions setter
      setChartDimensions: (dimensions: { width: number; height: number }) => {
        set({ chartDimensions: dimensions })
      },

      // Utility actions
      resetToDefaults: () => {
        const freshDefaults = getInitialState()
        set(freshDefaults)
      },

      updateControlTickersAndPrice: (tickers: string[]) => {
        const currentPriceTicker = get().priceTicker
        const currentTickers = get().controlTickers

        // Check if tickers actually changed
        const tickersChanged =
          JSON.stringify(currentTickers) !== JSON.stringify(tickers)

        if (!tickersChanged) {
          return
        }

        // If current price ticker is not in new tickers list, set to first ticker
        const newPriceTicker = tickers.includes(currentPriceTicker)
          ? currentPriceTicker
          : tickers[0] || ''

        // Ensure we create a new array reference for proper React effect triggering
        const newTickers = [...tickers]

        set({
          controlTickers: newTickers,
          priceTicker: newPriceTicker,
        })
      },

      setIsHydrated: (hydrated: boolean) => {
        set({ isHydrated: hydrated })
      },
    }),
    {
      name: 'chart-controls',
      storage: createJSONStorage(() => createURLStorage(URL_SYNC_KEYS)),
      partialize: (state) => {
        // Only persist the URL sync keys
        const partialState: any = {}
        URL_SYNC_KEYS.forEach((key) => {
          partialState[key] = (state as any)[key]
        })
        return partialState
      },
      // Handle hydration completion
      onRehydrateStorage: () => (state) => {
        // This callback is called after hydration completes
        state?.setIsHydrated(true)
      },
      // Skip hydration after initial load to prevent overwriting user changes
      skipHydration: false,
    }
  )
)
