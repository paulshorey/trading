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
  heading: string | React.ReactNode
  name: string
  chartData: LineData[] | null
  width: number
  height: number
  onCrosshairMove: (time: Time | null) => void
  chartIndex: number
  timeRange?: { from: Time; to: Time } | null
}

export interface SingleChartRef {
  chart: IChartApi | null
  series: ISeriesApi<'Line'> | null
  container: HTMLDivElement | null
}

const SingleChart = forwardRef<SingleChartRef, SingleChartProps>(
  (
    { heading, name, chartData, width, height, onCrosshairMove, timeRange },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const isUpdatingCursor = useRef(false)
    const hasInitialized = useRef(false)

    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      series: seriesRef.current,
      container: containerRef.current,
    }))

    // Create chart only once on mount
    useEffect(() => {
      if (!containerRef.current || hasInitialized.current) return

      // Create chart
      const chart = createChart(
        containerRef.current,
        getChartConfig(width, height)
      )
      chartRef.current = chart
      hasInitialized.current = true

      // Add line series
      const strengthSeries = chart.addSeries(LineSeries, getLineSeriesConfig())
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

      // Set initial data if available
      if (chartData) {
        strengthSeries.setData(chartData)
      }

      // Apply initial time range if provided
      if (timeRange) {
        try {
          chart.timeScale().setVisibleRange(timeRange)
        } catch (error) {
          console.warn('Failed to set initial visible range:', error)
        }
      }

      // Cleanup
      return () => {
        chart.remove()
        chartRef.current = null
        seriesRef.current = null
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - removed all dependencies

    // Update data when it changes (without recreating chart)
    useEffect(() => {
      if (!seriesRef.current || !chartData || !hasInitialized.current) return

      try {
        seriesRef.current.setData(chartData)

        // Reapply time range after data update
        if (timeRange && chartRef.current) {
          // Small delay to ensure data is rendered
          setTimeout(() => {
            if (chartRef.current && timeRange) {
              try {
                chartRef.current.timeScale().setVisibleRange(timeRange)
              } catch (error) {
                console.warn(
                  'Failed to set visible range after data update:',
                  error
                )
              }
            }
          }, 10)
        }
      } catch (error) {
        console.warn('Failed to update chart data:', error)
      }
    }, [chartData, timeRange])

    // Update chart dimensions when they change
    useEffect(() => {
      if (!chartRef.current || !hasInitialized.current) return

      chartRef.current.applyOptions({
        width,
        height,
      })
    }, [width, height])

    // Update time range when it changes
    useEffect(() => {
      if (!chartRef.current || !timeRange || !hasInitialized.current) return

      try {
        chartRef.current.timeScale().setVisibleRange(timeRange)
      } catch (error) {
        console.warn('Failed to set visible range:', error)
      }
    }, [timeRange])

    // Handle crosshair updates from other charts
    useEffect(() => {
      isUpdatingCursor.current = true
      setTimeout(() => {
        isUpdatingCursor.current = false
      }, 0)
    }, [onCrosshairMove])

    const hasData = chartData !== null

    return (
      <div
        key={name}
        id={`chart-${name}`}
        className="relative overflow-x-auto"
        style={{ marginBottom: '-30px' }}
      >
        {/* Chart container */}
        <div
          dir="rtl"
          ref={containerRef}
          style={{ width, height: height }}
          className="border border-gray-200 rounded relative z-10"
        />

        {/* Title positioned above chart but overlapping */}
        <ChartTitle name={name} heading={heading} hasData={hasData}>
          <NoDataState />
        </ChartTitle>
      </div>
    )
  }
)

SingleChart.displayName = 'SingleChart'

export default SingleChart
