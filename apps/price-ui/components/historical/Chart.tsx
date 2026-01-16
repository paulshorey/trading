'use client'

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
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

  if (typeof exporting === 'function') exporting(Highcharts)
  else if (exporting?.default) exporting.default(Highcharts)

  if (typeof accessibility === 'function') accessibility(Highcharts)
  else if (accessibility?.default) accessibility.default(Highcharts)
}
initModules()

// Dark theme colors
const darkTheme = {
  background: '#1a1a2e',
  text: '#e0e0e0',
  gridLine: '#2d2d4a',
  axisLine: '#4a4a6a',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
}

// const CANDLES_URL = 'http://localhost:8080/historical/candles?ticker=ES'
const CANDLES_URL =
  process.env.NEXT_PUBLIC_MARKET_DATA_API_URL+'/historical/candles?ticker=ES'
// const CANDLES_URL = 'https://demo-live-data.highcharts.com/aapl-historical.json'
const DEBOUNCE_MS = 1000 // Necessary on scroll events to prevent continous fetch() calls

export function Chart() {
  const chartRef = useRef<HighchartsReact.RefObject>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const [navigatorData, setNavigatorData] = useState<number[][]>([]) // Full dataset for navigator
  const [chartData, setChartData] = useState<number[][]>([]) // Current view data for main series

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

  // Load initial data
  useEffect(() => {
    fetch(CANDLES_URL)
      .then((res) => res.ok && res.json())
      .then((data) => {
        if (data) {
          setNavigatorData(data) // Full data for navigator (never changes)
          setChartData(data) // Initial view data
        }
      })
      .catch((error) => console.error('Error loading initial data:', error))
  }, [])

  // Callback for loading data on zoom/pan
  const afterSetExtremes = useCallback(
    (e: Highcharts.AxisSetExtremesEventObject) => {
      const chart = chartRef.current?.chart
      if (!chart) return

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        chart.showLoading('Loading data from server...')

        fetch(`${CANDLES_URL}&start=${Math.round(e.min)}&end=${Math.round(e.max)}`)
          .then((res) => res.ok && res.json())
          .then((data) => {
            if (data) {
              setChartData(data)
            }
            chart.hideLoading()
          })
          .catch((error) => {
            console.error('Error loading data:', error.message)
            chart.hideLoading()
          })
      }, DEBOUNCE_MS)
    },
    []
  )

  const options: Highcharts.Options = useMemo(
    () => ({
      chart: {
        type: 'candlestick',
        backgroundColor: darkTheme.background,
        spacing: [10, 10, 0, 10], // top, right, bottom, left - remove bottom spacing
        style: {
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        },
        zooming: {
          type: 'x',
        },
      },

      // title: {
      //   text: 'ES',
      //   align: 'left',
      //   style: {
      //     color: darkTheme.text,
      //     fontSize: '18px',
      //     fontWeight: '600',
      //   },
      // },

      // subtitle: {
      //   text: 'Displaying 1.7 million data points in Highcharts Stock by async server loading',
      //   align: 'left',
      //   style: {
      //     color: '#a0a0b0',
      //   },
      // },

      navigator: {
        adaptToUpdatedData: false,
        series: {
          data: navigatorData, // Always use full dataset for navigator
        },
        outlineColor: darkTheme.axisLine,
        maskFill: 'rgba(102, 133, 194, 0.2)',
      },

      scrollbar: {
        liveRedraw: false,
        barBackgroundColor: darkTheme.axisLine,
        trackBackgroundColor: darkTheme.gridLine,
      },

      rangeSelector: {
        buttons: [
          { type: 'hour', count: 1, text: '1h' },
          { type: 'day', count: 1, text: '1d' },
          { type: 'month', count: 1, text: '1m' },
          { type: 'year', count: 1, text: '1y' },
          { type: 'all', text: 'All' },
        ],
        inputEnabled: false,
        selected: 4,
        buttonTheme: {
          fill: darkTheme.gridLine,
          stroke: darkTheme.axisLine,
          style: {
            color: darkTheme.text,
          },
          states: {
            hover: {
              fill: darkTheme.axisLine,
            },
            select: {
              fill: '#4a6fa5',
              style: {
                color: '#ffffff',
              },
            },
          },
        },
        labelStyle: {
          color: darkTheme.text,
        },
      },

      xAxis: {
        events: {
          afterSetExtremes,
        },
        minRange: 3600 * 1000,
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

      series: [
        {
          type: 'candlestick',
          name: 'AAPL',
          data: chartData,
          dataGrouping: {
            enabled: false,
          },
          color: darkTheme.candleDown,
          upColor: darkTheme.candleUp,
          lineColor: darkTheme.candleDown,
          upLineColor: darkTheme.candleUp,
        },
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
    [chartData, navigatorData, afterSetExtremes]
  )

  return (
    <HighchartsReact
      highcharts={Highcharts}
      constructorType="stockChart"
      options={options}
      ref={chartRef}
      immutable={true}
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
