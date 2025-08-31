'use client'

import React from 'react'
import {
  useChartControlsStore,
  tickersOptions,
} from '../state/useChartControlsStore'

export default function TopControls() {
  // Get state and actions from Zustand store
  const { controlTickers, updateControlTickersAndPrice } =
    useChartControlsStore()

  // Convert array to string for select value comparison
  const currentTickers = JSON.stringify(controlTickers)
  const onChangeTickers = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateControlTickersAndPrice(JSON.parse(e.target.value) as string[])
  }

  return (
    <span className="flex flex-row justify-between border-gray-500 border-solid border rounded-md px-[2px] py-[1px] ml-1">
      {/* Ticker selector */}
      <select value={currentTickers} onChange={onChangeTickers}>
        {tickersOptions.map((option) => (
          <option
            key={JSON.stringify(option.value)}
            value={JSON.stringify(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}
