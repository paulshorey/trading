import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Time, LineData } from 'lightweight-charts'
import { createURLStorage, getQueryParams } from '../lib/urlSync'
import { AVERAGE_OPTION } from '../constants'

// Available intervals configuration
export const intervalsOptions = [
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

// Available tickers configuration
export const tickersOptions = [
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
    label: 'CX',
    value: ['CX'],
  },
  {
    label: 'BTC',
    value: ['BTCUSD'],
  },
  {
    label: 'ETH',
    value: ['ETHUSD'],
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
    label: 'XLM',
    value: ['XLMUSD'],
  },
  {
    label: 'SUI',
    value: ['SUIUSD'],
  },
  {
    label: 'AVAX',
    value: ['AVAXUSD'],
  },
  {
    label: 'BNB',
    value: ['BNBUSD'],
  },
  {
    label: 'NEAR',
    value: ['NEARUSD'],
  },
  {
    label: 'DOGE',
    value: ['DOGEUSD'],
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
    label: 'GC1!, SI1!, PL1!',
    value: ['GC1!', 'SI1!', 'PL1!'],
  },
  {
    label: 'GC1!',
    value: ['GC1!'],
  },
  {
    label: 'SI1!',
    value: ['SI1!'],
  },
  {
    label: 'PL1!',
    value: ['PL1!'],
  },
]

type State = {
  // Control states
  hoursBack: string
  controlInterval: string[]
  controlTickers: string[]
  priceTicker: string

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
  setControlTickers: (tickers: string[]) => void
  setPriceTicker: (ticker: string) => void

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
  'controlTickers',
  'priceTicker',
]

// Get initial values from URL if available
const getInitialState = (): State => {
  // Start with defaults
  const defaultTickers = tickersOptions[8]!.value
  const defaultState: State = {
    // Control defaults
    hoursBack: hoursBackOptions[0]!,
    controlInterval: intervalsOptions[0]!.value,
    controlTickers: defaultTickers,
    // Default to "average" if multiple tickers, otherwise first ticker
    priceTicker:
      defaultTickers.length > 1 ? AVERAGE_OPTION : defaultTickers[0]!,

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

    if (urlParams.controlTickers !== undefined) {
      defaultState.controlTickers = urlParams.controlTickers
      // Update priceTicker if it's not valid for the new tickers list
      if (
        defaultState.priceTicker !== AVERAGE_OPTION &&
        !urlParams.controlTickers.includes(defaultState.priceTicker)
      ) {
        // Default to "average" if multiple tickers, otherwise first ticker
        defaultState.priceTicker =
          urlParams.controlTickers.length > 1
            ? AVERAGE_OPTION
            : urlParams.controlTickers[0] || ''
      }
    }

    if (urlParams.priceTicker !== undefined) {
      // Validate that the priceTicker is either "average" or in controlTickers
      const isValidTicker =
        urlParams.priceTicker === AVERAGE_OPTION ||
        defaultState.controlTickers.includes(urlParams.priceTicker)
      if (isValidTicker) {
        // Also check that "average" is only used when there are multiple tickers
        if (
          urlParams.priceTicker === AVERAGE_OPTION &&
          defaultState.controlTickers.length <= 1
        ) {
          defaultState.priceTicker = defaultState.controlTickers[0] || ''
        } else {
          defaultState.priceTicker = urlParams.priceTicker
        }
      }
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

      setControlTickers: (tickers: string[]) => {
        // Ensure we create a new array reference for proper React effect triggering
        set({ controlTickers: [...tickers] })
        // Reset priceTicker to "average" if multiple tickers
        if (tickers.length > 1) {
          set({ priceTicker: AVERAGE_OPTION })
        }
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
        const currentPriceTicker = get().priceTicker
        const currentTickers = get().controlTickers

        // Check if tickers actually changed
        const tickersChanged =
          JSON.stringify(currentTickers) !== JSON.stringify(tickers)

        if (!tickersChanged) {
          return
        }

        // Handle "average" option
        let newPriceTicker = currentPriceTicker

        // If current is "average", keep it if we still have multiple tickers
        if (currentPriceTicker === AVERAGE_OPTION) {
          newPriceTicker =
            tickers.length > 1 ? AVERAGE_OPTION : tickers[0] || ''
        }
        // If current ticker is not in new tickers list, set appropriately
        else if (!tickers.includes(currentPriceTicker)) {
          // Default to "average" if multiple tickers, otherwise first ticker
          newPriceTicker =
            tickers.length > 1 ? AVERAGE_OPTION : tickers[0] || ''
        }

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
