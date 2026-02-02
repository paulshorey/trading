import { useEffect, useRef, MutableRefObject } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineSeries,
  BarSeries,
} from 'lightweight-charts'
import { VerticalLinePrimitive } from '../../tradingview/lib/primitives/VerticalLinePrimitive'
import type { Candle } from '@/lib/market-data/candles'
import {
  COLORS,
  SERIES,
  PRICE_SCALE_RIGHT_OFFSET,
  SeriesKey,
} from './constants'
import { timeFormatter } from '../lib/time'

// Map seriesType string to Series class
const SERIES_TYPE_MAP = {
  Bar: BarSeries,
  Line: LineSeries,
} as const

// Series refs type - all series use Bar | Line union for simplicity
export type SeriesRefs = {
  [K in SeriesKey]: MutableRefObject<ISeriesApi<'Bar' | 'Line'> | null>
}

export interface AbsorptionRefs {
  markers: MutableRefObject<VerticalLinePrimitive[]>
  timestamps: MutableRefObject<Set<number>>
}

interface UseInitChartProps {
  containerRef: MutableRefObject<HTMLDivElement | null>
  dataRef: MutableRefObject<Candle[]>
  width: number
  height: number
}

interface UseInitChartReturn {
  chartRef: MutableRefObject<IChartApi | null>
  seriesRefs: SeriesRefs
  absorptionRefs: AbsorptionRefs
  hasInitialized: MutableRefObject<boolean>
}

export function useInitChart({
  containerRef,
  dataRef,
  width,
  height,
}: UseInitChartProps): UseInitChartReturn {
  const chartRef = useRef<IChartApi | null>(null)
  const hasInitialized = useRef(false)

  // Create refs for all series dynamically
  // Using useRef with an object that persists across renders
  const seriesRefsMap = useRef<
    Record<string, ISeriesApi<'Bar' | 'Line'> | null>
  >(Object.fromEntries(Object.keys(SERIES).map((key) => [key, null])))

  // Absorption marker refs
  const absorptionMarkersRef = useRef<VerticalLinePrimitive[]>([])
  const absorptionTimestampsRef = useRef<Set<number>>(new Set())

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current || hasInitialized.current) return

    const chartWidth = width + PRICE_SCALE_RIGHT_OFFSET

    const chart = createChart(containerRef.current, {
      width: chartWidth,
      height,
      layout: {
        background: { color: COLORS.background },
        textColor: COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: COLORS.gridLine },
      },
      rightPriceScale: {
        visible: true,
        minimumWidth: 80,
        borderVisible: false,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: timeFormatter,
        borderVisible: false,
        rightBarStaysOnScroll: true,
      },
      crosshair: {
        mode: 0,
        vertLine: {
          visible: true,
          color: COLORS.crosshair,
          width: 1,
          style: 0,
        },
        horzLine: {
          visible: true,
          color: COLORS.crosshair,
          width: 1,
          style: 0,
        },
      },
      handleScroll: true,
      handleScale: false,
      localization: {
        timeFormatter,
      },
    })

    chartRef.current = chart
    hasInitialized.current = true

    // Initialize all series from SERIES config
    for (const [key, config] of Object.entries(SERIES)) {
      if (!config.enabled) continue

      const isBarSeries = config.seriesType === 'Bar'
      const SeriesClass = SERIES_TYPE_MAP[config.seriesType]

      // Build series options based on type
      const seriesOptions = {
        priceScaleId: config.priceScaleId,
        priceLineVisible: false,
        lastValueVisible: config.lastValueVisible ?? false,
        ...(isBarSeries
          ? { upColor: config.color, downColor: config.color }
          : {
              color: config.color,
              lineWidth: 1,
              crosshairMarkerVisible: true,
            }),
      }

      const series = chart.addSeries(SeriesClass, seriesOptions)

      // Apply scale margins unless explicitly disabled
      if (config.applyScaleMargins !== false) {
        series.priceScale().applyOptions({
          scaleMargins: { top: config.top, bottom: config.bottom },
          autoScale: true,
        })
      }

      seriesRefsMap.current[key] = series
    }

    // Custom zoom handler anchored on the last data bar
    const handleWheel = (e: WheelEvent) => {
      const isZoomGesture = e.ctrlKey || e.metaKey
      if (!isZoomGesture) return

      e.preventDefault()
      e.stopPropagation()

      const timeScale = chart.timeScale()
      const visibleRange = timeScale.getVisibleLogicalRange()
      if (!visibleRange) return

      const dataLength = dataRef.current.length
      if (dataLength === 0) return
      const lastBarIndex = dataLength - 1

      const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95

      const currentFrom = visibleRange.from
      const currentTo = visibleRange.to
      const currentWidth = currentTo - currentFrom
      const rightGap = currentTo - lastBarIndex
      const newWidth = currentWidth * zoomFactor

      const minBars = 10
      const maxBars = 50000
      if (newWidth < minBars || newWidth > maxBars) return

      const newTo = lastBarIndex + rightGap
      const newFrom = newTo - newWidth

      timeScale.setVisibleLogicalRange({
        from: newFrom,
        to: newTo,
      })
    }

    const container = containerRef.current
    container.addEventListener('wheel', handleWheel, {
      passive: false,
      capture: true,
    })

    return () => {
      container.removeEventListener('wheel', handleWheel, { capture: true })
      chart.remove()
      chartRef.current = null
      // Clear all series refs
      for (const key of Object.keys(SERIES)) {
        seriesRefsMap.current[key] = null
      }
      // Absorption markers
      absorptionMarkersRef.current = []
      absorptionTimestampsRef.current.clear()
      hasInitialized.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update chart dimensions
  useEffect(() => {
    if (!chartRef.current || !hasInitialized.current) return
    chartRef.current.applyOptions({
      width: width + PRICE_SCALE_RIGHT_OFFSET,
      height,
    })
  }, [width, height])

  // Create stable ref objects for each series key
  // This provides the same interface as before (seriesRefs.price.current, etc.)
  const seriesRefs = Object.fromEntries(
    Object.keys(SERIES).map((key) => [
      key,
      {
        get current() {
          return seriesRefsMap.current[key] ?? null
        },
        set current(value) {
          seriesRefsMap.current[key] = value
        },
      },
    ])
  ) as SeriesRefs

  return {
    chartRef,
    seriesRefs,
    absorptionRefs: {
      markers: absorptionMarkersRef,
      timestamps: absorptionTimestampsRef,
    },
    hasInitialized,
  }
}
