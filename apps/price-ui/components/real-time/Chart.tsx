'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'

// Initialize modules once
let modulesInitialized = false
function initModules() {
  if (modulesInitialized || typeof window === 'undefined') return
  modulesInitialized = true

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exporting = require('highcharts/modules/exporting')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const accessibility = require('highcharts/modules/accessibility')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const indicators = require('highcharts/indicators/indicators')

  if (typeof exporting === 'function') exporting(Highcharts)
  else if (exporting?.default) exporting.default(Highcharts)

  if (typeof accessibility === 'function') accessibility(Highcharts)
  else if (accessibility?.default) accessibility.default(Highcharts)

  if (typeof indicators === 'function') indicators(Highcharts)
  else if (indicators?.default) indicators.default(Highcharts)
}
initModules()

type CandleTuple = [number, number, number, number, number, number]

// SMA configuration
const SMA_PERIOD = 20
const INITIAL_CANDLES = 5000
const POLL_INTERVAL_MS = 10_000
const CANDLE_INTERVAL_MS = 60_000
const RECENT_CANDLES = SMA_PERIOD + 2

// Dark theme colors
const darkTheme = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  gridLine: '#2d2d4a',
  axisLine: '#4a4a6a',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  smaLine: '#f0ad4e', // Orange/gold color for the SMA line
}

const TICKER = 'ES'
const BASE_CANDLES_URL = `/api/v1/market-data/candles?ticker=${TICKER}&timeframe=1m`

function buildCandlesUrl(limit: number) {
  return `${BASE_CANDLES_URL}&limit=${limit}`
}

function candlesEqual(a: CandleTuple, b: CandleTuple) {
  return (
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3] &&
    a[4] === b[4] &&
    a[5] === b[5]
  )
}

export function Chart() {
  const chartRef = useRef<HighchartsReact.RefObject>(null)
  const dataRef = useRef<CandleTuple[]>([])
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)
  const viewRangeRef = useRef<number | null>(null)

  const handleAfterSetExtremes = useCallback(
    (e: Highcharts.AxisSetExtremesEventObject) => {
      if (typeof e.min === 'number' && typeof e.max === 'number') {
        viewRangeRef.current = e.max - e.min
      }
    },
    []
  )

  const updateVisibleRangeToLatest = useCallback(() => {
    const chart = chartRef.current?.chart
    if (!chart) return

    const axis = chart.xAxis[0]
    if (!axis) return
    const series = chart.get('price-data') as Highcharts.Series | undefined
    const lastPoint = series?.data[series.data.length - 1]

    if (!lastPoint || axis.max === undefined || axis.min === undefined) {
      return
    }

    const range =
      viewRangeRef.current !== null ? viewRangeRef.current : axis.max - axis.min
    const lastTime = lastPoint.x
    const isNearLatest = axis.max >= lastTime - CANDLE_INTERVAL_MS * 1.2

    if (isNearLatest && range > 0) {
      axis.setExtremes(
        lastTime - range,
        lastTime,
        false,
        false,
        { trigger: 'realtime' }
      )
    }
  }, [])

  const applyRecentCandles = useCallback((recentCandles: CandleTuple[]) => {
    const chart = chartRef.current?.chart
    const priceSeries = chart?.get('price-data') as
      | Highcharts.Series
      | undefined

    if (!chart || !priceSeries) return

    const existing = dataRef.current
    if (existing.length === 0) {
      dataRef.current = recentCandles
      priceSeries.setData(recentCandles, false)
      chart.redraw()
      return
    }

    const startIndex = Math.max(0, existing.length - recentCandles.length - 2)
    const indexByTime = new Map<number, number>()
    for (let i = startIndex; i < existing.length; i += 1) {
      const candle = existing[i]
      if (!candle) continue
      indexByTime.set(candle[0], i)
    }

    let didUpdate = false

    for (const candle of recentCandles) {
      const existingIndex = indexByTime.get(candle[0])
      if (existingIndex !== undefined) {
        const existingCandle = existing[existingIndex]
        if (!existingCandle) {
          continue
        }
        if (!candlesEqual(existingCandle, candle)) {
          existing[existingIndex] = candle
          const point = priceSeries.data[existingIndex]
          if (point) {
            point.update(candle, false)
          }
          didUpdate = true
        }
        continue
      }

      const lastExisting = existing[existing.length - 1]
      if (lastExisting && candle[0] > lastExisting[0]) {
        existing.push(candle)
        priceSeries.addPoint(candle, false, false)
        didUpdate = true
      }
    }

    if (didUpdate) {
      updateVisibleRangeToLatest()
      chart.redraw()
    }
  }, [updateVisibleRangeToLatest])

  const fetchCandles = useCallback(async (limit: number) => {
    const response = await fetch(buildCandlesUrl(limit))
    if (!response.ok) {
      throw new Error(`Failed to fetch candles: ${response.status}`)
    }
    return (await response.json()) as CandleTuple[]
  }, [])

  const pollLatest = useCallback(async () => {
    if (isPollingRef.current) return
    isPollingRef.current = true
    try {
      const recentCandles = await fetchCandles(RECENT_CANDLES)
      if (recentCandles.length > 0) {
        applyRecentCandles(recentCandles)
      }
    } catch (error) {
      console.error('Error fetching recent candles:', error)
    } finally {
      isPollingRef.current = false
    }
  }, [applyRecentCandles, fetchCandles])

  const startPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    pollRef.current = setInterval(() => {
      void pollLatest()
    }, POLL_INTERVAL_MS)
  }, [pollLatest])

  useEffect(() => {
    let isMounted = true
    const chart = chartRef.current?.chart
    if (chart) {
      chart.showLoading('Loading real-time data...')
    }

    fetchCandles(INITIAL_CANDLES)
      .then((initialCandles) => {
        if (!isMounted) return
        const resolvedChart = chartRef.current?.chart
        const priceSeries = resolvedChart?.get('price-data') as
          | Highcharts.Series
          | undefined

        if (resolvedChart && priceSeries && initialCandles.length > 0) {
          dataRef.current = initialCandles
          priceSeries.setData(initialCandles, false)

          const min = initialCandles[0]?.[0]
          const max = initialCandles[initialCandles.length - 1]?.[0]
          if (typeof min === 'number' && typeof max === 'number') {
            const axis = resolvedChart.xAxis[0]
            if (axis) {
              axis.setExtremes(min, max, false, false, { trigger: 'initial' })
              viewRangeRef.current = max - min
            }
          }
          resolvedChart.redraw()
        }
      })
      .catch((error) => {
        console.error('Error loading initial candles:', error)
      })
      .finally(() => {
        if (!isMounted) return
        const resolvedChart = chartRef.current?.chart
        resolvedChart?.hideLoading()
        startPolling()
      })

    return () => {
      isMounted = false
      if (pollRef.current) {
        clearInterval(pollRef.current)
      }
    }
  }, [fetchCandles, startPolling])

  // Handle window resize with reflow
  useEffect(() => {
    const handleResize = () => {
      const chart = chartRef.current?.chart
      if (chart) {
        chart.reflow()
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const options: Highcharts.Options = useMemo(
    () => ({
      chart: {
        type: 'candlestick',
        backgroundColor: darkTheme.background,
        spacing: [10, 10, 0, 10],
        style: {
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        },
        panning: {
          enabled: true,
          type: 'x',
        },
        zooming: {
          type: '' as unknown as Highcharts.OptionsTypeValue,
        },
      },

      navigator: {
        adaptToUpdatedData: true,
        outlineColor: darkTheme.axisLine,
        maskFill: 'rgba(102, 133, 194, 0.2)',
      },

      scrollbar: {
        liveRedraw: false,
        barBackgroundColor: darkTheme.axisLine,
        trackBackgroundColor: darkTheme.gridLine,
      },

      rangeSelector: {
        enabled: false,
      },

      xAxis: {
        events: {
          afterSetExtremes: handleAfterSetExtremes,
        },
        minRange: CANDLE_INTERVAL_MS * 5,
        gridLineColor: darkTheme.gridLine,
        lineColor: darkTheme.axisLine,
        tickColor: darkTheme.axisLine,
        labels: {
          style: {
            color: darkTheme.text,
          },
        },
      },

      yAxis: {
        floor: 0,
        gridLineColor: darkTheme.gridLine,
        lineColor: darkTheme.axisLine,
        labels: {
          style: {
            color: darkTheme.text,
          },
        },
      },

      plotOptions: {
        series: {
          animation: false,
          dataGrouping: {
            enabled: false,
          },
          turboThreshold: 10000,
          cropThreshold: 10000,
        },
      },

      series: [
        {
          id: 'price-data',
          type: 'candlestick',
          name: TICKER,
          data: [],
          color: darkTheme.candleDown,
          upColor: darkTheme.candleUp,
          lineColor: darkTheme.candleDown,
          upLineColor: darkTheme.candleUp,
        },
        {
          type: 'sma',
          linkedTo: 'price-data',
          name: `SMA (${SMA_PERIOD})`,
          params: {
            period: SMA_PERIOD,
          },
          color: darkTheme.smaLine,
          lineWidth: 2,
          dataGrouping: {
            enabled: false,
          },
        } as Highcharts.SeriesOptionsType,
      ],

      credits: {
        enabled: false,
      },

      exporting: {
        buttons: {
          contextButton: {
            theme: {
              fill: darkTheme.gridLine,
            },
          },
        },
      },

      loading: {
        style: {
          backgroundColor: darkTheme.background,
        },
        labelStyle: {
          color: darkTheme.text,
        },
      },
    }),
    [handleAfterSetExtremes]
  )

  return (
    <HighchartsReact
      highcharts={Highcharts}
      constructorType="stockChart"
      options={options}
      ref={chartRef}
      immutable={false}
      containerProps={{
        style: {
          width: '100%',
          height: '100%',
          background: darkTheme.background,
        },
      }}
    />
  )
}
