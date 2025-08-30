'use client'

import React from 'react'

interface ChartControlsProps {
  hoursBack: number
  onHoursBackChange: (hours: number) => void
}

export default function ChartControls({
  hoursBack,
  onHoursBackChange,
}: ChartControlsProps) {
  return (
    <div className="controls-panel">
      <input
        type="range"
        min="4"
        max="168"
        step="1"
        value={hoursBack}
        onChange={(e) => onHoursBackChange(parseInt(e.target.value))}
        className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  )
}
