'use client'

import React from 'react'
import IntervalControl from './IntervalControl'
import TimeControl from './TimeControl'

interface Props {}

export default function InlineControls({}: Props) {
  return (
    <div dir="ltr" className="flex flex-row">
      <span className="flex flex-row pr-2">
        {/* <span
          className="pt-[2px] pl-[5px] pr-[2px] opacity-80"
          style={{
            filter: 'contrast(0.6) brightness(1.3) saturate(0)',
          }}
        >
          🕓
        </span> */}
        <IntervalControl showLabel={false} />
      </span>
      <span className="flex flex-row">
        {/* <span
          className="pt-[2px] pl-[6px] pr-[2px] opacity-50"
          style={{
            filter: 'saturate(0)',
          }}
        >
          🗓️
        </span> */}
        <TimeControl showLabel={false} />
      </span>
    </div>
  )
}
