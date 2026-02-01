'use client'

import { SimpleChart } from '../../historical/SimpleChart'

/**
 * Historical Chart Page
 * 
 * A simple demonstration of lazy loading historical data in lightweight-charts.
 * Scroll left on the chart to load more historical data.
 * The scroll position should be preserved when new data loads.
 * 
 * Available tickers (from useChartControlsStore):
 * - Equities: NQ1!, ES1!, RTY1!
 * - Metals: GC1!, SI1!, PL1!, HG1!
 * - Crypto: BTCUSD, SOLUSD
 */
export default function HistoricalPage() {
  // Default ticker - use BTCUSD (not BTC-USD)
  const ticker = 'BTCUSD'
  
  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <SimpleChart ticker={ticker} />
    </div>
  )
}
