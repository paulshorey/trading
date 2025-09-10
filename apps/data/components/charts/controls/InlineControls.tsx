'use client'

import React from 'react'
import StrengthControl from './StrengthControl'
import PriceControl from './PriceControl'
import IntervalControl from './IntervalControl'
import TimeControl from './TimeControl'

interface Props {}

export default function InlineControls({}: Props) {
  return (
    <span className="ml-2 flex">
      <span className="flex flex-row">
        {/* <span
                    className="pt-[1.5px] opacity-60"
                    style={{
                      scale: '0.9 1',
                      transformOrigin: 'left',
                      filter: 'brightness(1.3) contrast(1.2)',
                    }}
                  >
                    🦾
                  </span> */}
        <StrengthControl showLabel={false} />
      </span>
      <span className="flex flex-row">
        <span
          className="pt-[2px] pl-[3px] opacity-50"
          style={{
            filter: 'brightness(1.6) contrast(1.2) saturate(0)',
            scale: '0.9 1',
            transformOrigin: 'right',
          }}
        >
          💲
        </span>
        <PriceControl showLabel={false} />
      </span>
      <span className="flex flex-row">
        <span
          className="pt-[2px] pl-[5px] pr-[2px] opacity-80"
          style={{
            filter: 'contrast(0.6) brightness(1.3) saturate(0)',
          }}
        >
          🕓
        </span>
        <IntervalControl showLabel={false} />
      </span>
      <span className="flex flex-row">
        <span
          className="pt-[2px] pl-[6px] pr-[2px] opacity-50"
          style={{
            filter: 'saturate(0)',
          }}
        >
          🗓️
        </span>
        <TimeControl showLabel={false} />
      </span>
    </span>
  )
}
