'use client'

import React from 'react'
import InlineControls from './controls/InlineControls'
import classes from '../classes.module.scss'
import MarketControl from './controls/MarketControl'

export default function Header() {
  return (
    <div dir="ltr" className={classes.Header}>
      {/* Top bar */}
      <div className="relative flex flex-row justify-between z-[100]">
        {/* Left */}
        <MarketControl showLabel={false} />

        {/* Center */}
        <div className="flex-1 pl-2 py-1 mt-[12px] font-semibold text-gray-900 w-full text-center">
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
        <InlineControls />
      </div>
    </div>
  )
}
