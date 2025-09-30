import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { createURLStorage, getQueryParams } from './lib/urlSync'
import { CHART_WIDTH_INITIAL } from '../constants'

// Available intervals configuration
export const intervalsOptions = [
  {
    value: ['4', '12', '60', '240'],
    label: 'multi',
  },
  {
    value: ['1', '4', '12', '60', '240'],
    label: 'all',
  },
  { value: ['12', '60', '240'], label: 'long' },
  { value: ['1', '4', '12'], label: 'short' },
  { value: ['1'], label: '1m' },
  { value: ['4'], label: '5m' },
  { value: ['12'], label: '15m' },
  { value: ['60'], label: '1h' },
  { value: ['240'], label: '4h' },
]

// Available hours back configuration
export const hoursBackOptions = ['240h', '120h', '60h', '48h', '36h', '24h']

// Master selector - determines options for strength selector
export const marketOptions = [
  {
    label: 'Crypto',
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
  {
    label: 'Equities',
    value: ['ES1!', 'YM1!'],
  },
  {
    label: 'Gold',
    value: ['GC1!'],
  },
  {
    label: 'Copper',
    value: ['HG1!'],
  },
  {
    label: 'Precious Metals',
    value: ['GC1!', 'SI1!', 'PL1!'],
  },
  {
    label: 'Treasuries',
    value: ['TN1!'],
  },
]

// Function to build strength options dynamically based on selected market
export const buildStrengthOptions = (marketTickers: string[]) => [
  {
    label: 'Average',
    value: marketTickers,
  },
  ...marketTickers.map((ticker) => ({
    label: ticker,
    value: [ticker],
  })),
]

// Function to build price options dynamically based on selected market
export const buildPriceOptions = (marketTickers: string[]) => [
  {
    label: 'Average',
    value: marketTickers,
  },
  ...marketTickers.map((ticker) => ({
    label: ticker,
    value: [ticker],
  })),
]

type State = {
  // Control states
  maxChartWidth: number
  hoursBack: string
  controlInterval: string[]
  marketTickers: string[] // Selected market tickers (from marketOptions)
  controlTickers: string[] // Selected strength tickers (subset of marketTickers)
  priceTickers: string[] // Selected price tickers (subset of marketTickers)

  // Time and cursor states
  timeRange: { from: Time; to: Time } | null
  cursorTime: Time | null

  // Data states - only aggregated data, raw data managed by hook
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Hydration state for URL sync
  isHydrated: boolean
}

type Actions = {
  // Control setters
  setHoursBack: (hours: string) => void
  setControlInterval: (intervals: string[]) => void
  setMarketTickers: (tickers: string[]) => void
  setControlTickers: (tickers: string[]) => void
  setPriceTickers: (tickers: string[]) => void

  // Time and cursor setters
  setTimeRange: (range: { from: Time; to: Time } | null) => void
  setCursorTime: (time: Time | null) => void

  // Data setters - removed raw data and error (managed by hook)
  setAggregatedStrengthData: (data: LineData[] | null) => void
  setAggregatedPriceData: (data: LineData[] | null) => void

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
  'marketTickers',
  'controlTickers',
  'priceTickers',
]

// Get initial values from URL if available
const getInitialState = (): State => {
  // Start with defaults - use first market option (Crypto)
  const defaultMarketTickers = marketOptions[0]!.value
  const defaultState: State = {
    // Control defaults
    maxChartWidth: CHART_WIDTH_INITIAL,
    hoursBack: hoursBackOptions[0]!,
    controlInterval: intervalsOptions[0]!.value,
    marketTickers: defaultMarketTickers,
    controlTickers: defaultMarketTickers, // Start with all market tickers for strength
    priceTickers: defaultMarketTickers, // Start with all market tickers for price

    // Time and cursor defaults
    timeRange: null,
    cursorTime: null,

    // Data defaults - removed raw data and error
    aggregatedStrengthData: null,
    aggregatedPriceData: null,

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

    if (urlParams.marketTickers !== undefined) {
      defaultState.marketTickers = urlParams.marketTickers
    }

    if (urlParams.controlTickers !== undefined) {
      // Ensure controlTickers are subset of marketTickers
      const validControlTickers = urlParams.controlTickers.filter(
        (ticker: string) => defaultState.marketTickers.includes(ticker)
      )
      defaultState.controlTickers =
        validControlTickers.length > 0
          ? validControlTickers
          : defaultState.marketTickers
    }

    if (urlParams.priceTickers !== undefined) {
      // Ensure priceTickers are subset of marketTickers
      const validPriceTickers = urlParams.priceTickers.filter(
        (ticker: string) => defaultState.marketTickers.includes(ticker)
      )
      defaultState.priceTickers =
        validPriceTickers.length > 0
          ? validPriceTickers
          : defaultState.marketTickers
    }
  }

  return defaultState
}

export const useChartControlsStore = create<ChartControlsStore>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      // Control setters
      setHoursBack: (hours: string) => {
        set({ hoursBack: hours })
      },

      setControlInterval: (intervals: string[]) => {
        // Ensure we create a new array reference for proper React effect triggering
        set({ controlInterval: [...intervals] })
      },

      setMarketTickers: (tickers: string[]) => {
        const newMarketTickers = [...tickers]
        console.log(
          '[Store] Market changed, resetting both Strength and Price to Average:',
          {
            newMarketTickers,
          }
        )
        set((state) => {
          // When market changes, reset both strength and price to use all market tickers (Average)
          return {
            marketTickers: newMarketTickers,
            controlTickers: newMarketTickers, // Reset to Average
            priceTickers: newMarketTickers, // Reset to Average
          }
        })
      },

      setControlTickers: (tickers: string[]) => {
        // When Strength (control) tickers change, also update Price tickers to match
        // This makes Strength act as the master selector that sets the default for Price
        console.log(
          '[Store] Strength selector changed, updating both Strength and Price:',
          {
            newTickers: tickers,
          }
        )
        set({
          controlTickers: [...tickers],
          priceTickers: [...tickers], // Price follows Strength
        })
      },

      setPriceTickers: (tickers: string[]) => {
        // Price can be changed independently without affecting Strength
        console.log('[Store] Price selector changed independently:', {
          newPriceTickers: tickers,
        })
        // Ensure we create a new array reference for proper React effect triggering
        set({ priceTickers: [...tickers] })
      },

      // Time and cursor setters
      setTimeRange: (range: { from: Time; to: Time } | null) => {
        set({ timeRange: range })
      },

      setCursorTime: (time: Time | null) => {
        set({ cursorTime: time })
      },

      // Data setters - removed raw data and error setters
      setAggregatedStrengthData: (data: LineData[] | null) => {
        set({ aggregatedStrengthData: data })
      },

      setAggregatedPriceData: (data: LineData[] | null) => {
        set({ aggregatedPriceData: data })
      },

      // Utility actions
      resetToDefaults: () => {
        const freshDefaults = getInitialState()
        set(freshDefaults)
      },

      updateControlTickersAndPrice: (tickers: string[]) => {
        // Legacy method for backward compatibility - just update controlTickers
        set({ controlTickers: [...tickers] })
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
