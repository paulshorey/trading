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
import { FractalRowGet, fractalGets } from '@apps/common/sql/fractal'

interface ChartConfig {
  interval: string
  displayName: string
}

interface FractalChartControlledProps {
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
    interval: '6',
    displayName: 'ETHUSD-6',
  },
  {
    interval: '12',
    displayName: 'ETHUSD-12',
  },
  {
    interval: '24',
    displayName: 'ETHUSD-24',
  },
  {
    interval: '48',
    displayName: 'ETHUSD-48',
  },
  // {
  //   interval: '72',
  //   displayName: 'ETHUSD-72',
  // },
]

export default function FractalChartControlled({
  width = 1920,
  height = 250,
}: FractalChartControlledProps) {
  const chartRefs = useRef<(IChartApi | null)[]>([])
  const chartContainerRefs = useRef<(HTMLDivElement | null)[]>([])
  const [loadingStates, setLoadingStates] = useState<boolean[]>(
    new Array(CHART_CONFIGS.length).fill(true)
  )
  const [errors, setErrors] = useState<(string | null)[]>(
    new Array(CHART_CONFIGS.length).fill(null)
  )
  const [allChartsData, setAllChartsData] = useState<
    (FractalRowGet[] | null)[]
  >(new Array(CHART_CONFIGS.length).fill(null))

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

  // Helper function to convert fractal data to chart data
  const convertToChartData = (
    data: FractalRowGet[],
    field: keyof Omit<FractalRowGet, 'time' | 'timenow' | 'created_at'>
  ): LineData[] => {
    return data.map((item) => {
      const value = item[field]
      const numericValue = typeof value === 'string' ? parseFloat(value) : value
      return {
        time: (new Date(item.timenow).getTime() / 1000) as any,
        value: numericValue,
      }
    })
  }

  // Helper function to calculate time range based on hours back from latest data
  // Always keeps the end of data on the right edge (optionally overridden)
  const calculateVisibleRange = (
    data: FractalRowGet[],
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

  const getGlobalLatestTimeSeconds = (
    datasets: (FractalRowGet[] | null)[]
  ): number | null => {
    let latest = 0
    for (const ds of datasets) {
      if (!ds || ds.length === 0) continue
      const last = ds[ds.length - 1]!
      const seconds = Math.floor(last.timenow.getTime() / 1000)
      if (seconds > latest) latest = seconds
    }
    return latest || null
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
      data: FractalRowGet[] | null | undefined,
      t: Time
    ): number | null => {
      if (!data || typeof t !== 'number' || data.length === 0) return null
      const target = t as number

      // Binary search to find nearest index by timenow
      let left = 0
      let right = data.length - 1
      while (left <= right) {
        const mid = (left + right) >> 1
        const midTime = data[mid]!.timenow.getTime() / 1000
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
      if (left >= 0 && left < data.length) {
        if (right < 0) idx = left
        else {
          const leftTime = data[left]!.timenow.getTime() / 1000
          const rightTime = data[right]!.timenow.getTime() / 1000
          idx =
            Math.abs(leftTime - target) < Math.abs(rightTime - target)
              ? left
              : right
        }
      } else if (right < 0) {
        idx = 0
      } else if (right >= data.length) {
        idx = data.length - 1
      }

      idx = Math.max(0, Math.min(idx, data.length - 1))
      const raw = data[idx]!.strength as unknown as number | string
      const value = typeof raw === 'string' ? parseFloat(raw) : raw
      return Number.isFinite(value) ? value : null
    }

    chartRefs.current.forEach((chart, index) => {
      if (!chart || !seriesRefs.current[index]) return
      try {
        if (time !== null) {
          const price = getNearestSeriesValueAtTime(allChartsData[index], time)
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
    fractalData: FractalRowGet[],
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
    strengthSeries.setData(convertToChartData(fractalData, 'strength'))

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

  // Load all CSV data in parallel
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // Load all chart data in parallel for better performance
        const dataPromises = CHART_CONFIGS.map(async (config, index) => {
          try {
            const { rows, error } = await fractalGets({
              where: { ticker: 'ETHUSD', interval: config.interval },
            })

            if (error) {
              throw new Error(error.message)
            }

            if (!rows || rows.length === 0) {
              throw new Error(`No data found for interval ${config.interval}`)
            }
            return { index, data: rows, error: null }
          } catch (err) {
            return {
              index,
              data: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            }
          }
        })

        const results = await Promise.all(dataPromises)

        // Update states based on results
        const newData: (FractalRowGet[] | null)[] = new Array(
          CHART_CONFIGS.length
        ).fill(null)
        const newErrors: (string | null)[] = new Array(
          CHART_CONFIGS.length
        ).fill(null)
        const newLoadingStates: boolean[] = new Array(
          CHART_CONFIGS.length
        ).fill(false)

        let globalLatestTimeSeconds = 0

        results.forEach((result, index) => {
          newData[index] = result.data
          newErrors[index] = result.error
          newLoadingStates[index] = false

          // Scan each dataset to find the latest time
          const ds = result.data
          if (ds && ds.length) {
            for (let i = 0; i < ds.length; i++) {
              const seconds = Math.floor(ds[i]!.timenow.getTime() / 1000)
              if (seconds > globalLatestTimeSeconds) {
                globalLatestTimeSeconds = seconds
              }
            }
          }
        })

        setAllChartsData(newData)
        setErrors(newErrors)
        setLoadingStates(newLoadingStates)

        // Set initial time range based on global latest time across all datasets
        const firstDataset = newData.find((d) => d?.[0]?.interval === '3') as
          | FractalRowGet[]
          | undefined
        if (firstDataset && globalLatestTimeSeconds) {
          const initialRange = calculateVisibleRange(
            firstDataset,
            globalLatestTimeSeconds
          )
          setTimeRange(initialRange)
        }
      } catch (err) {
        console.error('Error loading chart data:', err)
        setErrors(new Array(CHART_CONFIGS.length).fill('Failed to load data'))
        setLoadingStates(new Array(CHART_CONFIGS.length).fill(false))
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
            setErrors((prev) => {
              const newErrors = [...prev]
              newErrors[index] = 'Failed to create chart'
              return newErrors
            })
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
    const firstDataset = allChartsData.find((data) => data !== null)
    if (firstDataset) {
      const latest = getGlobalLatestTimeSeconds(allChartsData)
      const newRange = calculateVisibleRange(
        firstDataset as FractalRowGet[],
        latest == null ? undefined : latest
      )
      setTimeRange(newRange)
    }
  }, [hoursBack, allChartsData])

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

      {/* Render all charts stacked vertically */}
      {CHART_CONFIGS.map((config, index) => {
        const isLoading = loadingStates[index]
        const error = errors[index]
        const hasData = allChartsData[index] !== null

        return (
          <div
            key={config.interval}
            id={`fractal-chart-${config.interval}`}
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

                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                    <div className="text-lg">
                      Loading {config.displayName}...
                    </div>
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                    <div className="text-lg text-red-500">Error: {error}</div>
                  </div>
                )}
                {!isLoading && !error && !hasData && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                    <div className="text-lg text-gray-500">
                      No data available
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
