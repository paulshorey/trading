'use client'

import { useRef } from 'react'

import { useStrengthData, useAggregatedData } from './data'
import { useChartControlsStore } from './state'
import { HOURS_BACK_INITIAL } from './constants'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import MarketControl from './components/controls/MarketControl'

export interface SyncedChartsProps {
  availableHeight: number
  availableHeightCrop: number
}

/**
 * Main chart component that orchestrates data and rendering
 *
 * Responsibilities:
 * 1. Read user preferences from store (chartTickers)
 * 2. Fetch data via useStrengthData hook
 * 3. Process data via useAggregatedData hook
 * 4. Render Chart component with processed data
 *
 * All data processing logic has been extracted to hooks for cleaner separation.
 */
export function SyncedCharts({ availableHeight }: SyncedChartsProps) {
  const chartRef = useRef<ChartRef | null>(null)

  // Get user preferences from store
  const { chartTickers, aggregatedStrengthData, aggregatedPriceData, timeRange } =
    useChartControlsStore()

  // Fetch raw data for selected tickers
  const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
    useStrengthData({
      tickers: chartTickers,
      enabled: chartTickers.length > 0,
      maxDataHours: HOURS_BACK_INITIAL,
      updateIntervalMs: 60000,
    })

  // Process raw data into chart-ready format
  // This hook updates the store with aggregated data and time range
  useAggregatedData({
    rawData,
    lastUpdateTime,
  })

  return (
    <div className="relative w-full">
      {/* Loading and error states */}
      {isLoading && <LoadingState />}
      {error && !isLoading && <ErrorState error={error} />}

      {/* Chart with dual y-axes */}
      {!isLoading && !error && (
        <Chart
          key="combined-chart"
          ref={(el) => {
            chartRef.current = el
          }}
          name="Strength & Price"
          heading={
            <span className="flex flex-row pl-[5px]">
              <span className="pt-1 pr-1 pl-1 opacity-90 text-sm">
                <span className="text-[#0084ff]">Price</span>
                <span className="text-gray-500"> / </span>
                <span className="text-[#ff8800]">Strength</span>
              </span>
            </span>
          }
          strengthData={aggregatedStrengthData}
          priceData={aggregatedPriceData}
          width={typeof window !== 'undefined' ? window.innerWidth * 2 : 1200}
          height={availableHeight}
          timeRange={timeRange}
          showZeroLine={true}
        />
      )}

      {/* Real-time update indicator */}
      <UpdatedTime isRealtime={isRealtime} lastUpdateTime={lastUpdateTime} />

      {/* Ticker selector */}
      <div
        className="fixed top-[33px] left-[9px] font-normal z-[100]"
        dir="ltr"
      >
        <div className="flex flex-row relative">
          <MarketControl showLabel={false} />
        </div>
      </div>

      {/* Screenshot target area */}
      <div
        id="screenshot-target"
        className="absolute top-[34px] left-0 right-[8px] bottom-[34px] pointer-events-none"
      />
    </div>
  )
}
