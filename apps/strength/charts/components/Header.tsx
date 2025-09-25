'use client'

import React from 'react'
import { ControlsDropdown } from '../controls/ControlsDropdown'
import InlineControls from '../controls/InlineControls'
import classes from '../classes.module.scss'

export default function Header() {
  return (
    <div dir="ltr" className={classes.Header}>
      {/* Top bar */}
      <div className="relative flex flex-row justify-between z-[10000]">
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
          <ControlsDropdown />
        </div>
      </div>
    </div>
  )
}
