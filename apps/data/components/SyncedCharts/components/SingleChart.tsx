'use client'

import React, {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react'
import {
  createChart,
  IChartApi,
  LineData,
  LineSeries,
  MouseEventParams,
  ISeriesApi,
  Time,
} from 'lightweight-charts'
import { getChartConfig, getLineSeriesConfig } from '../lib/chartConfig'
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'

interface SingleChartProps {
  ticker: string
  chartData: LineData[] | null
  width: number
  height: number
  onCrosshairMove: (time: Time | null) => void
  chartIndex: number
}

export interface SingleChartRef {
  chart: IChartApi | null
  series: ISeriesApi<'Line'> | null
  container: HTMLDivElement | null
}

const SingleChart = forwardRef<SingleChartRef, SingleChartProps>(
  ({ ticker, chartData, width, height, onCrosshairMove, chartIndex }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const isUpdatingCursor = useRef(false)

    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      series: seriesRef.current,
      container: containerRef.current,
    }))

    useEffect(() => {
      if (!containerRef.current || !chartData) return

      // Create chart
      const chart = createChart(
        containerRef.current,
        getChartConfig(width, height)
      )
      chartRef.current = chart

      // Add line series
      const strengthSeries = chart.addSeries(LineSeries, getLineSeriesConfig())
      strengthSeries.setData(chartData)
      seriesRef.current = strengthSeries

      // Add crosshair event handlers for cursor synchronization
      chart.subscribeCrosshairMove((param: MouseEventParams) => {
        if (isUpdatingCursor.current) return

        if (param.time !== undefined && param.time !== null) {
          onCrosshairMove(param.time)
        } else {
          onCrosshairMove(null)
        }
      })

      // Cleanup
      return () => {
        chart.remove()
        chartRef.current = null
        seriesRef.current = null
      }
    }, [chartData, width, height, onCrosshairMove])

    const hasData = chartData !== null

    return (
      <div
        key={ticker}
        id={`strength-chart-${ticker}`}
        className="relative overflow-x-auto"
        style={{ marginTop: '-2px', marginBottom: '-30px' }}
        dir="rtl"
      >
        {/* Chart container */}
        <div
          ref={containerRef}
          style={{ width, height: height * 0.7 }}
          className="border border-gray-200 rounded relative z-10"
        />

        {/* Title positioned above chart but overlapping */}
        <ChartTitle ticker={ticker} hasData={hasData}>
          <NoDataState ticker={ticker} />
        </ChartTitle>
      </div>
    )
  }
)

SingleChart.displayName = 'SingleChart'

export default SingleChart
