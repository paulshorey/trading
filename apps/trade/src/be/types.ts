export type MarketOrderProps = {
  ticker: string
  side: 'SHORT' | 'LONG'
  /**
   * Size in dollars. Absolute amount to buy or sell. Sign will be ignored.
   */
  dollar: number
  /**
   * 1= 0.01%
   */
  sl?: number
}
