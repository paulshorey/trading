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
  IPriceLine,
} from 'lightweight-charts'
import { getChartConfig, getLineSeriesConfig } from '../lib/chartConfig'
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'
import classes from '../classes.module.scss'
import { CHART_WIDTH } from '../constants'

interface ChartProps {
  heading: string | React.ReactNode
  name: string
  chartData: LineData[] | null
  width: number
  height: number
  onCrosshairMove: (time: Time | null) => void
  chartIndex: number
  timeRange?: { from: Time; to: Time } | null
  showZeroLine?: boolean
  heightCropTop?: number
  heightCropBottom?: number
}

export interface ChartRef {
  chart: IChartApi | null
  series: ISeriesApi<'Line'> | null
  container: HTMLDivElement | null
}

export const Chart = forwardRef<ChartRef, ChartProps>(
  (
    {
      heading,
      name,
      chartData,
      width,
      height,
      onCrosshairMove,
      timeRange,
      showZeroLine,
      heightCropTop = 0,
      heightCropBottom = 0,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const zeroLineRef = useRef<IPriceLine | null>(null)
    const isUpdatingCursor = useRef(false)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)

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
        getChartConfig(height + heightCropTop + heightCropBottom)
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
      if (timeRange && timeRange.from < timeRange.to) {
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
        zeroLineRef.current = null
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - removed all dependencies

    // Update data when it changes with incremental updates
    useEffect(() => {
      if (!seriesRef.current || !chartData || !hasInitialized.current) return

      try {
        const prevData = lastDataRef.current
        const currentData = chartData

        if (!prevData || prevData.length === 0) {
          // Initial data load - use setData
          seriesRef.current.setData(currentData)
        } else {
          // Check if we need a full reset or can do incremental update
          const needsFullReset =
            currentData.length < prevData.length ||
            (currentData.length > 0 &&
              prevData.length > 0 &&
              currentData[0].time !== prevData[0].time)

          if (needsFullReset) {
            // Data structure changed significantly, do full reset
            seriesRef.current.setData(currentData)
          } else {
            // Incremental update - find new data points
            const lastPrevTime = prevData[prevData.length - 1]?.time
            if (lastPrevTime) {
              // Find new data points after the last previous time
              const newDataPoints = currentData.filter(
                (point) => (point.time as number) > (lastPrevTime as number)
              )

              // Update each new data point
              newDataPoints.forEach((point) => {
                seriesRef.current!.update(point)
              })

              // Also update any modified existing points (same time, different value)
              const modifiedPoints = currentData.filter((point) => {
                const prevPoint = prevData.find((p) => p.time === point.time)
                return prevPoint && prevPoint.value !== point.value
              })

              modifiedPoints.forEach((point) => {
                seriesRef.current!.update(point)
              })
            } else {
              // Fallback to full data set
              seriesRef.current.setData(currentData)
            }
          }
        }

        // Store current data for next comparison
        lastDataRef.current = [...currentData]

        // Reapply time range after data update
        if (timeRange && chartRef.current && timeRange.from < timeRange.to) {
          // Small delay to ensure data is rendered
          setTimeout(() => {
            if (
              chartRef.current &&
              timeRange &&
              timeRange.from < timeRange.to
            ) {
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
        height: height + heightCropTop + heightCropBottom,
      })
    }, [width, height])

    // Update time range when it changes
    useEffect(() => {
      if (!chartRef.current || !timeRange || !hasInitialized.current) return

      // Validate time range before setting
      if (timeRange.from >= timeRange.to) {
        console.warn('Invalid time range: from >= to', timeRange)
        return
      }

      try {
        chartRef.current.timeScale().setVisibleRange(timeRange)
      } catch (error) {
        console.warn('Failed to set visible range:', error)
      }
    }, [timeRange])

    // Handle showZeroLine changes
    useEffect(() => {
      if (!seriesRef.current || !hasInitialized.current) return

      // Remove existing zero line if it exists
      if (zeroLineRef.current) {
        seriesRef.current.removePriceLine(zeroLineRef.current)
        zeroLineRef.current = null
      }

      // Add zero line if requested
      if (showZeroLine) {
        const zeroLine = seriesRef.current.createPriceLine({
          price: 0,
          color: '#666666',
          lineWidth: 1,
          lineStyle: 2, // Dashed line
          axisLabelVisible: false,
          title: '',
        })
        zeroLineRef.current = zeroLine
      }
    }, [showZeroLine])

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
        className={classes.Chart}
        style={{
          width: CHART_WIDTH + 'px',
          overflow: 'hidden',
        }}
      >
        {/* Chart container */}
        <div
          ref={containerRef}
          className={`border border-gray-200 rounded z-10 pr-[10px]`}
          style={{
            marginTop: -heightCropTop + 'px',
          }}
        />

        {/* Title floating at top left of chart */}
        <ChartTitle heading={heading} hasData={hasData}>
          <NoDataState />
        </ChartTitle>
      </div>
    )
  }
)

Chart.displayName = 'Chart'
