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
  ISeriesApi,
  Time,
  IPriceLine,
} from 'lightweight-charts'
import { getChartConfig, getLineSeriesConfig } from '../lib/chartConfig'
import { attachChartScalingFix } from '../lib/chartScalingFix'
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'
import classes from '../classes.module.scss'

interface ChartProps {
  heading: string | React.ReactNode
  name: string
  strengthData: LineData[] | null
  priceData?: LineData[] | null
  width: number
  height: number
  timeRange?: { from: Time; to: Time } | null
  showZeroLine?: boolean
}

export interface ChartRef {
  chart: IChartApi | null
  strengthSeries: ISeriesApi<'Line'> | null
  priceSeries?: ISeriesApi<'Line'> | null
  container: HTMLDivElement | null
}

export const Chart = forwardRef<ChartRef, ChartProps>(
  (
    {
      heading,
      name,
      strengthData,
      priceData,
      width,
      height,
      timeRange,
      showZeroLine,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const strengthSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const zeroLineRef = useRef<IPriceLine | null>(null)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)
    const lastSecondDataRef = useRef<LineData[] | null>(null)

    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      strengthSeries: strengthSeriesRef.current,
      priceSeries: priceSeriesRef.current,
      container: containerRef.current,
    }))

    // Create chart only once on mount
    useEffect(() => {
      if (!containerRef.current || hasInitialized.current) return

      // Create chart
      const chart = createChart(containerRef.current, getChartConfig(height))
      chartRef.current = chart
      hasInitialized.current = true

      // Attach scaling fix for 2x rendering / 0.5x zoom
      const cleanupScalingFix = attachChartScalingFix(containerRef.current)

      // Add first series (strength) - uses LEFT price scale
      const strengthSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 2,
        color: '#ff9d00d7',
        priceScaleId: 'left',
      })
      strengthSeriesRef.current = strengthSeries

      // Add second series (price) - uses RIGHT price scale (default)
      // Always create the series, even if data doesn't exist yet
      const priceSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 1,
        color: '#0091ff98',
        priceScaleId: 'right',
      })
      priceSeriesRef.current = priceSeries

      // Set initial data if available
      if (strengthData) {
        strengthSeries.setData(strengthData)
      }
      if (priceData && priceSeriesRef.current) {
        priceSeriesRef.current.setData(priceData)
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
        cleanupScalingFix()
        chart.remove()
        chartRef.current = null
        strengthSeriesRef.current = null
        priceSeriesRef.current = null
        zeroLineRef.current = null
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - removed all dependencies

    // Update first series (strength) data
    useEffect(() => {
      if (
        !strengthSeriesRef.current ||
        !strengthData ||
        !hasInitialized.current
      )
        return

      try {
        const prevData = lastDataRef.current
        const currentData = strengthData

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
          console.warn(
            `[Chart] No data change detected for ${name} (strength), skipping update`
          )
          return
        }

        // Simply use setData for all updates
        strengthSeriesRef.current.setData(currentData)
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
    }, [strengthData, timeRange, name])

    // Update second series (price) data
    useEffect(() => {
      if (!priceSeriesRef.current || !priceData || !hasInitialized.current)
        return

      try {
        const prevData = lastSecondDataRef.current
        const currentData = priceData

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
          console.warn(
            `[Chart] No data change detected for ${name} (price), skipping update`
          )
          return
        }

        // Simply use setData for all updates
        priceSeriesRef.current.setData(currentData)
        lastSecondDataRef.current = [...currentData]
      } catch (error) {
        console.warn('Failed to update price data:', error)
      }
    }, [priceData, name])

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
      if (!strengthSeriesRef.current || !hasInitialized.current) return

      // Remove existing zero line if it exists
      if (zeroLineRef.current) {
        strengthSeriesRef.current.removePriceLine(zeroLineRef.current)
        zeroLineRef.current = null
      }

      // Add zero line if requested
      if (showZeroLine) {
        const zeroLine = strengthSeriesRef.current.createPriceLine({
          price: 0,
          color: '#ff9d00d7',
          lineWidth: 2,
          lineStyle: 2, // Dashed line
          axisLabelVisible: false,
          title: '',
        })
        zeroLineRef.current = zeroLine
      }
    }, [showZeroLine])

    const hasData = strengthData !== null

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
