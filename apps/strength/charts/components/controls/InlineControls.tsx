'use client'

import React from 'react'
import IntervalControl from './IntervalControl'
import TimeControl from './TimeControl'
// import { ControlsDropdown } from './ControlsDropdown'
import { COLORS } from '../../constants'
import { useChartControlsStore } from '@/charts/state/useChartControlsStore'

export default function InlineControls({
  drawerNewsOpen,
  drawerCalendarOpen,
}: {
  drawerNewsOpen: () => void
  drawerCalendarOpen: () => void
}) {
  const {
    showIntervalLines,
    setShowIntervalLines,
    showTickerLines,
    setShowTickerLines,
  } = useChartControlsStore()
  return (
    <div
      className="flex flex-row justify-end mr-[10px] pt-[6px] scale2x"
      style={{ transformOrigin: 'right top' }}
    >
      <div className="">
        <div dir="ltr" className="flex flex-row">
          <span className="flex flex-row">
            <IntervalControl showLabel={false} />
          </span>
          <span className="flex flex-row">
            <TimeControl showLabel={false} />
          </span>
        </div>
      </div>
      <div>
        <button
          onClick={() => setShowIntervalLines(!showIntervalLines)}
          className={`px-2 py-0.5 text-xs rounded transition-colors border`}
          style={{
            borderColor: showIntervalLines ? COLORS.strength : 'transparent',
            color: COLORS.strength,
          }}
          title="Show/hide individual interval lines"
        >
          S
        </button>
      </div>
      <div>
        <button
          onClick={() => setShowTickerLines(!showTickerLines)}
          className={`px-2 py-0.5 text-xs rounded transition-colors border`}
          style={{
            borderColor: showTickerLines ? COLORS.price : 'transparent',
            color: COLORS.price,
          }}
          title="Show/hide individual ticker price lines"
        >
          P
        </button>
      </div>
      <div>
        <button
          className={`px-2 py-0.5 text-xs rounded transition-colors border border-transparent`}
          onClick={drawerNewsOpen}
        >
          N
        </button>
      </div>
      <div>
        <button
          className={`px-2 py-0.5 text-xs rounded transition-colors border border-transparent`}
          onClick={drawerCalendarOpen}
        >
          C
        </button>
      </div>
      {/* <ControlsDropdown /> */}
    </div>
  )
}
