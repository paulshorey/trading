'use client'

import { SimpleChart } from '../../historical/SimpleChart'

/**
 * Historical Chart Page
 * 
 * A simple demonstration of lazy loading historical data in lightweight-charts.
 * Scroll left on the chart to load more historical data.
 * The scroll position should be preserved when new data loads.
 */
export default function HistoricalPage() {
  // Default ticker - can be changed
  const ticker = 'BTC-USD'
  
  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <SimpleChart ticker={ticker} />
    </div>
  )
}
