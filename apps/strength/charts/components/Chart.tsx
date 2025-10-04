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

interface ChartProps {
  heading: string | React.ReactNode
  name: string
  chartData: LineData[] | null
  secondSeriesData?: LineData[] | null
  width: number
  height: number
  onCrosshairMove: (time: Time | null) => void
  timeRange?: { from: Time; to: Time } | null
  showZeroLine?: boolean
}

export interface ChartRef {
  chart: IChartApi | null
  series: ISeriesApi<'Line'> | null
  secondSeries?: ISeriesApi<'Line'> | null
  container: HTMLDivElement | null
}

export const Chart = forwardRef<ChartRef, ChartProps>(
  (
    {
      heading,
      name,
      chartData,
      secondSeriesData,
      width,
      height,
      onCrosshairMove,
      timeRange,
      showZeroLine,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const secondSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const zeroLineRef = useRef<IPriceLine | null>(null)
    const isUpdatingCursor = useRef(false)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)
    const lastSecondDataRef = useRef<LineData[] | null>(null)

    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      series: seriesRef.current,
      secondSeries: secondSeriesRef.current,
      container: containerRef.current,
    }))

    // Create chart only once on mount
    useEffect(() => {
      if (!containerRef.current || hasInitialized.current) return

      // Create chart
      const chart = createChart(containerRef.current, getChartConfig(height))
      chartRef.current = chart
      hasInitialized.current = true

      // Add first series (strength) - uses LEFT price scale
      const strengthSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        priceScaleId: 'left',
      })
      seriesRef.current = strengthSeries

      // Add second series (price) - uses RIGHT price scale (default)
      // Always create the series, even if data doesn't exist yet
      const priceSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        color: '#0076d0',
      })
      secondSeriesRef.current = priceSeries

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
      if (secondSeriesData && secondSeriesRef.current) {
        secondSeriesRef.current.setData(secondSeriesData)
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
        secondSeriesRef.current = null
        zeroLineRef.current = null
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - removed all dependencies

    // Update first series (strength) data
    useEffect(() => {
      if (!seriesRef.current || !chartData || !hasInitialized.current) return

      try {
        const prevData = lastDataRef.current
        const currentData = chartData

        // Check if data actually changed
        const dataChanged =
          !prevData ||
          prevData.length !== currentData.length ||
          prevData.some((item, index) => {
            const currentItem = currentData[index]
            return (
              !currentItem ||
              item.time !== currentItem.time ||
              Math.abs(item.value - currentItem.value) > 0.0001
            )
          })

        if (!dataChanged) {
          console.log(
            `[Chart] No data change detected for ${name} (strength), skipping update`
          )
          return
        }

        // Simply use setData for all updates
        console.log(`[Chart] Updating strength data for ${name}`, {
          dataPoints: currentData.length,
        })
        seriesRef.current.setData(currentData)
        lastDataRef.current = [...currentData]

        // Reapply time range after data update
        if (timeRange && chartRef.current && timeRange.from < timeRange.to) {
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
        console.warn('Failed to update strength data:', error)
      }
    }, [chartData, timeRange, name])

    // Update second series (price) data
    useEffect(() => {
      if (
        !secondSeriesRef.current ||
        !secondSeriesData ||
        !hasInitialized.current
      )
        return

      try {
        const prevData = lastSecondDataRef.current
        const currentData = secondSeriesData

        // Check if data actually changed
        const dataChanged =
          !prevData ||
          prevData.length !== currentData.length ||
          prevData.some((item, index) => {
            const currentItem = currentData[index]
            return (
              !currentItem ||
              item.time !== currentItem.time ||
              Math.abs(item.value - currentItem.value) > 0.0001
            )
          })

        if (!dataChanged) {
          console.log(
            `[Chart] No data change detected for ${name} (price), skipping update`
          )
          return
        }

        // Simply use setData for all updates
        console.log(`[Chart] Updating price data for ${name}`, {
          dataPoints: currentData.length,
        })
        secondSeriesRef.current.setData(currentData)
        lastSecondDataRef.current = [...currentData]
      } catch (error) {
        console.warn('Failed to update price data:', error)
      }
    }, [secondSeriesData, name])

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
          width: width + 'px',
        }}
      >
        {/* Chart container */}
        <div
          ref={containerRef}
          className={`border border-gray-200 rounded z-10 pr-[10px]`}
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
