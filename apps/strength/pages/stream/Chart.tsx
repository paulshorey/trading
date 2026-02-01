'use client'

import { useEffect, useRef, useState } from 'react'
import type { Candle } from '@/lib/market-data/candles'
import { useEventPatcher } from './ui/useEventPatcher'
import { useChart } from './plot/useChart'
import { usePolling } from './plot/usePolling'
import { COLORS, PRICE_SCALE_RIGHT_OFFSET } from './plot/constants'

interface ChartProps {
  width: number
  height: number
}

export function Chart({ width, height }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<Candle[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Patch mouse events to handle 2x scale factor
  useEventPatcher(containerRef)

  // Initialize chart and series
  const { chartRef, seriesRefs, absorptionRefs, hasInitialized } = useChart({
    containerRef,
    dataRef,
    width,
    height,
  })

  // Data fetching and polling
  const { fetchCandles, updateChartData, startPolling, stopPolling } =
    usePolling({
      dataRef,
      seriesRefs,
      absorptionRefs,
    })

  // Load initial data
  useEffect(() => {
    let isMounted = true
    const SCREEN_CANDLES = 2 * (width - PRICE_SCALE_RIGHT_OFFSET - 80)

    fetchCandles(SCREEN_CANDLES)
      .then((initialCandles) => {
        if (!isMounted) return
        if (initialCandles.length > 0) {
          dataRef.current = initialCandles
          updateChartData(initialCandles)

          // Show ~50% of the data, zoomed in with the latest candle visible
          if (chartRef.current) {
            const totalBars = initialCandles.length
            const barsToShow = Math.floor(totalBars * 0.5)
            const lastBarIndex = totalBars - 1
            const fromIndex = lastBarIndex - barsToShow

            chartRef.current.timeScale().setVisibleLogicalRange({
              from: fromIndex,
              to: lastBarIndex + 2,
            })
          }
        }
        setIsLoading(false)
        startPolling()
      })
      .catch((err) => {
        console.error('Error loading initial candles:', err)
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load data')
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
      stopPolling()
    }
  }, [
    fetchCandles,
    updateChartData,
    startPolling,
    stopPolling,
    chartRef,
    width,
  ])

  if (error) {
    return (
      <div
        style={{
          width: width + 'px',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: height + 'px',
            color: '#ff6b6b',
            background: COLORS.background,
          }}
        >
          Error: {error}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: width + 'px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} className="z-10" />

      {isLoading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: COLORS.background,
            color: COLORS.text,
            zIndex: 10,
          }}
        >
          Loading real-time data...
        </div>
      )}
    </div>
  )
}
