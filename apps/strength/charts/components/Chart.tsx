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
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'
import classes from '../classes.module.scss'
import { VerticalLinePrimitive } from '../lib/VerticalLinePrimitive'
import {
  TIME_MARKERS,
  TIME_RANGE_HIGHLIGHTS,
  getMarkerTimestamps,
  markerConfigToOptions,
} from '../state/timeMarkers'
import { TimeRangeHighlightPrimitive } from '../lib/TimeRangeHighlight'
import { forwardFillData, getTimeRangeBoundaries } from '../lib/forwardFillData'
import { SCALE_FACTOR } from '@/constants'
import {
  strengthIntervals,
  IntervalStrengthData,
  TickerPriceData,
} from '../state/useChartControlsStore'
import { COLORS } from '../constants'
interface ChartProps {
  heading: string | React.ReactNode
  name: string
  strengthData: LineData[] | null
  priceData?: LineData[] | null
  intervalStrengthData?: IntervalStrengthData
  tickerPriceData?: TickerPriceData
  tickers?: string[]
  showIntervalLines?: boolean
  showTickerLines?: boolean
  width: number
  height: number
  timeRange?: { from: Time; to: Time } | null
  showZeroLine?: boolean
}

export interface ChartRef {
  chart: IChartApi | null
  strengthSeries: ISeriesApi<'Line'> | null
  priceSeries?: ISeriesApi<'Line'> | null
  intervalSeries?: Record<string, ISeriesApi<'Line'>>
  tickerSeries?: Record<string, ISeriesApi<'Line'>>
  container: HTMLDivElement | null
}

export const Chart = forwardRef<ChartRef, ChartProps>(
  (
    {
      heading,
      name,
      strengthData,
      priceData,
      intervalStrengthData,
      tickerPriceData,
      tickers = [],
      showIntervalLines = false,
      showTickerLines = false,
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
    const intervalSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const tickerSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const zeroLineRef = useRef<IPriceLine | null>(null)
    const timeMarkersRef = useRef<VerticalLinePrimitive[]>([])
    const timeRangeHighlightRef = useRef<TimeRangeHighlightPrimitive | null>(
      null
    )
    const markersInitialized = useRef(false)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)
    const lastSecondDataRef = useRef<LineData[] | null>(null)
    const lastIntervalDataRef = useRef<IntervalStrengthData>({})
    const lastTickerDataRef = useRef<TickerPriceData>({})

    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      strengthSeries: strengthSeriesRef.current,
      priceSeries: priceSeriesRef.current,
      intervalSeries: intervalSeriesRef.current,
      tickerSeries: tickerSeriesRef.current,
      container: containerRef.current,
    }))

    // Create chart only once on mount
    useEffect(() => {
      if (!containerRef.current || hasInitialized.current) return

      // Create chart
      const chart = createChart(containerRef.current, getChartConfig(height))
      chartRef.current = chart
      hasInitialized.current = true

      // --- Fix for zoom: 0.5 ---
      // Intercept mouse events to correct coordinates for the 2x width
      // Since the body is scaled by 0.5 and chart width is 2x, we need to double the mouse coordinates
      // so the chart (which thinks it's 2x wide) gets the correct relative position.
      const container = containerRef.current
      const events = [
        'mousemove',
        'mouseenter',
        'mouseleave',
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
      ]

      const eventHandler = (e: MouseEvent) => {
        if ((e as any)._patched) return

        e.stopPropagation()
        // e.preventDefault() // Optional, might interfere with other things

        const rect = container.getBoundingClientRect()
        const scale = SCALE_FACTOR

        // Calculate corrected coordinates relative to the container
        const relativeX = e.clientX - rect.left
        const relativeY = e.clientY - rect.top

        const newClientX = rect.left + relativeX * scale
        const newClientY = rect.top + relativeY * scale

        const newEvent = new MouseEvent(e.type, {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: e.detail,
          screenX: e.screenX,
          screenY: e.screenY,
          clientX: newClientX,
          clientY: newClientY,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          button: e.button,
          buttons: e.buttons,
          relatedTarget: e.relatedTarget,
        })

        Object.defineProperty(newEvent, '_patched', { value: true })
        e.target?.dispatchEvent(newEvent)
      }

      events.forEach((eventName) => {
        container.addEventListener(eventName, eventHandler as any, {
          capture: true,
        })
      })
      // -------------------------

      // Add first series (strength) - uses LEFT price scale
      const strengthSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 2,
        color: COLORS.strength,
        priceScaleId: 'left',
      })
      strengthSeriesRef.current = strengthSeries

      // Add second series (price) - uses RIGHT price scale (default)
      // Always create the series, even if data doesn't exist yet
      const priceSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 1,
        color: COLORS.price,
        priceScaleId: 'right',
      })
      priceSeriesRef.current = priceSeries

      // Add interval series for each possible interval
      // These are created once and data is set/updated later
      strengthIntervals.forEach((interval) => {
        const intervalSeries = chart.addSeries(LineSeries, {
          ...getLineSeriesConfig(),
          lineWidth: 1,
          color: COLORS.strength,
          priceScaleId: 'left', // Use same scale as aggregated strength
        })
        intervalSeriesRef.current[interval] = intervalSeries
      })

      // Set initial data if available
      if (strengthData) {
        strengthSeries.setData(strengthData)
      }
      if (priceData && priceSeriesRef.current) {
        priceSeriesRef.current.setData(priceData)
      }

      // Set initial interval data if available
      if (intervalStrengthData) {
        Object.entries(intervalStrengthData).forEach(([interval, data]) => {
          if (data && intervalSeriesRef.current[interval]) {
            intervalSeriesRef.current[interval].setData(data)
          }
        })
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
        strengthSeriesRef.current = null
        priceSeriesRef.current = null
        intervalSeriesRef.current = {}
        tickerSeriesRef.current = {}
        zeroLineRef.current = null
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - removed all dependencies

    // Helper function to create all time markers
    const createTimeMarkers = (currentData: LineData[]) => {
      if (!strengthSeriesRef.current || markersInitialized.current) return

      if (currentData.length === 0) return

      // Extract all timestamps from the data
      const dataTimestamps = currentData.map((d) => d.time as number)
      const dataStartTime = dataTimestamps[0]!
      const dataEndTime = dataTimestamps[dataTimestamps.length - 1]!

      // Create time range highlights (shaded background areas)
      if (!timeRangeHighlightRef.current && TIME_RANGE_HIGHLIGHTS.length > 0) {
        const highlight = new TimeRangeHighlightPrimitive(TIME_RANGE_HIGHLIGHTS)
        highlight.setDataRange(dataTimestamps)
        strengthSeriesRef.current.attachPrimitive(highlight)
        timeRangeHighlightRef.current = highlight
      }

      // Create vertical line markers for each configured time marker
      TIME_MARKERS.forEach((markerConfig) => {
        const timestamps = getMarkerTimestamps(
          markerConfig.utcHour,
          markerConfig.utcMinute,
          dataStartTime,
          dataEndTime
        )

        timestamps.forEach((timestamp) => {
          const marker = new VerticalLinePrimitive(
            timestamp as Time,
            markerConfigToOptions(markerConfig)
          )
          strengthSeriesRef.current!.attachPrimitive(marker)
          timeMarkersRef.current.push(marker)
        })
      })

      markersInitialized.current = true
    }

    /**
     * Ensure data exists at required timestamps (time range boundaries).
     * This adds forward-filled values ONLY at boundary timestamps,
     * preserving natural gaps in the data (weekends, holidays).
     */
    const prepareDataWithRequiredTimestamps = (
      data: LineData[]
    ): LineData[] => {
      if (data.length === 0) return data

      const dataStartTime = data[0]!.time as number
      const dataEndTime = data[data.length - 1]!.time as number

      // Get all time range boundaries that need to exist in the data
      const requiredTimestamps = getTimeRangeBoundaries(
        TIME_RANGE_HIGHLIGHTS,
        dataStartTime,
        dataEndTime
      )

      // Add forward-filled values only at required timestamps
      return forwardFillData(data, 60, requiredTimestamps)
    }

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

        // If showIntervalLines is true, hide the main aggregated strength line
        if (showIntervalLines) {
          if (prevData && prevData.length > 0) {
            strengthSeriesRef.current.setData([])
            lastDataRef.current = null
          }
          return
        }

        // Apply forward-fill to ensure time range boundaries exist
        const currentData = prepareDataWithRequiredTimestamps(strengthData)

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
          // Still try to create markers even if data hasn't changed
          // This handles the case where the component re-renders
          if (!markersInitialized.current && currentData.length > 0) {
            createTimeMarkers(currentData)
          }
          return
        }

        // Simply use setData for all updates
        strengthSeriesRef.current.setData(currentData)
        lastDataRef.current = [...currentData]

        // Create time markers on first data load
        if (!markersInitialized.current && currentData.length > 0) {
          createTimeMarkers(currentData)
        }

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
    }, [strengthData, timeRange, name, showIntervalLines])

    // Update second series (price) data
    useEffect(() => {
      if (!priceSeriesRef.current || !priceData || !hasInitialized.current)
        return

      try {
        const prevData = lastSecondDataRef.current

        // If showTickerLines is true, hide the main aggregated price line
        if (showTickerLines) {
          if (prevData && prevData.length > 0) {
            priceSeriesRef.current.setData([])
            lastSecondDataRef.current = null
          }
          return
        }

        // Apply forward-fill to ensure time range boundaries exist
        const currentData = prepareDataWithRequiredTimestamps(priceData)

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
          return
        }

        // Simply use setData for all updates
        priceSeriesRef.current.setData(currentData)
        lastSecondDataRef.current = [...currentData]
      } catch (error) {
        console.warn('Failed to update price data:', error)
      }
    }, [priceData, name, showTickerLines])

    // Update interval series data
    useEffect(() => {
      if (!hasInitialized.current) return

      try {
        // Update each interval series with its data
        strengthIntervals.forEach((interval) => {
          const series = intervalSeriesRef.current[interval]
          if (!series) return

          // If showIntervalLines is false, clear all interval series
          if (!showIntervalLines) {
            if (lastIntervalDataRef.current[interval]) {
              series.setData([])
              lastIntervalDataRef.current[interval] = null
            }
            return
          }

          const data = intervalStrengthData?.[interval]
          const prevData = lastIntervalDataRef.current[interval]

          if (!data) {
            // Clear the series if no data for this interval
            if (prevData) {
              series.setData([])
              lastIntervalDataRef.current[interval] = null
            }
            return
          }

          // Apply forward-fill to ensure time range boundaries exist
          const currentData = prepareDataWithRequiredTimestamps(data)

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
            return
          }

          // Set data for this interval
          series.setData(currentData)
          lastIntervalDataRef.current[interval] = [...currentData]
        })
      } catch (error) {
        console.warn('Failed to update interval data:', error)
      }
    }, [intervalStrengthData, showIntervalLines, name])

    // Update ticker series data (for individual ticker price lines)
    useEffect(() => {
      if (!hasInitialized.current || !chartRef.current) return

      try {
        const chart = chartRef.current

        // If showTickerLines is false, clear all ticker series
        if (!showTickerLines) {
          Object.keys(tickerSeriesRef.current).forEach((ticker) => {
            const series = tickerSeriesRef.current[ticker]
            if (series && lastTickerDataRef.current[ticker]) {
              series.setData([])
              lastTickerDataRef.current[ticker] = null
            }
          })
          return
        }

        // Create series for new tickers that don't have one yet
        tickers.forEach((ticker) => {
          if (!tickerSeriesRef.current[ticker]) {
            const tickerSeries = chart.addSeries(LineSeries, {
              ...getLineSeriesConfig(),
              lineWidth: 1,
              color: COLORS.price,
              priceScaleId: 'right', // Use same scale as aggregated price
            })
            tickerSeriesRef.current[ticker] = tickerSeries
          }
        })

        // Update each ticker series with its data
        tickers.forEach((ticker) => {
          const series = tickerSeriesRef.current[ticker]
          if (!series) return

          const data = tickerPriceData?.[ticker]
          const prevData = lastTickerDataRef.current[ticker]

          if (!data) {
            // Clear the series if no data for this ticker
            if (prevData) {
              series.setData([])
              lastTickerDataRef.current[ticker] = null
            }
            return
          }

          // Apply forward-fill to ensure time range boundaries exist
          const currentData = prepareDataWithRequiredTimestamps(data)

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
            return
          }

          // Set data for this ticker
          series.setData(currentData)
          lastTickerDataRef.current[ticker] = [...currentData]
        })

        // Clear data for tickers that are no longer selected
        Object.keys(tickerSeriesRef.current).forEach((ticker) => {
          if (!tickers.includes(ticker)) {
            const series = tickerSeriesRef.current[ticker]
            if (series && lastTickerDataRef.current[ticker]) {
              series.setData([])
              lastTickerDataRef.current[ticker] = null
            }
          }
        })
      } catch (error) {
        console.warn('Failed to update ticker data:', error)
      }
    }, [tickerPriceData, showTickerLines, tickers, name])

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
          color: COLORS.strength,
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
          position: 'relative',
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
