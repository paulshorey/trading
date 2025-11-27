'use client'

import React from 'react'
import { useDisclosure } from '@mantine/hooks'
import { ControlsDropdown } from './controls/ControlsDropdown'
import InlineControls from './controls/InlineControls'
import classes from '../classes.module.scss'
import { DrawerCalendar, DrawerNews } from './drawers'

export default function Header() {
  const [drawerNewsOpened, { open: drawerNewsOpen, close: drawerNewsClose }] =
    useDisclosure(false)
  const [
    drawerCalendarOpened,
    { open: drawerCalendarOpen, close: drawerCalendarClose },
  ] = useDisclosure(false)

  return (
    <>
      <DrawerCalendar
        drawerOpened={drawerCalendarOpened}
        closeDrawer={drawerCalendarClose}
      />
      <DrawerNews
        drawerOpened={drawerNewsOpened}
        closeDrawer={drawerNewsClose}
      />

      <div dir="ltr" className={classes.Header}>
        {/* Top bar */}
        <div className="relative flex flex-row justify-between z-[100]">
          {/* Left */}
          <div className="flex-1 pl-2 py-1 mt-[2px] font-semibold text-gray-900">
            <span
              style={{
                scale: '1.05 1',
                transformOrigin: 'left center',
              }}
            >
              strength<span className="text-gray-400">.finance</span>
            </span>
          </div>
          {/* Right */}
          <div className="flex flex-row justify-end mr-[10px] pt-[2px]">
            <div className="pb-[3px] px-[4px] pt-[4px]">
              <InlineControls />
            </div>
            <div className="pb-[3px] px-[4px] pt-[4px]">
              <button onClick={drawerNewsOpen}>N</button>
            </div>
            <div className="pb-[3px] px-[4px] pt-[4px]">
              <button onClick={drawerCalendarOpen}>C</button>
            </div>
            <ControlsDropdown />
          </div>
        </div>
      </div>
    </>
  )
}
