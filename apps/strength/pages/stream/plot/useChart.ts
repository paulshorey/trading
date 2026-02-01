import { useEffect, useRef, MutableRefObject } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineSeries,
  BarSeries,
  SeriesType,
} from 'lightweight-charts'
import { VerticalLinePrimitive } from '../../tradingview/lib/primitives/VerticalLinePrimitive'
import type { Candle } from '@/lib/market-data/candles'
import { COLORS, SERIES, PRICE_SCALE_RIGHT_OFFSET } from './constants'
import { timeFormatter } from '../lib/indicators'

// Map seriesType string to Series class
const SERIES_TYPE_MAP = {
  Bar: BarSeries,
  Line: LineSeries,
} as const

export interface SeriesRefs {
  // Main series
  price: MutableRefObject<ISeriesApi<'Bar'> | null>
  cvd: MutableRefObject<ISeriesApi<'Bar'> | null>
  rsi: MutableRefObject<ISeriesApi<'Line'> | null>
  // OHLC bar series
  evr: MutableRefObject<ISeriesApi<'Bar'> | null>
  vwap: MutableRefObject<ISeriesApi<'Bar'> | null>
  spreadBps: MutableRefObject<ISeriesApi<'Bar'> | null>
  pricePct: MutableRefObject<ISeriesApi<'Bar'> | null>
  // Line series
  bookImbalance: MutableRefObject<ISeriesApi<'Line'> | null>
  volume: MutableRefObject<ISeriesApi<'Line'> | null>
  bigTrades: MutableRefObject<ISeriesApi<'Line'> | null>
  bigVolume: MutableRefObject<ISeriesApi<'Line'> | null>
  vdStrength: MutableRefObject<ISeriesApi<'Line'> | null>
}

export interface AbsorptionRefs {
  markers: MutableRefObject<VerticalLinePrimitive[]>
  timestamps: MutableRefObject<Set<number>>
}

interface UseChartProps {
  containerRef: MutableRefObject<HTMLDivElement | null>
  dataRef: MutableRefObject<Candle[]>
  width: number
  height: number
}

interface UseChartReturn {
  chartRef: MutableRefObject<IChartApi | null>
  seriesRefs: SeriesRefs
  absorptionRefs: AbsorptionRefs
  hasInitialized: MutableRefObject<boolean>
}

export function useChart({
  containerRef,
  dataRef,
  width,
  height,
}: UseChartProps): UseChartReturn {
  const chartRef = useRef<IChartApi | null>(null)
  const hasInitialized = useRef(false)

  // Main series refs
  const priceSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const cvdSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  // OHLC bar series refs
  const evrSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const spreadBpsSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const pricePctSeriesRef = useRef<ISeriesApi<'Bar'> | null>(null)

  // Line series refs
  const bookImbalanceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bigTradesSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bigVolumeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const vdStrengthSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

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

    // ========== MAIN SERIES ==========

    if (SERIES.cvd.enabled) {
      const cvdSeries = chart.addSeries(
        SERIES_TYPE_MAP[SERIES.cvd.seriesType as keyof typeof SERIES_TYPE_MAP],
        {
          upColor: SERIES.cvd.color,
          downColor: SERIES.cvd.color,
          priceScaleId: 'left',
          priceLineVisible: false,
          lastValueVisible: true,
        }
      ) as ISeriesApi<'Bar'>
      cvdSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.cvd.top, bottom: SERIES.cvd.bottom },
        autoScale: true,
      })
      cvdSeriesRef.current = cvdSeries
    }

    if (SERIES.price.enabled) {
      const priceSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.price.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          upColor: SERIES.price.color,
          downColor: SERIES.price.color,
          priceScaleId: 'right',
          priceLineVisible: false,
          lastValueVisible: true,
        }
      ) as ISeriesApi<'Bar'>
      priceSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.price.top, bottom: SERIES.price.bottom },
        autoScale: true,
      })
      priceSeriesRef.current = priceSeries
    }

    if (SERIES.rsi.enabled) {
      const rsiSeries = chart.addSeries(
        SERIES_TYPE_MAP[SERIES.rsi.seriesType as keyof typeof SERIES_TYPE_MAP],
        {
          color: SERIES.rsi.color,
          lineWidth: 1,
          priceScaleId: 'rsi',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      rsiSeries.priceScale().applyOptions({
        scaleMargins: { top: SERIES.rsi.top, bottom: SERIES.rsi.bottom },
        autoScale: true,
      })
      rsiSeriesRef.current = rsiSeries
    }

    // ========== ADDITIONAL OHLC BAR SERIES ==========

    if (SERIES.pricePct.enabled) {
      const pricePctSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.pricePct.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          upColor: SERIES.pricePct.color,
          downColor: SERIES.pricePct.color,
          priceScaleId: 'metrics',
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Bar'>
      pricePctSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.pricePct.top,
          bottom: SERIES.pricePct.bottom,
        },
        autoScale: true,
      })
      pricePctSeriesRef.current = pricePctSeries
    }
    if (SERIES.evr.enabled) {
      const evrSeries = chart.addSeries(
        SERIES_TYPE_MAP[SERIES.evr.seriesType as keyof typeof SERIES_TYPE_MAP],
        {
          upColor: SERIES.evr.color,
          downColor: SERIES.evr.color,
          priceScaleId: 'metrics',
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Bar'>
      evrSeriesRef.current = evrSeries
    }
    if (SERIES.vwap.enabled) {
      const vwapSeries = chart.addSeries(
        SERIES_TYPE_MAP[SERIES.vwap.seriesType as keyof typeof SERIES_TYPE_MAP],
        {
          upColor: SERIES.vwap.color,
          downColor: SERIES.vwap.color,
          priceScaleId: 'right',
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Bar'>
      vwapSeriesRef.current = vwapSeries
    }

    if (SERIES.spreadBps.enabled) {
      const spreadBpsSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.spreadBps.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          upColor: SERIES.spreadBps.color,
          downColor: SERIES.spreadBps.color,
          priceScaleId: 'spreadBps',
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Bar'>
      spreadBpsSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.spreadBps.top,
          bottom: SERIES.spreadBps.bottom,
        },
        autoScale: true,
      })
      spreadBpsSeriesRef.current = spreadBpsSeries
    }

    // ========== LINE SERIES ==========

    if (SERIES.bookImbalance.enabled) {
      const bookImbalanceSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.bookImbalance.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          color: SERIES.bookImbalance.color,
          lineWidth: 1,
          priceScaleId: 'bookImbalance',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      bookImbalanceSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bookImbalance.top,
          bottom: SERIES.bookImbalance.bottom,
        },
        autoScale: true,
      })
      bookImbalanceSeriesRef.current = bookImbalanceSeries
    }

    if (SERIES.volume.enabled) {
      const volumeSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.volume.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          color: SERIES.volume.color,
          lineWidth: 1,
          priceScaleId: 'volume',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.volume.top,
          bottom: SERIES.volume.bottom,
        },
        autoScale: true,
      })
      volumeSeriesRef.current = volumeSeries
    }

    if (SERIES.bigTrades.enabled) {
      const bigTradesSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.bigTrades.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          color: SERIES.bigTrades.color,
          lineWidth: 1,
          priceScaleId: 'bigTrades',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      bigTradesSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bigTrades.top,
          bottom: SERIES.bigTrades.bottom,
        },
        autoScale: true,
      })
      bigTradesSeriesRef.current = bigTradesSeries
    }

    if (SERIES.bigVolume.enabled) {
      const bigVolumeSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.bigVolume.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          color: SERIES.bigVolume.color,
          lineWidth: 1,
          priceScaleId: 'bigVolume',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      bigVolumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.bigVolume.top,
          bottom: SERIES.bigVolume.bottom,
        },
        autoScale: true,
      })
      bigVolumeSeriesRef.current = bigVolumeSeries
    }

    if (SERIES.vdStrength.enabled) {
      const vdStrengthSeries = chart.addSeries(
        SERIES_TYPE_MAP[
          SERIES.vdStrength.seriesType as keyof typeof SERIES_TYPE_MAP
        ],
        {
          color: SERIES.vdStrength.color,
          lineWidth: 1,
          priceScaleId: 'vdStrength',
          crosshairMarkerVisible: true,
          priceLineVisible: false,
          lastValueVisible: false,
        }
      ) as ISeriesApi<'Line'>
      vdStrengthSeries.priceScale().applyOptions({
        scaleMargins: {
          top: SERIES.vdStrength.top,
          bottom: SERIES.vdStrength.bottom,
        },
        autoScale: true,
      })
      vdStrengthSeriesRef.current = vdStrengthSeries
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
      // Main series
      priceSeriesRef.current = null
      cvdSeriesRef.current = null
      rsiSeriesRef.current = null
      // OHLC bar series
      pricePctSeriesRef.current = null
      evrSeriesRef.current = null
      vwapSeriesRef.current = null
      spreadBpsSeriesRef.current = null
      // Line series
      bookImbalanceSeriesRef.current = null
      volumeSeriesRef.current = null
      bigTradesSeriesRef.current = null
      bigVolumeSeriesRef.current = null
      vdStrengthSeriesRef.current = null
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

  return {
    chartRef,
    seriesRefs: {
      price: priceSeriesRef,
      cvd: cvdSeriesRef,
      rsi: rsiSeriesRef,
      pricePct: pricePctSeriesRef,
      evr: evrSeriesRef,
      vwap: vwapSeriesRef,
      spreadBps: spreadBpsSeriesRef,
      bookImbalance: bookImbalanceSeriesRef,
      volume: volumeSeriesRef,
      bigTrades: bigTradesSeriesRef,
      bigVolume: bigVolumeSeriesRef,
      vdStrength: vdStrengthSeriesRef,
    },
    absorptionRefs: {
      markers: absorptionMarkersRef,
      timestamps: absorptionTimestampsRef,
    },
    hasInitialized,
  }
}
