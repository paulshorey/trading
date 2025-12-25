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
} from 'lightweight-charts'
import { getChartConfig, getLineSeriesConfig } from '../lib/chartConfig'
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'
import classes from '../classes.module.scss'
import { VerticalLinePrimitive } from '../lib/primitives/VerticalLinePrimitive'
import {
  TIME_MARKERS,
  TIME_RANGE_HIGHLIGHTS,
  getMarkerTimestamps,
  markerConfigToOptions,
} from '../lib/primitives/timeMarkers'
import { TimeRangeHighlightPrimitive } from '../lib/primitives/TimeRangeHighlight'
import {
  forwardFillData,
  getTimeRangeBoundaries,
} from '../lib/primitives/forwardFillData'
import { SCALE_FACTOR } from '@/constants'
import {
  strengthIntervals,
  IntervalStrengthData,
  TickerPriceData,
  useChartControlsStore,
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
  width: number
  height: number
  timeRange?: { from: Time; to: Time } | null
  /** Called when user scrolls/pans the chart (visible time range changes) */
  onUserScroll?: () => void
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
      width,
      height,
      timeRange,
      onUserScroll,
    },
    ref
  ) => {
    const {
      showStrengthLine,
      showIntervalLines,
      showPriceLine,
      showTickerLines,
      hoursBack,
    } = useChartControlsStore()

    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const strengthSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const intervalSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const tickerSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const zeroLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const timeMarkersRef = useRef<VerticalLinePrimitive[]>([])
    const timeRangeHighlightRef = useRef<TimeRangeHighlightPrimitive | null>(
      null
    )
    const markersInitialized = useRef(false)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)
    const onUserScrollRef = useRef(onUserScroll)
    onUserScrollRef.current = onUserScroll
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

      // Track whether this is the initial render (skip first callback which fires on setup)
      let isInitialRender = true

      // Subscribe to visible time range changes (fires when user scrolls/pans)
      // Note: This will also fire on programmatic range changes, but onUserScroll
      // is debounced upstream so it won't cause issues
      const handleTimeRangeChange = () => {
        // Skip the initial callback that fires when chart is created
        if (isInitialRender) {
          isInitialRender = false
          return
        }
        onUserScrollRef.current?.()
      }
      chart
        .timeScale()
        .subscribeVisibleLogicalRangeChange(handleTimeRangeChange)

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

      // Add dedicated zero line series (always visible, independent of other series)
      // This ensures the zero line is always shown regardless of which strength lines are displayed
      const zeroLineSeries = chart.addSeries(LineSeries, {
        color: COLORS.neutral,
        lineWidth: 2,
        lineStyle: 2, // Dashed line
        priceScaleId: 'left', // Same scale as strength series
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      zeroLineSeriesRef.current = zeroLineSeries

      // Add second series (price) - uses RIGHT price scale (default)
      // Always create the series, even if data doesn't exist yet
      const priceSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 2,
        color: COLORS.price,
        priceScaleId: 'right',
      })
      priceSeriesRef.current = priceSeries

      // Add interval series for each possible interval
      // These are created once and data is set/updated later
      strengthIntervals.forEach((interval) => {
        // if (interval === '30S' && parseInt(hoursBack) > 12) return
        // if (interval === '1' && parseInt(hoursBack) > 24) return
        const intervalSeries = chart.addSeries(LineSeries, {
          ...getLineSeriesConfig(),
          lineWidth: 1,
          color: interval === '181' ? COLORS.strength : COLORS.strength_i,
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

      // NOTE: Don't set initial time range here - wait for data to be loaded
      // setVisibleRange fails if the series has no data
      // Time range is applied after data is set in the useEffect hooks below

      // Cleanup
      return () => {
        chart
          .timeScale()
          .unsubscribeVisibleLogicalRangeChange(handleTimeRangeChange)
        chart.remove()
        chartRef.current = null
        strengthSeriesRef.current = null
        priceSeriesRef.current = null
        zeroLineSeriesRef.current = null
        intervalSeriesRef.current = {}
        tickerSeriesRef.current = {}
        hasInitialized.current = false
      }
    }, []) // Only run once on mount - uses ref for callback

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

    /**
     * Helper to efficiently update series data
     *
     * IMPORTANT: lightweight-charts update() can ONLY:
     * 1. Update the LAST point in the series (if same timestamp)
     * 2. Append a new point that comes AFTER the last point
     *
     * It CANNOT update points in the middle of the series.
     * For any other changes, we must use setData().
     */
    const updateSeriesEfficiently = (
      series: ISeriesApi<'Line'>,
      currentData: LineData[],
      prevData: LineData[] | null
    ): boolean => {
      if (currentData.length === 0) return false

      // First load or no previous data: use setData
      if (!prevData || prevData.length === 0) {
        series.setData(currentData)
        return true
      }

      const lengthDiff = currentData.length - prevData.length

      // Check if this is a simple append (new points at the end only)
      if (lengthDiff > 0 && lengthDiff <= 10) {
        // Verify that existing data hasn't changed (timestamps match)
        // We only check the last few points of the existing data for performance
        const checkCount = Math.min(5, prevData.length)
        let existingDataUnchanged = true

        for (let i = 0; i < checkCount; i++) {
          const idx = prevData.length - 1 - i
          const curr = currentData[idx]
          const prev = prevData[idx]

          // If timestamps differ or values significantly differ, data changed
          if (
            !curr ||
            !prev ||
            curr.time !== prev.time ||
            Math.abs(curr.value - prev.value) > 0.0001
          ) {
            existingDataUnchanged = false
            break
          }
        }

        // Only use update() if existing data is unchanged
        // (meaning we're just appending new points)
        if (existingDataUnchanged) {
          try {
            // Append only the new points
            for (let i = prevData.length; i < currentData.length; i++) {
              const point = currentData[i]
              if (point) {
                series.update(point)
              }
            }
            return true
          } catch (e) {
            // If update fails for any reason, fall back to setData
            console.warn('update() failed, falling back to setData:', e)
            series.setData(currentData)
            return true
          }
        }
      }

      // Same length - check if only the LAST point changed
      if (lengthDiff === 0) {
        const lastCurr = currentData[currentData.length - 1]
        const lastPrev = prevData[prevData.length - 1]

        // If only the last point changed (same timestamp, different value)
        if (
          lastCurr &&
          lastPrev &&
          lastCurr.time === lastPrev.time &&
          Math.abs(lastCurr.value - lastPrev.value) > 0.0001
        ) {
          // Check if everything else is the same
          let onlyLastChanged = true
          const checkCount = Math.min(5, currentData.length - 1)

          for (let i = 0; i < checkCount; i++) {
            const idx = currentData.length - 2 - i
            if (idx < 0) break
            const curr = currentData[idx]
            const prev = prevData[idx]

            if (
              !curr ||
              !prev ||
              curr.time !== prev.time ||
              Math.abs(curr.value - prev.value) > 0.0001
            ) {
              onlyLastChanged = false
              break
            }
          }

          if (onlyLastChanged) {
            try {
              // Safe to use update() - only the last point changed
              series.update(lastCurr)
              return true
            } catch (e) {
              // Fall back to setData if update fails
              console.warn('update() failed, falling back to setData:', e)
              series.setData(currentData)
              return true
            }
          }
        }

        // Check if data is identical (no changes needed)
        let identical = true
        for (let i = 0; i < Math.min(10, currentData.length); i++) {
          const idx = currentData.length - 1 - i
          const curr = currentData[idx]
          const prev = prevData[idx]
          if (
            !curr ||
            !prev ||
            curr.time !== prev.time ||
            Math.abs(curr.value - prev.value) > 0.0001
          ) {
            identical = false
            break
          }
        }

        if (identical) {
          return false // No changes detected
        }
      }

      // For any other changes (data in middle changed, length decreased, etc.)
      // we must use setData()
      series.setData(currentData)
      return true
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

        // Apply forward-fill to ensure time range boundaries exist
        const currentData = prepareDataWithRequiredTimestamps(strengthData)

        // Use efficient update strategy
        const updated = updateSeriesEfficiently(
          strengthSeriesRef.current,
          currentData,
          prevData
        )

        if (updated) {
          lastDataRef.current = currentData // Don't spread - keep reference for comparison

          // Update zero line series to span the full data range
          // Only needs start and end points to draw a horizontal line at y=0
          if (zeroLineSeriesRef.current && currentData.length > 0) {
            const firstTime = currentData[0]!.time
            const lastTime = currentData[currentData.length - 1]!.time
            zeroLineSeriesRef.current.setData([
              { time: firstTime, value: 0 },
              { time: lastTime, value: 0 },
            ])
          }
        }

        // Create time markers on first data load
        if (!markersInitialized.current && currentData.length > 0) {
          createTimeMarkers(currentData)
        }

        // Apply time range on first data load (when we had no previous data)
        // Only do this if we have actual data to display
        if (
          updated &&
          !prevData &&
          currentData.length > 0 &&
          timeRange &&
          chartRef.current &&
          timeRange.from < timeRange.to
        ) {
          // Use requestAnimationFrame to ensure chart has processed the data
          requestAnimationFrame(() => {
            if (
              chartRef.current &&
              lastDataRef.current &&
              lastDataRef.current.length > 0 &&
              timeRange &&
              timeRange.from < timeRange.to
            ) {
              try {
                chartRef.current.timeScale().setVisibleRange(timeRange)
              } catch (error) {
                // This can happen if the time range is outside the data bounds
                // Just log and ignore - chart will auto-fit
                console.warn(
                  'Failed to set visible range after data update:',
                  error
                )
              }
            }
          })
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

        // Apply forward-fill to ensure time range boundaries exist
        const currentData = prepareDataWithRequiredTimestamps(priceData)

        // Use efficient update strategy
        const updated = updateSeriesEfficiently(
          priceSeriesRef.current,
          currentData,
          prevData
        )

        if (updated) {
          lastSecondDataRef.current = currentData
        }
      } catch (error) {
        console.warn('Failed to update price data:', error)
      }
    }, [priceData, name])

    // Update interval series data
    // ALWAYS update data, control visibility separately via series.applyOptions
    useEffect(() => {
      if (!hasInitialized.current) return

      try {
        strengthIntervals.forEach((interval) => {
          const series = intervalSeriesRef.current[interval]
          if (!series) return

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

          // Use efficient update strategy
          const updated = updateSeriesEfficiently(
            series,
            currentData,
            prevData || null
          )

          if (updated) {
            lastIntervalDataRef.current[interval] = currentData
          }

          // Control visibility based on showIntervalLines
          series.applyOptions({
            visible: showIntervalLines,
          })
        })
      } catch (error) {
        console.warn('Failed to update interval data:', error)
      }
    }, [intervalStrengthData, showIntervalLines, name])

    // Update ticker series data (for individual ticker price lines)
    // ALWAYS update data, control visibility separately via series.applyOptions
    useEffect(() => {
      if (!hasInitialized.current || !chartRef.current) return

      try {
        const chart = chartRef.current

        // Create series for new tickers that don't have one yet
        tickers.forEach((ticker) => {
          if (!tickerSeriesRef.current[ticker]) {
            const tickerSeries = chart.addSeries(LineSeries, {
              ...getLineSeriesConfig(),
              lineWidth: 1,
              color: COLORS.price_i,
              priceScaleId: 'right', // Use same scale as aggregated price
              visible: showTickerLines, // Set initial visibility
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

          // Use efficient update strategy
          const updated = updateSeriesEfficiently(
            series,
            currentData,
            prevData || null
          )

          if (updated) {
            lastTickerDataRef.current[ticker] = currentData
          }

          // Control visibility based on showTickerLines
          series.applyOptions({
            visible: showTickerLines,
          })
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

      // Check that we have data in the series before setting visible range
      // setVisibleRange will fail with "Value is null" if series is empty
      if (!lastDataRef.current || lastDataRef.current.length === 0) {
        // No data yet - don't try to set range
        return
      }

      try {
        chartRef.current.timeScale().setVisibleRange(timeRange)
      } catch (error) {
        console.warn('Failed to set visible range:', error)
      }
    }, [timeRange])

    // Toggle visibility of aggregated strength line
    useEffect(() => {
      if (!strengthSeriesRef.current || !hasInitialized.current) return

      strengthSeriesRef.current.applyOptions({
        visible: showStrengthLine,
      })
    }, [showStrengthLine])

    // Toggle visibility of aggregated price line
    useEffect(() => {
      if (!priceSeriesRef.current || !hasInitialized.current) return

      priceSeriesRef.current.applyOptions({
        visible: showPriceLine,
      })
    }, [showPriceLine])

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
