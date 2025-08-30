'use client'

import React from 'react'

interface ChartControlsProps {
  hoursBack: number
  onHoursBackChange: (hours: number) => void
  controlInterval: string
  onControlIntervalChange: (interval: string) => void
}

// Available intervals - these should match the column names in your strength table
const INTERVAL_OPTIONS = [
  { value: '30S', label: '30 sec' },
  { value: '3', label: '3 min' },
  { value: '4', label: '4 min' },
  { value: '5', label: '5 min' },
  { value: '9', label: '9 min' },
  { value: '11', label: '11 min' },
]

export default function ChartControls({
  hoursBack,
  onHoursBackChange,
  controlInterval,
  onControlIntervalChange,
}: ChartControlsProps) {
  return (
    <div className="flex flex-row">
      {/* Time range slider */}
      <div className="flex flex-1">
        <label>{hoursBack} hrs</label>
        <input
          className="flex-1 mx-2"
          type="range"
          min="12"
          max="60"
          step="1"
          value={hoursBack}
          onChange={(e) => onHoursBackChange(parseInt(e.target.value))}
        />
      </div>

      {/* Interval selector */}
      <div className="min-w-[150px] text-right">
        <select
          className="mx-2"
          value={controlInterval}
          onChange={(e) => onControlIntervalChange(e.target.value)}
        >
          {INTERVAL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
