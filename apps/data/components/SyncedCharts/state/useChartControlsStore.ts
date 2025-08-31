import { create } from 'zustand'
import { Time, LineData } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'

// Available intervals configuration
export const intervalsOptions = [
  { value: ['30S'], label: '30 sec' },
  { value: ['3'], label: '3 min' },
  { value: ['4'], label: '4 min' },
  { value: ['5'], label: '5 min' },
  { value: ['9'], label: '9 min' },
  { value: ['11'], label: '11 min' },
  { value: ['3', '4', '5', '9', '11'], label: '3m - 11m' },
  { value: ['30S', '3', '4', '5', '9', '11'], label: '30s - 11m' },
  { value: ['5', '9', '29', '30'], label: '5m, 9m, 29m, 30m' },
]

// Available tickers configuration
export const tickersOptions = [
  {
    label: 'ETH, BTC, SOL, XRP',
    value: ['ETHUSD', 'BTCUSD', 'SOLUSD', 'XRPUSD'],
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
    label: 'Treasuries',
    value: ['TN1!'],
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
  loadingState: boolean
  error: string | null
  rawData: (StrengthRowGet[] | null)[]
  aggregatedStrengthData: LineData[] | null
  aggregatedPriceData: LineData[] | null

  // Chart dimensions
  chartDimensions: { width: number; height: number }
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
  setLoadingState: (loading: boolean) => void
  setError: (error: string | null) => void
  setRawData: (data: (StrengthRowGet[] | null)[]) => void
  setAggregatedStrengthData: (data: LineData[] | null) => void
  setAggregatedPriceData: (data: LineData[] | null) => void

  // Chart dimensions setter
  setChartDimensions: (dimensions: { width: number; height: number }) => void

  // Utility actions
  resetToDefaults: () => void
  updateControlTickersAndPrice: (tickers: string[]) => void
}

export type ChartControlsStore = State & Actions

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
  loadingState: true,
  error: null,
  rawData: [],
  aggregatedStrengthData: null,
  aggregatedPriceData: null,

  // Chart dimensions defaults
  chartDimensions: { width: 320, height: 200 },
}

export const useChartControlsStore = create<ChartControlsStore>((set, get) => ({
  ...defaultState,

  // Control setters
  setHoursBack: (hours: number) => {
    set({ hoursBack: hours })
  },

  setControlInterval: (intervals: string[]) => {
    set({ controlInterval: intervals })
  },

  setControlTickers: (tickers: string[]) => {
    set({ controlTickers: tickers })
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
  setLoadingState: (loading: boolean) => {
    set({ loadingState: loading })
  },

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
    set(defaultState)
  },

  updateControlTickersAndPrice: (tickers: string[]) => {
    const currentPriceTicker = get().priceTicker
    // If current price ticker is not in new tickers list, set to first ticker
    const newPriceTicker = tickers.includes(currentPriceTicker)
      ? currentPriceTicker
      : tickers[0] || ''

    set({
      controlTickers: tickers,
      priceTicker: newPriceTicker,
    })
  },
}))
