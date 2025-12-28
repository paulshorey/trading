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
import { updateSeriesEfficiently } from '../lib/chartUtils'
import { useChartEventPatcher } from '../lib/useChartEventPatcher'
import { useTimeMarkers } from '../lib/primitives/useTimeMarkers'
import ChartTitle from './ChartTitle'
import { NoDataState } from './ChartStates'
import classes from '../classes.module.scss'
import { prepareDataWithRequiredTimestamps } from '../lib/primitives/forwardFillData'
import { TIME_RANGE_HIGHLIGHTS } from '../constants'
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
      interval: selectedIntervals, // Which intervals are selected (for visibility)
    } = useChartControlsStore()

    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const strengthSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const intervalSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const tickerSeriesRef = useRef<Record<string, ISeriesApi<'Line'>>>({})
    const zeroLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const plus100LineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const minus100LineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
    const hasInitialized = useRef(false)
    const lastDataRef = useRef<LineData[] | null>(null)
    const lastSecondDataRef = useRef<LineData[] | null>(null)
    const lastIntervalDataRef = useRef<IntervalStrengthData>({})
    const lastTickerDataRef = useRef<TickerPriceData>({})

    // Use extracted hooks
    const { createTimeMarkers, markersInitialized } = useTimeMarkers()
    useChartEventPatcher(containerRef, onUserScroll)

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

      // Add dedicated horizontal line series (always visible, independent of other series)
      // These ensure the reference lines are always shown regardless of which strength lines are displayed
      const zeroLineSeries = chart.addSeries(LineSeries, {
        color: COLORS.dark,
        lineWidth: 1,
        lineStyle: 1, // Solid: 0, Dotted: 1, Dashed: 2
        priceScaleId: 'left', // Same scale as strength series
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      zeroLineSeriesRef.current = zeroLineSeries

      // +100 line (upper bound)
      const plus100LineSeries = chart.addSeries(LineSeries, {
        color: COLORS.red,
        lineWidth: 1,
        lineStyle: 1,
        priceScaleId: 'left',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      plus100LineSeriesRef.current = plus100LineSeries

      // -100 line (lower bound)
      const minus100LineSeries = chart.addSeries(LineSeries, {
        color: COLORS.green,
        lineWidth: 1,
        lineStyle: 1,
        priceScaleId: 'left',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      minus100LineSeriesRef.current = minus100LineSeries

      // Price - uses 'right' scale (default)
      // Always create the series, even if data doesn't exist yet
      const priceSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 2,
        color: COLORS.price,
        priceScaleId: 'right',
      })
      priceSeriesRef.current = priceSeries

      // Strength - uses 'left' scale
      const strengthSeries = chart.addSeries(LineSeries, {
        ...getLineSeriesConfig(),
        lineWidth: 2,
        color: COLORS.strength,
        priceScaleId: 'left',
      })
      strengthSeriesRef.current = strengthSeries

      // Strength intervals - uses 'left' scale to compare with Strength series
      // These are created once and data is set/updated later
      strengthIntervals.forEach((interval) => {
        const intervalSeries = chart.addSeries(LineSeries, {
          ...getLineSeriesConfig(),
          lineWidth: interval === '181' && !showStrengthLine ? 2 : 1,
          color:
            interval === '181' && !showStrengthLine
              ? COLORS.strength
              : COLORS.strength_i,
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
        chart.remove()
        chartRef.current = null
        strengthSeriesRef.current = null
        priceSeriesRef.current = null
        zeroLineSeriesRef.current = null
        plus100LineSeriesRef.current = null
        minus100LineSeriesRef.current = null
        intervalSeriesRef.current = {}
        tickerSeriesRef.current = {}
        hasInitialized.current = false
      }
    }, []) // Only run once on mount

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
        const currentData = prepareDataWithRequiredTimestamps(
          strengthData,
          TIME_RANGE_HIGHLIGHTS
        )

        // Use efficient update strategy
        const updated = updateSeriesEfficiently(
          strengthSeriesRef.current,
          currentData,
          prevData
        )

        if (updated) {
          lastDataRef.current = currentData // Don't spread - keep reference for comparison

          // Update horizontal line series to span the full data range
          // Only needs start and end points to draw horizontal lines
          if (currentData.length > 0) {
            const firstTime = currentData[0]!.time
            const lastTime = currentData[currentData.length - 1]!.time

            // Zero line (y=0)
            if (zeroLineSeriesRef.current) {
              zeroLineSeriesRef.current.setData([
                { time: firstTime, value: 0 },
                { time: lastTime, value: 0 },
              ])
            }

            // +100 line (upper bound)
            if (plus100LineSeriesRef.current) {
              plus100LineSeriesRef.current.setData([
                { time: firstTime, value: 50 },
                { time: lastTime, value: 50 },
              ])
            }

            // -100 line (lower bound)
            if (minus100LineSeriesRef.current) {
              minus100LineSeriesRef.current.setData([
                { time: firstTime, value: -50 },
                { time: lastTime, value: -50 },
              ])
            }
          }
        }

        // Create time markers on first data load
        if (!markersInitialized.current && currentData.length > 0) {
          createTimeMarkers(strengthSeriesRef.current, currentData)
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
        const currentData = prepareDataWithRequiredTimestamps(
          priceData,
          TIME_RANGE_HIGHLIGHTS
        )

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
          const currentData = prepareDataWithRequiredTimestamps(
            data,
            TIME_RANGE_HIGHLIGHTS
          )

          // Use efficient update strategy
          const updated = updateSeriesEfficiently(
            series,
            currentData,
            prevData || null
          )

          if (updated) {
            lastIntervalDataRef.current[interval] = currentData
          }

          // Control visibility based on:
          // 1. Master toggle (showIntervalLines)
          // 2. Per-interval selection (selectedIntervals)
          // Highlight the most important line when aggregate is hidden
          const isSelected = selectedIntervals.includes(interval)
          const isHighlightedInterval = interval === '181' && !showStrengthLine

          series.applyOptions({
            visible: showIntervalLines && isSelected,
            lineWidth: isHighlightedInterval ? 2 : 1,
            color: isHighlightedInterval ? COLORS.strength : COLORS.strength_i,
          })
        })
      } catch (error) {
        console.warn('Failed to update interval data:', error)
      }
    }, [
      intervalStrengthData,
      showIntervalLines,
      showStrengthLine,
      selectedIntervals,
      name,
    ])

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
          const currentData = prepareDataWithRequiredTimestamps(
            data,
            TIME_RANGE_HIGHLIGHTS
          )

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
        lineWidth: 2, // Always prominent when visible (it's the main aggregate line)
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
