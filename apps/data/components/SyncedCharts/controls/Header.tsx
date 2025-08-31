'use client'

import React from 'react'
import { ControlsDropdown } from './ControlsDropdown'

export default function Header() {
  return (
    <div className="flex flex-row pb-1 justify-between">
      <div className="flex-1"></div>
      <div className="flex flex-row justify-end">
        <ControlsDropdown />
      </div>
    </div>
  )
}
