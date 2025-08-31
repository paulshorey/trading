'use client'

import React from 'react'
import { useChartControlsStore } from '../state/useChartControlsStore'

export default function PriceControl() {
  // Get state and actions from Zustand store
  const { controlTickers, priceTicker, setPriceTicker } =
    useChartControlsStore()

  return (
    <span className="flex flex-row justify-between border-gray-500 border-solid border rounded-md px-[2px] py-[1px] ml-1">
      {/* Price ticker selector */}
      <select
        value={priceTicker}
        onChange={(e) => setPriceTicker(e.target.value)}
        title="Select ticker for price chart"
      >
        {controlTickers.map((ticker) => (
          <option key={ticker} value={ticker}>
            {ticker}
          </option>
        ))}
      </select>
    </span>
  )
}
