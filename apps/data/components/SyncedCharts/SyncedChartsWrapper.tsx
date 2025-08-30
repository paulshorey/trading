'use client'

import { useEffect, useState } from 'react'

import { SyncedCharts } from './SyncedCharts'

interface SyncedChartsWrapperProps {
  tickers?: string[]
  control_interval?: string
}

/**
 * Responsive wrapper component that calculates window dimensions
 * and renders charts only when document is ready
 */
export default function SyncedChartsWrapper({
  tickers = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD'],
  control_interval = '3',
}: SyncedChartsWrapperProps) {
  const [dimensions, setDimensions] = useState<{
    chartDimensionsWidth: number
    chartDimensionsHeight: number
  } | null>(null)

  useEffect(() => {
    // Function to calculate and set dimensions
    const updateDimensions = () => {
      if (typeof window !== 'undefined') {
        const windowWidth = window.innerWidth
        const windowHeight = window.innerHeight

        // Width = 100% of browser width
        const chartWidth = windowWidth - 0 // 0 padding left/right

        // Height = browser height divided by number of charts
        const availableHeight = windowHeight - 0 // 0 padding top/bottom
        const chartHeight = Math.floor(availableHeight / tickers.length)

        console.log({
          chartHeight,
          availableHeight,
          windowHeight,
        })

        setDimensions({
          chartDimensionsWidth: Math.max(chartWidth, 320), // Minimum width of 320px
          chartDimensionsHeight: Math.max(chartHeight, 200), // Minimum height of 200px per chart
        })
      }
    }

    // Initial calculation when component mounts
    updateDimensions()

    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateDimensions, 150) // Debounce by 150ms
    }

    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
    }
  }, [tickers.length])

  // Only render charts once we have dimensions
  if (!dimensions) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Initializing charts...</div>
      </div>
    )
  }

  return (
    <SyncedCharts
      width={dimensions.chartDimensionsWidth}
      height={dimensions.chartDimensionsHeight}
      tickers={tickers}
      control_interval={control_interval}
    />
  )
}
