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
    showStrengthLine,
    setShowStrengthLine,
    showIntervalLines,
    setShowIntervalLines,
    showPriceLine,
    setShowPriceLine,
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
      {/* Strength line toggles */}
      <div className="flex">
        <button
          onClick={() => setShowStrengthLine(!showStrengthLine)}
          className={`px-1.5 py-0.5 text-xs rounded-l transition-colors border-l border-t border-b`}
          style={{
            borderColor: showStrengthLine ? COLORS.strength : 'transparent',
            backgroundColor: showStrengthLine
              ? COLORS.strength + '20'
              : 'transparent',
            color: COLORS.strength,
          }}
          title="Show/hide aggregate strength line"
        >
          S
        </button>
        <button
          onClick={() => setShowIntervalLines(!showIntervalLines)}
          className={`px-1.5 py-0.5 text-xs rounded-r transition-colors border`}
          style={{
            borderColor: showIntervalLines ? COLORS.strength_i : 'transparent',
            backgroundColor: showIntervalLines
              ? COLORS.strength_i + '20'
              : 'transparent',
            color: COLORS.strength_i,
          }}
          title="Show/hide individual interval strength lines"
        >
          s
        </button>
      </div>
      {/* Price line toggles */}
      <div className="flex ml-1">
        <button
          onClick={() => setShowPriceLine(!showPriceLine)}
          className={`px-1.5 py-0.5 text-xs rounded-l transition-colors border-l border-t border-b`}
          style={{
            borderColor: showPriceLine ? COLORS.price : 'transparent',
            backgroundColor: showPriceLine
              ? COLORS.price + '20'
              : 'transparent',
            color: COLORS.price,
          }}
          title="Show/hide aggregate price line"
        >
          P
        </button>
        <button
          onClick={() => setShowTickerLines(!showTickerLines)}
          className={`px-1.5 py-0.5 text-xs rounded-r transition-colors border`}
          style={{
            borderColor: showTickerLines ? COLORS.price_i : 'transparent',
            backgroundColor: showTickerLines
              ? COLORS.price_i + '20'
              : 'transparent',
            color: COLORS.price_i,
          }}
          title="Show/hide individual ticker price lines"
        >
          p
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
