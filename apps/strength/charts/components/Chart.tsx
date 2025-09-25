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
          // For real-time updates, we need to be careful with update()
          // It can only update the last bar or add new ones after it

          const lastPrevTime = prevData[prevData.length - 1]?.time as number
          const lastCurrentTime = currentData[currentData.length - 1]
            ?.time as number
          const firstPrevTime = prevData[0]?.time as number
          const firstCurrentTime = currentData[0]?.time as number

          // Check if data structure changed significantly
          if (
            currentData.length < prevData.length ||
            firstCurrentTime !== firstPrevTime
          ) {
            // Data was truncated or shifted - need full reset
            seriesRef.current.setData(currentData)
          } else if (lastCurrentTime > lastPrevTime) {
            // We have new data points after the existing ones
            // This is the ideal case for incremental updates

            // Find all new points
            const newDataPoints = currentData.filter(
              (point) => (point.time as number) > lastPrevTime
            )

            // Sort them to ensure chronological order
            newDataPoints.sort(
              (a, b) => (a.time as number) - (b.time as number)
            )

            // Add each new point
            let updateFailed = false
            for (const point of newDataPoints) {
              try {
                seriesRef.current.update(point)
              } catch (err) {
                console.warn(
                  'Incremental update failed, falling back to setData',
                  {
                    error: err,
                    pointTime: new Date(
                      (point.time as number) * 1000
                    ).toISOString(),
                    pointValue: point.value,
                  }
                )
                updateFailed = true
                break
              }
            }

            // If any update failed, do a full reset
            if (updateFailed) {
              seriesRef.current.setData(currentData)
            }
          } else if (lastCurrentTime === lastPrevTime) {
            // Same time range, check if last value changed
            const lastCurrent = currentData[currentData.length - 1]
            const lastPrev = prevData[prevData.length - 1]

            if (
              lastCurrent &&
              lastPrev &&
              lastCurrent.value !== lastPrev.value
            ) {
              // Last point value changed - update it
              try {
                seriesRef.current.update(lastCurrent)
              } catch (err) {
                console.warn('Failed to update last point, using setData', {
                  error: err,
                  time: new Date(
                    (lastCurrent.time as number) * 1000
                  ).toISOString(),
                  oldValue: lastPrev.value,
                  newValue: lastCurrent.value,
                })
                seriesRef.current.setData(currentData)
              }
            } else if (
              JSON.stringify(currentData) !== JSON.stringify(prevData)
            ) {
              // Some other data changed in the middle - need full reset
              seriesRef.current.setData(currentData)
            }
            // If data is identical, do nothing
          } else {
            // Fallback - use setData for any other case
            seriesRef.current.setData(currentData)
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
          }, 100)
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
