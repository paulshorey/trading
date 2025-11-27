'use client'

import { useRef } from 'react'
import { useAggregatedChartData } from './lib/hooks/useAggregatedChartData'

import { Chart, ChartRef } from './components/Chart'
import { LoadingState, ErrorState } from './components/ChartStates'
import { UpdatedTime } from './components/UpdatedTime'
import { useChartControlsStore } from './state/useChartControlsStore'
import MarketControl from './components/controls/MarketControl'
import { SCALE_FACTOR, CHART_WIDTH_FALLBACK } from './constants'

export interface SyncedChartsProps {
  availableHeight: number
  availableHeightCrop: number
}

/**
 * Component that renders a single chart with dual y-axes for strength and price
 *
 * This component orchestrates:
 * - Data fetching via useAggregatedChartData hook
 * - Chart rendering via Chart component
 * - UI controls for ticker selection
 */
export function SyncedCharts({ availableHeight }: SyncedChartsProps) {
  // Chart ref for single chart
  const chartRef = useRef<ChartRef | null>(null)

  // Get state from Zustand store
  const { chartTickers, timeRange } = useChartControlsStore()

  // Use the aggregated data hook - handles fetching, processing, and store updates
  const {
    strengthData,
    priceData,
    isLoading,
    error,
    lastUpdateTime,
    isRealtime,
  } = useAggregatedChartData({
    tickers: chartTickers,
    enabled: chartTickers.length > 0,
  })

  // Calculate chart width (2x for retina scaling)
  const chartWidth =
    typeof window !== 'undefined'
      ? window.innerWidth * SCALE_FACTOR
      : CHART_WIDTH_FALLBACK

  return (
    <div className="relative w-full">
      {/* Show loading or error state */}
      {isLoading && <LoadingState />}
      {error && !isLoading && <ErrorState error={error} />}

      {/* Render single chart with dual y-axes */}
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
          strengthData={strengthData}
          priceData={priceData}
          width={chartWidth}
          height={availableHeight}
          timeRange={timeRange}
          showZeroLine={true}
        />
      )}

      {/* Last updated time */}
      <UpdatedTime isRealtime={isRealtime} lastUpdateTime={lastUpdateTime} />

      {/* Ticker control */}
      <div
        className="fixed top-[33px] left-[9px] font-normal z-[100]"
        dir="ltr"
      >
        <div className="flex flex-row relative">
          <MarketControl showLabel={false} />
        </div>
      </div>

      {/* Target box for screen capture */}
      <div
        id="screenshot-target"
        className="absolute top-[34px] left-0 right-[8px] bottom-[34px] pointer-events-none"
      />
    </div>
  )
}
