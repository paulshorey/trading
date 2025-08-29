'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  IChartApi,
  LineData,
  LineSeries,
  Time,
  MouseEventParams,
  ISeriesApi,
} from 'lightweight-charts'
import { StrengthRowGet, strengthGets } from '@apps/common/sql/strength'

interface StrengthChartsSyncedProps {
  width?: number
  height?: number
  tickers?: string[]
  control_interval?: string
}

/**
 * This component fetches data for several trading tickers and displays their relative strength on charts.
 * All charts are synchronized to the same time range and selected time.
 * When a point on one chart is hovered, the crosshair is moved to this same time on all charts.
 */
export default function StrengthChartsSynced({
  width = 1280,
  height = 300,
  tickers = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD'],
  control_interval = '3',
}: StrengthChartsSyncedProps) {
  const chartRefs = useRef<(IChartApi | null)[]>([])
  const chartContainerRefs = useRef<(HTMLDivElement | null)[]>([])
  const [loadingState, setLoadingState] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [allChartsData, setAllChartsData] = useState<(LineData[] | null)[]>(
    new Array(tickers.length).fill(null)
  )
  const [rawData, setRawData] = useState<(StrengthRowGet[] | null)[]>(
    new Array(tickers.length).fill(null)
  )

  // Master time controls
  const [timeRange, setTimeRange] = useState<{ from: Time; to: Time } | null>(
    null
  )
  const [hoursBack, setHoursBack] = useState<number>(48) // Hours to look back from latest data

  // Synchronized cursor position
  const [cursorTime, setCursorTime] = useState<Time | null>(null)
  const isUpdatingCursor = useRef(false) // Prevent infinite loops

  // Initialize refs arrays
  useEffect(() => {
    chartRefs.current = new Array(tickers.length).fill(null)
    chartContainerRefs.current = new Array(tickers.length).fill(null)
    seriesRefs.current = new Array(tickers.length).fill(null)
  }, [])

  // Helper function to convert strength data to chart data using the fixed interval
  const convertToChartData = (data: StrengthRowGet[]): LineData[] => {
    return data
      .map((item) => {
        // Access the fixed interval field (interval "3")
        const value = item[control_interval as keyof StrengthRowGet]

        // Skip rows where this interval's value is null
        if (value === null || value === undefined) return null
        const numericValue =
          typeof value === 'string' ? parseFloat(value) : Number(value)
        // Skip invalid values
        if (!Number.isFinite(numericValue)) return null

        return {
          time: (new Date(item.timenow).getTime() / 1000) as any,
          value: numericValue,
        }
      })
      .filter((item): item is LineData => item !== null) // Remove null values
  }

  // Apply time range to all charts
  const applyTimeRangeToAllCharts = (
    range: { from: Time; to: Time } | null
  ) => {
    if (!range) return

    chartRefs.current.forEach((chart) => {
      if (chart) {
        try {
          chart.timeScale().setVisibleRange(range)
        } catch (error) {
          console.warn('Failed to set visible range:', error)
        }
      }
    })
  }

  // Store series references for crosshair synchronization
  const seriesRefs = useRef<(ISeriesApi<'Line'> | null)[]>([])

  // Apply cursor position to all charts
  const applyCursorToAllCharts = (time: Time | null) => {
    if (isUpdatingCursor.current) return
    isUpdatingCursor.current = true

    const getNearestSeriesValueAtTime = (
      chartData: LineData[] | null | undefined,
      t: Time,
      chartIndex: number
    ): number | null => {
      const tickerRawData = rawData[chartIndex]
      if (
        !tickerRawData ||
        !chartData ||
        typeof t !== 'number' ||
        tickerRawData.length === 0
      )
        return null
      const target = t as number

      // Binary search to find nearest index by timenow in raw data
      let left = 0
      let right = tickerRawData.length - 1
      while (left <= right) {
        const mid = (left + right) >> 1
        const midTime = tickerRawData[mid]!.timenow.getTime() / 1000
        if (midTime === target) {
          left = mid
          right = mid - 1
          break
        }
        if (midTime < target) left = mid + 1
        else right = mid - 1
      }

      // Candidates are at indices right and left
      let idx = right
      if (left >= 0 && left < tickerRawData.length) {
        if (right < 0) idx = left
        else {
          const leftTime = tickerRawData[left]!.timenow.getTime() / 1000
          const rightTime = tickerRawData[right]!.timenow.getTime() / 1000
          idx =
            Math.abs(leftTime - target) < Math.abs(rightTime - target)
              ? left
              : right
        }
      } else if (right < 0) {
        idx = 0
      } else if (right >= tickerRawData.length) {
        idx = tickerRawData.length - 1
      }

      idx = Math.max(0, Math.min(idx, tickerRawData.length - 1))
      const raw = tickerRawData[idx]![control_interval as keyof StrengthRowGet]

      if (raw === null || raw === undefined) return null
      const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
      return Number.isFinite(value) ? value : null
    }

    chartRefs.current.forEach((chart, index) => {
      if (!chart || !seriesRefs.current[index]) return
      try {
        if (time !== null) {
          const price = getNearestSeriesValueAtTime(
            allChartsData[index],
            time,
            index
          )
          if (price != null) {
            chart.setCrosshairPosition(price, time, seriesRefs.current[index]!)
          } else {
            chart.clearCrosshairPosition()
          }
        } else {
          chart.clearCrosshairPosition()
        }
      } catch (error) {
        console.warn('Failed to set crosshair position:', error)
      }
    })

    setTimeout(() => {
      isUpdatingCursor.current = false
    }, 0)
  }

  // Helper function to create a single chart
  const createSingleChart = (
    container: HTMLDivElement,
    chartData: LineData[],
    chartIndex: number
  ): IChartApi => {
    const chart = createChart(container, {
      width,
      height: height * 0.7, // Smaller height to leave room for controls
      localization: {
        timeFormatter: (time: Time) => {
          // Convert the time (which is in seconds since epoch) to milliseconds
          const date = new Date((time as number) * 1000)
          // Format the date in the user's local time zone
          return date.toLocaleTimeString()
        },
      },
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { visible: false }, // Hide vertical grid lines to reduce clutter
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: {
        visible: false, // Hide the entire y-axis
      },
      // timeScale: {
      //   visible: false,
      // },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0, // Normal mode: we'll set Y explicitly via setCrosshairPosition
        vertLine: {
          visible: true,
          color: '#758391',
          width: 1,
          style: 0, // Solid line
        },
        // horzLine: {
        //   visible: true,
        //   color: '#758391',
        //   width: 1,
        //   style: 0, // Solid line
        // },
        horzLine: {
          visible: false, // Hide horizontal price line
        },
      },
      // Disable zoom/scroll but allow crosshair interactions
      handleScroll: false,
      handleScale: false,
    })

    const strengthSeries = chart.addSeries(LineSeries, {
      color: '#e8850d',
      lineWidth: 1,
      crosshairMarkerBackgroundColor: 'transparent',
      crosshairMarkerBorderColor: 'transparent',
      crosshairMarkerBorderWidth: 0,
      crosshairMarkerVisible: true,
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    strengthSeries.setData(chartData)

    // Store the strengthSeries reference for crosshair synchronization
    seriesRefs.current[chartIndex] = strengthSeries

    // Add crosshair event handlers for cursor synchronization
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (isUpdatingCursor.current) return

      if (param.time !== undefined && param.time !== null) {
        setCursorTime(param.time)
      }
    })

    // Handle cursor leaving the chart area
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (isUpdatingCursor.current) return

      if (param.time === undefined) {
        setCursorTime(null)
      }
    })

    return chart
  }

  // Load data for each ticker
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Fetch data for each ticker separately
        const allTickerData: (StrengthRowGet[] | null)[] = []
        const allChartData: (LineData[] | null)[] = []
        let latestOverallTime = 0
        let earliestOverallTime = Infinity

        for (let i = 0; i < tickers.length; i++) {
          const ticker = tickers[i]!
          const { rows, error } = await strengthGets({
            where: { ticker },
          })

          if (error) {
            console.error(`Error loading data for ${ticker}:`, error)
            allTickerData.push(null)
            allChartData.push(null)
            continue
          }

          if (!rows || rows.length === 0) {
            console.warn(`No data found for ${ticker}`)
            allTickerData.push(null)
            allChartData.push(null)
            continue
          }

          // Reverse to get chronological order
          rows.reverse()

          // Store raw data for this ticker
          allTickerData.push(rows)

          // Convert to chart data
          const chartData = convertToChartData(rows)
          allChartData.push(chartData.length > 0 ? chartData : null)

          // Track overall time range across all tickers
          if (rows.length > 0) {
            const firstTime = rows[0]!.timenow.getTime() / 1000
            const lastTime = rows[rows.length - 1]!.timenow.getTime() / 1000
            earliestOverallTime = Math.min(earliestOverallTime, firstTime)
            latestOverallTime = Math.max(latestOverallTime, lastTime)
          }
        }

        // Store all data
        setRawData(allTickerData)
        setAllChartsData(allChartData)
        setError(null)
        setLoadingState(false)

        // Set initial time range based on the overall data range
        if (latestOverallTime > 0 && earliestOverallTime < Infinity) {
          const hoursBackInSeconds = hoursBack * 60 * 60
          const startTime = Math.max(
            earliestOverallTime,
            latestOverallTime - hoursBackInSeconds
          )
          setTimeRange({
            from: startTime as Time,
            to: latestOverallTime as Time,
          })
        }
      } catch (err) {
        console.error('Error loading chart data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoadingState(false)
      }
    }

    loadAllData()
  }, [])

  // Create charts when data is loaded
  useEffect(() => {
    const createCharts = () => {
      allChartsData.forEach((data, index) => {
        if (
          data &&
          chartContainerRefs.current[index] &&
          !chartRefs.current[index]
        ) {
          try {
            const chart = createSingleChart(
              chartContainerRefs.current[index]!,
              data,
              index
            )
            chartRefs.current[index] = chart

            // Apply current time range to newly created chart
            if (timeRange) {
              try {
                chart.timeScale().setVisibleRange(timeRange)
              } catch (error) {
                console.warn('Failed to set initial visible range:', error)
              }
            }
          } catch (err) {
            console.error(`Error creating chart ${index}:`, err)
            setError(`Failed to create chart for ${tickers[index]}`)
          }
        }
      })
    }

    // Small delay to ensure DOM elements are ready
    const timer = setTimeout(createCharts, 100)
    return () => clearTimeout(timer)
  }, [allChartsData, width, height])

  // Apply time range changes to all charts
  useEffect(() => {
    if (timeRange) {
      applyTimeRangeToAllCharts(timeRange)
    }
  }, [timeRange])

  // Update time range when hours back changes
  useEffect(() => {
    if (rawData && rawData.some((data) => data && data.length > 0)) {
      let latestOverallTime = 0
      let earliestOverallTime = Infinity

      // Find the overall time range across all tickers
      rawData.forEach((tickerData) => {
        if (tickerData && tickerData.length > 0) {
          const firstTime = tickerData[0]!.timenow.getTime() / 1000
          const lastTime =
            tickerData[tickerData.length - 1]!.timenow.getTime() / 1000
          earliestOverallTime = Math.min(earliestOverallTime, firstTime)
          latestOverallTime = Math.max(latestOverallTime, lastTime)
        }
      })

      if (latestOverallTime > 0 && earliestOverallTime < Infinity) {
        const hoursBackInSeconds = hoursBack * 60 * 60
        const startTime = Math.max(
          earliestOverallTime,
          latestOverallTime - hoursBackInSeconds
        )
        setTimeRange({
          from: startTime as Time,
          to: latestOverallTime as Time,
        })
      }
    }
  }, [hoursBack, rawData])

  // Apply cursor position changes to all charts
  useEffect(() => {
    applyCursorToAllCharts(cursorTime)
  }, [cursorTime])

  // Cleanup function
  useEffect(() => {
    return () => {
      chartRefs.current.forEach((chart) => {
        if (chart) {
          chart.remove()
        }
      })
      chartRefs.current = []
    }
  }, [])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      chartRefs.current.forEach((chart, index) => {
        if (chart && chartContainerRefs.current[index]) {
          chart.applyOptions({
            width: chartContainerRefs.current[index]!.clientWidth,
          })
        }
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="mx-auto w-full">
      {/* Master Controls */}
      <div className="controls-panel">
        <input
          type="range"
          min="4"
          max="168"
          step="1"
          value={hoursBack}
          onChange={(e) => setHoursBack(parseInt(e.target.value))}
          className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        {/* <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>4 hours</span>
          <span>168 hours</span>
        </div> */}
      </div>

      {/* Show loading or error state for all charts */}
      {loadingState && (
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading strength data...</div>
        </div>
      )}

      {error && !loadingState && (
        <div className="flex items-center justify-center h-64">
          <div className="text-lg text-red-500">Error: {error}</div>
        </div>
      )}

      {/* Render all charts stacked vertically */}
      {!loadingState &&
        !error &&
        tickers.map((ticker, index) => {
          const hasData = allChartsData[index] !== null

          return (
            <div
              key={ticker}
              id={`strength-chart-${ticker}`}
              className=" relative overflow-x-auto"
              style={{ marginTop: '-2px', marginBottom: '-30px' }}
              dir="rtl"
            >
              {/* Chart container */}
              <div
                ref={(el) => {
                  chartContainerRefs.current[index] = el
                }}
                style={{ width, height: height * 0.7 }}
                className="border border-gray-200 rounded relative z-10"
              ></div>
              {/* Title positioned above chart but overlapping */}
              <div style={{ zIndex: 1000 }} className="absolute left-0 top-0">
                <div className="fixed left-0 bg-[var(--mantine-color-body)] opacity-50 pl-2 pr-3 py-1 rounded-br-xl shadow-sm pointer-events-none font-bold">
                  <h3 className="text-sm font-semibold leading-tight">
                    {ticker}
                  </h3>

                  {!hasData && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                      <div className="text-lg text-gray-500">
                        No data for {ticker}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
    </div>
  )
}
