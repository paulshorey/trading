'use client'

import React from 'react'

interface ChartTitleProps {
  ticker: string
  hasData: boolean
  children?: React.ReactNode
}

export default function ChartTitle({
  ticker,
  hasData,
  children,
}: ChartTitleProps) {
  return (
    <div style={{ zIndex: 1000 }} className="absolute left-0 top-0">
      <div className="fixed left-0 bg-[var(--mantine-color-body)] opacity-50 pl-2 pr-3 py-1 rounded-br-xl shadow-sm pointer-events-none font-bold">
        <h3 className="text-sm font-semibold leading-tight text-left">
          {ticker}
        </h3>
        {!hasData && children}
      </div>
    </div>
  )
}
