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

interface ChartConfig {
  interval: string
  displayName: string
}

interface StrengthChartControlledProps {
  width?: number
  height?: number
}

// Configuration for all CSV files
const CHART_CONFIGS: ChartConfig[] = [
  {
    interval: '3',
    displayName: 'ETHUSD-3',
  },
  {
    interval: '4',
    displayName: 'ETHUSD-4',
  },
  {
    interval: '5',
    displayName: 'ETHUSD-5',
  },
  {
    interval: '9',
    displayName: 'ETHUSD-9',
  },
  {
    interval: '11',
    displayName: 'ETHUSD-11',
  },
]

export default function StrengthChartControlled({
  width = 1280,
  height = 250,
}: StrengthChartControlledProps) {
  const chartRefs = useRef<(IChartApi | null)[]>([])
  const chartContainerRefs = useRef<(HTMLDivElement | null)[]>([])
  const [loadingState, setLoadingState] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [allChartsData, setAllChartsData] = useState<(LineData[] | null)[]>(
    new Array(CHART_CONFIGS.length).fill(null)
  )
  const [rawData, setRawData] = useState<StrengthRowGet[] | null>(null)

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
    chartRefs.current = new Array(CHART_CONFIGS.length).fill(null)
    chartContainerRefs.current = new Array(CHART_CONFIGS.length).fill(null)
    seriesRefs.current = new Array(CHART_CONFIGS.length).fill(null)
  }, [])

  // Helper function to convert strength data to chart data for a specific interval
  const convertToChartData = (
    data: StrengthRowGet[],
    interval: string
  ): LineData[] => {
    return data
      .map((item) => {
        // Access the interval field directly (e.g., item["3"], item["5"], etc.)
        const value = item[interval as keyof StrengthRowGet]
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

  // Helper function to calculate time range based on hours back from latest data
  // Always keeps the end of data on the right edge (optionally overridden)
  const calculateVisibleRange = (
    data: StrengthRowGet[],
    overrideLastTimeSeconds?: number
  ) => {
    if (!data || data.length === 0) return null

    const firstItem = data[0]
    const lastItem = data[data.length - 1]
    if (!firstItem || !lastItem) return null

    const firstTime = firstItem.timenow.getTime() / 1000
    const lastTime =
      overrideLastTimeSeconds != null
        ? overrideLastTimeSeconds
        : lastItem.timenow.getTime() / 1000

    // Calculate start time based on hours back from latest data
    const hoursBackInSeconds = hoursBack * 60 * 60 // Convert hours to seconds
    const startTime = lastTime - hoursBackInSeconds

    return {
      from: Math.max(firstTime, startTime) as Time, // Don't go before data starts
      to: lastTime as Time,
    }
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
      interval: string
    ): number | null => {
      if (
        !rawData ||
        !chartData ||
        typeof t !== 'number' ||
        rawData.length === 0
      )
        return null
      const target = t as number

      // Binary search to find nearest index by timenow in raw data
      let left = 0
      let right = rawData.length - 1
      while (left <= right) {
        const mid = (left + right) >> 1
        const midTime = rawData[mid]!.timenow.getTime() / 1000
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
      if (left >= 0 && left < rawData.length) {
        if (right < 0) idx = left
        else {
          const leftTime = rawData[left]!.timenow.getTime() / 1000
          const rightTime = rawData[right]!.timenow.getTime() / 1000
          idx =
            Math.abs(leftTime - target) < Math.abs(rightTime - target)
              ? left
              : right
        }
      } else if (right < 0) {
        idx = 0
      } else if (right >= rawData.length) {
        idx = rawData.length - 1
      }

      idx = Math.max(0, Math.min(idx, rawData.length - 1))
      const raw = rawData[idx]![interval as keyof StrengthRowGet]
      if (raw === null || raw === undefined) return null
      const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
      return Number.isFinite(value) ? value : null
    }

    chartRefs.current.forEach((chart, index) => {
      if (!chart || !seriesRefs.current[index]) return
      try {
        if (time !== null) {
          const interval = CHART_CONFIGS[index]?.interval
          if (!interval) return
          const price = getNearestSeriesValueAtTime(
            allChartsData[index],
            time,
            interval
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

  // Load data once and extract intervals
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Make a single database query for all intervals
        const { rows, error } = await strengthGets({
          where: { ticker: 'ETHUSD' },
        })
        rows?.reverse()

        if (error) {
          throw new Error(error.message)
        }

        if (!rows || rows.length === 0) {
          throw new Error('No data found for ETHUSD')
        }

        // Store raw data for crosshair calculations
        setRawData(rows)

        // Extract data for each interval from the single dataset
        const extractedChartData: (LineData[] | null)[] = CHART_CONFIGS.map(
          (config) => {
            const chartData = convertToChartData(rows, config.interval)
            // Return null if no valid data points for this interval
            return chartData.length > 0 ? chartData : null
          }
        )

        setAllChartsData(extractedChartData)
        setError(null)
        setLoadingState(false)

        // Set initial time range based on the data
        if (rows.length > 0) {
          const latestTime = rows[rows.length - 1]!.timenow.getTime() / 1000
          const initialRange = calculateVisibleRange(rows, latestTime)
          setTimeRange(initialRange)
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
            setError(
              `Failed to create chart for interval ${CHART_CONFIGS[index]?.interval}`
            )
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
    if (rawData && rawData.length > 0) {
      const latestTime = rawData[rawData.length - 1]!.timenow.getTime() / 1000
      const newRange = calculateVisibleRange(rawData, latestTime)
      setTimeRange(newRange)
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
        CHART_CONFIGS.map((config, index) => {
          const hasData = allChartsData[index] !== null

          return (
            <div
              key={config.interval}
              id={`strength-chart-${config.interval}`}
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
                    {config.displayName}
                  </h3>

                  {!hasData && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                      <div className="text-lg text-gray-500">
                        No data for interval {config.interval}
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
