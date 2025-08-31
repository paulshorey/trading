'use client'

import React from 'react'

interface ChartTitleProps {
  name: string
  heading: string | React.ReactNode
  hasData: boolean
  children?: React.ReactNode
}

export default function ChartTitle({
  name,
  heading,
  hasData,
  children,
}: ChartTitleProps) {
  return (
    <div style={{ zIndex: 10000 }} className="absolute left-0 top-0">
      <div className="fixed left-0 bg-[var(--mantine-color-body)] opacity-50 pl-2 pr-3 py-1 rounded-br-xl shadow-sm font-bold">
        <h3 className="text-sm font-semibold leading-tight text-left flex justify-start align-bottom">
          <span>{name}:</span>
          <span>{heading}</span>
        </h3>
        {!hasData && children}
      </div>
    </div>
  )
}
