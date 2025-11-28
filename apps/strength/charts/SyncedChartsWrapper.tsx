'use client'

import { useEffect, useState } from 'react'

import { SyncedCharts } from './SyncedCharts'
import { useChartControlsStore } from './state'
import Header from './components/Header'
import classes from './classes.module.scss'

interface SyncedChartsWrapperProps {}

/**
 * Entry point wrapper component that:
 * 1. Waits for window dimensions to be available
 * 2. Waits for Zustand store to hydrate from URL query parameters
 * 3. Renders charts only when both are ready
 *
 * This ensures charts initialize with correct size and URL parameters.
 */
export default function SyncedChartsWrapper({}: SyncedChartsWrapperProps) {
  const [dimensions, setDimensions] = useState<{
    availableWidth: number
    availableHeight: number
  } | null>(null)

  // Wait for store hydration from URL
  const isHydrated = useChartControlsStore((state) => state.isHydrated)

  useEffect(() => {
    const updateDimensions = () => {
      if (typeof window !== 'undefined') {
        setDimensions({
          availableWidth: window.innerWidth * 2,
          availableHeight: window.innerHeight * 2,
        })
      }
    }

    updateDimensions()

    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(updateDimensions, 150)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Wait for dimensions and store hydration
  if (!dimensions || !isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Initializing charts...</div>
      </div>
    )
  }

  return (
    <div className={`overflow-auto w-full ${classes.Wrapper}`} dir="rtl">
      <Header />
      <SyncedCharts
        availableHeight={dimensions.availableHeight}
        availableHeightCrop={40}
      />
    </div>
  )
}
