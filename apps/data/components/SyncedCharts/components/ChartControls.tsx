'use client'

import React from 'react'

interface ChartControlsProps {
  hoursBack: number
  onHoursBackChange: (hours: number) => void
  controlInterval: string[]
  onControlIntervalChange: (intervals: string[]) => void
  controlTickers: string[]
  onControlTickersChange: (tickers: string[]) => void
  priceTicker: string
  onPriceTickerChange: (ticker: string) => void
}

// Available intervals - these should match the column names in your strength table
// Each option can be a single interval or an array for averaging
export const intervalsOptions = [
  { value: ['30S'], label: '30 sec' },
  { value: ['3'], label: '3 min' },
  { value: ['4'], label: '4 min' },
  { value: ['5'], label: '5 min' },
  { value: ['9'], label: '9 min' },
  { value: ['11'], label: '11 min' },
  { value: ['3', '4', '5', '9', '11'], label: '3m - 11m' },
  { value: ['30S', '3', '4', '5', '9', '11'], label: '30s - 11m' },
]
export const tickersOptions = [
  {
    label: 'crypto',
    value: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD'],
  },
  {
    label: 'equities',
    value: ['ES1!', 'YM1!'],
  },
  {
    label: 'gold',
    value: ['GC1!'],
  },
  {
    label: 'treasuries',
    value: ['TN1!'],
  },
]

export default function ChartControls({
  hoursBack,
  onHoursBackChange,
  controlInterval,
  onControlIntervalChange,
  controlTickers,
  onControlTickersChange,
  priceTicker,
  onPriceTickerChange,
}: ChartControlsProps) {
  // Convert array to string for select value comparison
  const currentInterval = JSON.stringify(controlInterval)
  const onChangeInterval = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onControlIntervalChange(JSON.parse(e.target.value) as string[])
  }
  // Convert array to string for select value comparison
  const currentTickers = JSON.stringify(controlTickers)
  const onChangeTickers = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onControlTickersChange(JSON.parse(e.target.value) as string[])
  }

  return (
    <div className="flex flex-row pb-1 justify-between">
      {/* Ticker selector */}
      <select
        className="ml-2"
        value={currentTickers}
        onChange={onChangeTickers}
      >
        {tickersOptions.map((option) => (
          <option
            key={JSON.stringify(option.value)}
            value={JSON.stringify(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>

      {/* Price ticker selector */}
      <select
        className="ml-2"
        value={priceTicker}
        onChange={(e) => onPriceTickerChange(e.target.value)}
        title="Select ticker for price chart"
      >
        {controlTickers.map((ticker) => (
          <option key={ticker} value={ticker}>
            {ticker}
          </option>
        ))}
      </select>

      {/* Time range selector */}
      <select
        className="ml-2"
        value={hoursBack}
        onChange={(e) => onHoursBackChange(parseInt(e.target.value))}
        title="Select time range"
      >
        <option value={12}>12 hrs</option>
        <option value={24}>24 hrs</option>
        <option value={36}>36 hrs</option>
        <option value={48}>48 hrs</option>
        <option value={60}>60 hrs</option>
      </select>

      {/* Interval selector */}
      <div className="text-right">
        <select
          className="ml-2"
          value={currentInterval}
          onChange={onChangeInterval}
        >
          {intervalsOptions.map((option) => (
            <option
              key={JSON.stringify(option.value)}
              value={JSON.stringify(option.value)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
