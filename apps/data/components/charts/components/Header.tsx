'use client'

import React from 'react'
import { ControlsDropdown } from '../controls/ControlsDropdown'

export default function Header() {
  return (
    <div className="flex flex-row justify-between">
      <div className="flex-1 pl-2 py-1 font-semibold text-gray-900">
        <span
          style={{
            scale: '1.05 1',
            transformOrigin: 'left center',
          }}
        >
          strength<span className="text-gray-400">.finance</span>
        </span>
      </div>
      <div className="flex flex-row justify-end">
        <ControlsDropdown />
      </div>
    </div>
  )
}
