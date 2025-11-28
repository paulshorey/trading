/**
 * Configuration Options for Chart Controls
 *
 * This file contains all the static configuration options used by the chart UI.
 * Separated from the store to keep state management logic clean.
 */

// ============================================================================
// INTERVAL OPTIONS
// ============================================================================

/**
 * All available strength data intervals (in minutes)
 * These correspond to database columns: 2, 4, 12, 30, 60, 240
 */
export const strengthIntervals = ['2', '4', '12', '30', '60', '240'] as const

export type StrengthInterval = (typeof strengthIntervals)[number]

/**
 * Available interval configurations for strength data aggregation
 * Each option represents a set of intervals to average together
 */
export const intervalsOptions = [
  { value: strengthIntervals as unknown as string[], label: 'all' },
  { value: ['12', '30', '60', '240'], label: 'long' },
  { value: ['2', '4', '12'], label: 'short' },
  { value: ['2'], label: '2m' },
  { value: ['4'], label: '4m' },
  { value: ['12'], label: '12m' },
  { value: ['30'], label: '30m' },
  { value: ['60'], label: '1h' },
  { value: ['240'], label: '4h' },
] as const

// ============================================================================
// TIME RANGE OPTIONS
// ============================================================================

/**
 * Available time range options for historical data display
 */
export const hoursBackOptions = ['120h', '96h', '72h', '48h', '24h']

// ============================================================================
// TICKER/MARKET OPTIONS
// ============================================================================

/**
 * Market categories and their ticker options
 * Organized by market type for the dropdown selector
 */
export const tickersByMarket = [
  {
    market: '',
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
    market: '----------',
    tickers: [
      { label: 'US Equities', value: ['NQ1!', 'ES1!', 'RTY1!', 'YM1!'] },
      { label: 'NQ1!', value: ['NQ1!'] },
      { label: 'ES1!', value: ['ES1!'] },
      { label: 'RTY1!', value: ['RTY1!'] },
      { label: 'YM1!', value: ['YM1!'] },
    ],
  },
  {
    market: '----------',
    tickers: [
      { label: 'Precious Metals', value: ['GC1!', 'SI1!', 'PL1!'] },
      { label: 'GC1!', value: ['GC1!'] },
      { label: 'SI1!', value: ['SI1!'] },
      { label: 'PL1!', value: ['PL1!'] },
    ],
  },
  {
    market: '----------',
    tickers: [
      { label: 'HG1!', value: ['HG1!'] },
      { label: 'CL1!', value: ['CL1!'] },
      { label: 'XC1!', value: ['XC1!'] },
      { label: 'XW1!', value: ['XW1!'] },
      { label: 'SB1!', value: ['SB1!'] },
      { label: 'ZL1!', value: ['ZL1!'] },
    ],
  },
  {
    market: '----------',
    tickers: [
      { label: 'Crypto', value: ['CX'] },
      { label: 'BTCUSD', value: ['BTCUSD'] },
      { label: 'ETHUSD', value: ['ETHUSD'] },
      { label: 'SOLUSD', value: ['SOLUSD'] },
      { label: 'XRPUSD', value: ['XRPUSD'] },
      { label: 'BNBUSD', value: ['BNBUSD'] },
      { label: 'SUIUSD', value: ['SUIUSD'] },
    ],
  },
] as const

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

/**
 * Get default tickers (first option from last market category - Crypto)
 */
export const getDefaultTickers = (): string[] => {
  return [...tickersByMarket[tickersByMarket.length - 1]!.tickers[0]!.value]
}

/**
 * Get default hours back value
 */
export const getDefaultHoursBack = (): string => {
  return hoursBackOptions[hoursBackOptions.length - 2]!
}

/**
 * Get default interval value
 */
export const getDefaultInterval = (): string[] => {
  return [...intervalsOptions[0]!.value]
}

