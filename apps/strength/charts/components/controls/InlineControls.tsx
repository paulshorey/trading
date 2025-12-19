'use client'

import React from 'react'
import IntervalControl from './IntervalControl'
import TimeControl from './TimeControl'
import { ControlsDropdown } from './ControlsDropdown'
import { useDisclosure } from '@mantine/hooks'
import { DrawerCalendar } from '../DrawerCalendar'
import { DrawerNews } from '../DrawerNews'
import { useChartControlsStore } from '../../state/useChartControlsStore'

export default function InlineControls() {
  const [drawerNewsOpened, { open: drawerNewsOpen, close: drawerNewsClose }] =
    useDisclosure(false)
  const [
    drawerCalendarOpened,
    { open: drawerCalendarOpen, close: drawerCalendarClose },
  ] = useDisclosure(false)

  const { showIntervalLines, setShowIntervalLines } = useChartControlsStore()

  return (
    <div
      className="flex flex-row justify-end mr-[10px] pt-[2px] scale2x"
      style={{ transformOrigin: 'right top' }}
    >
      <DrawerCalendar
        drawerOpened={drawerCalendarOpened}
        closeDrawer={drawerCalendarClose}
      />
      <DrawerNews
        drawerOpened={drawerNewsOpened}
        closeDrawer={drawerNewsClose}
      />
      <div className="pb-[3px] px-[4px] pt-[4px]">
        <div dir="ltr" className="flex flex-row">
          <span className="flex flex-row pr-2">
            <IntervalControl showLabel={false} />
          </span>
          <span className="flex flex-row">
            <TimeControl showLabel={false} />
          </span>
        </div>
      </div>
      <div className="pb-[3px] px-[4px] pt-[4px]">
        <button
          onClick={() => setShowIntervalLines(!showIntervalLines)}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            showIntervalLines
              ? 'bg-orange-500 text-white'
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
          }`}
          title="Show/hide individual interval lines"
        >
          ±
        </button>
      </div>
      <div className="pb-[3px] px-[4px] pt-[4px]">
        <button onClick={drawerNewsOpen}>N</button>
      </div>
      <div className="pb-[3px] px-[4px] pt-[4px]">
        <button onClick={drawerCalendarOpen}>C</button>
      </div>
      <ControlsDropdown />
    </div>
  )
}
