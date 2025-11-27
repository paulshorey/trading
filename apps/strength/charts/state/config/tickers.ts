/**
 * Market categories and their ticker options
 * This defines what tickers are available for selection in the charts
 */

export interface TickerOption {
  label: string
  value: string[]
}

export interface MarketGroup {
  market: string
  tickers: TickerOption[]
}

/**
 * Organized ticker options by market category
 */
export const tickersByMarket: MarketGroup[] = [
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
      // { label: 'DOGEUSD', value: ['DOGEUSD'] },
      // { label: 'AVAXUSD', value: ['AVAXUSD'] },
      // { label: 'XLMUSD', value: ['XLMUSD'] },
    ],
  },
]

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
 * Get default tickers (Crypto index)
 */
export const getDefaultTickers = (): string[] => {
  return tickersByMarket[tickersByMarket.length - 1]!.tickers[0]!.value
}
