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
import { FractalData, parseFractalCSV } from '../lib/parseFractalCSV'

interface ChartConfig {
  fileName: string
  displayName: string
}

interface FractalChartControlledProps {
  width?: number
  height?: number
}

// Configuration for all CSV files
const CHART_CONFIGS: ChartConfig[] = [
  // {
  //   fileName: '/fractal/ETHUSD-30S.csv',
  //   displayName: 'ETHUSD-30S',
  // },
  {
    fileName: '/fractal/ETHUSD-2.csv',
    displayName: 'ETHUSD-2',
  },
  {
    fileName: '/fractal/ETHUSD-6.csv',
    displayName: 'ETHUSD-6',
  },
  {
    fileName: '/fractal/ETHUSD-8.csv',
    displayName: 'ETHUSD-8',
  },
  {
    fileName: '/fractal/ETHUSD-30.csv',
    displayName: 'ETHUSD-30',
  },
  {
    fileName: '/fractal/ETHUSD-90.csv',
    displayName: 'ETHUSD-90',
  },
]

export default function FractalChartControlled({
  width = 1000,
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
  const [allChartsData, setAllChartsData] = useState<(FractalData[] | null)[]>(
    new Array(CHART_CONFIGS.length).fill(null)
  )

  // Master time controls
  const [timeRange, setTimeRange] = useState<{ from: Time; to: Time } | null>(
    null
  )
  const [hoursBack, setHoursBack] = useState<number>(80) // Hours to look back from latest data

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
    data: FractalData[],
    field: keyof Omit<FractalData, 'time'>
  ): LineData[] => {
    return data.map((item) => {
      const value = item[field]
      const numericValue = typeof value === 'string' ? parseFloat(value) : value
      return {
        time: (new Date(item.time).getTime() / 1000) as any,
        value: numericValue,
      }
    })
  }

  // Helper function to calculate time range based on hours back from latest data
  // Always keeps the end of data on the right edge
  const calculateVisibleRange = (data: FractalData[]) => {
    if (data.length === 0) return null

    const firstItem = data[0]
    const lastItem = data[data.length - 1]
    if (!firstItem || !lastItem) return null

    const firstTime = new Date(firstItem.time).getTime() / 1000
    const lastTime = new Date(lastItem.time).getTime() / 1000

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

    chartRefs.current.forEach((chart, index) => {
      if (chart && seriesRefs.current[index]) {
        try {
          if (time !== null) {
            chart.setCrosshairPosition(0, time, seriesRefs.current[index]!)
          } else {
            chart.clearCrosshairPosition()
          }
        } catch (error) {
          console.warn('Failed to set crosshair position:', error)
        }
      }
    })

    setTimeout(() => {
      isUpdatingCursor.current = false
    }, 0)
  }

  // Helper function to create a single chart
  const createSingleChart = (
    container: HTMLDivElement,
    fractalData: FractalData[],
    chartIndex: number
  ): IChartApi => {
    const chart = createChart(container, {
      width,
      height: height * 0.7, // Smaller height to leave room for controls
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
      timeScale: {
        visible: false, // Hide the entire x-axis
      },
      crosshair: {
        mode: 1, // Normal crosshair mode for cursor synchronization
        vertLine: {
          visible: true,
          color: '#758391',
          width: 1,
          style: 0, // Solid line
        },
        horzLine: {
          visible: false, // Hide horizontal price line
        },
      },
      // Disable zoom/scroll but allow crosshair interactions
      handleScroll: false,
      handleScale: false,
    })

    // Create line series for each metric
    const volumeStrengthSeries = chart.addSeries(LineSeries, {
      color: '#4CAF50',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    volumeStrengthSeries.setData(
      convertToChartData(fractalData, 'volumeStrength')
    )

    // Store the first series reference for crosshair synchronization
    seriesRefs.current[chartIndex] = volumeStrengthSeries

    const volumeStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#388E3C',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    volumeStrengthMaSeries.setData(
      convertToChartData(fractalData, 'volumeStrengthMa')
    )

    const priceVolumeStrengthSeries = chart.addSeries(LineSeries, {
      color: '#FF9800',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    priceVolumeStrengthSeries.setData(
      convertToChartData(fractalData, 'priceVolumeStrength')
    )

    const priceVolumeStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#F57C00',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    priceVolumeStrengthMaSeries.setData(
      convertToChartData(fractalData, 'priceVolumeStrengthMa')
    )

    const priceStrengthSeries = chart.addSeries(LineSeries, {
      color: '#2196F3',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    priceStrengthSeries.setData(
      convertToChartData(fractalData, 'priceStrength')
    )

    const priceStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#1976D2',
      lineWidth: 2,
      crosshairMarkerVisible: false, // Hide cursor markers
      priceLineVisible: false, // Hide horizontal price line
      lastValueVisible: false, // Hide last value label
    })
    priceStrengthMaSeries.setData(
      convertToChartData(fractalData, 'priceStrengthMa')
    )

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
        // Load all CSV files in parallel for better performance
        const dataPromises = CHART_CONFIGS.map(async (config, index) => {
          try {
            const data = await parseFractalCSV(config.fileName)
            if (data.length === 0) {
              throw new Error(`No data found in ${config.fileName}`)
            }
            return { index, data, error: null }
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
        const newData = new Array(CHART_CONFIGS.length).fill(null)
        const newErrors = new Array(CHART_CONFIGS.length).fill(null)
        const newLoadingStates = new Array(CHART_CONFIGS.length).fill(false)

        results.forEach((result) => {
          newData[result.index] = result.data
          newErrors[result.index] = result.error
          newLoadingStates[result.index] = false
        })

        setAllChartsData(newData)
        setErrors(newErrors)
        setLoadingStates(newLoadingStates)

        // Set initial time range based on first dataset
        const firstDataset = newData.find((data) => data !== null)
        if (firstDataset) {
          const initialRange = calculateVisibleRange(firstDataset)
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
      const newRange = calculateVisibleRange(firstDataset)
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
    <div className="mx-auto w-full max-w-[600px] overflow-auto">
      {/* Master Controls */}
      <div className="controls-panel">
        {/* <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Time Range: Past{' '}
            {hoursBack >= 24
              ? `${Math.round((hoursBack / 24) * 10) / 10} ${
                  hoursBack === 24 ? 'day' : 'days'
                }`
              : `${hoursBack} hours`}
          </label>
        </div> */}
        <input
          type="range"
          min="4"
          max="80"
          step="1"
          value={hoursBack}
          onChange={(e) => setHoursBack(parseInt(e.target.value))}
          className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        {/* <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>4 hours</span>
          <span>80 hours</span>
        </div> */}
      </div>

      {/* Render all charts stacked vertically */}
      {CHART_CONFIGS.map((config, index) => {
        const isLoading = loadingStates[index]
        const error = errors[index]
        const hasData = allChartsData[index] !== null

        return (
          <div
            key={config.fileName}
            className="fractal-chart relative flex justify-end overflow-x-auto"
            style={{ marginBottom: '-12px' }}
          >
            {/* Chart container */}
            <div
              ref={(el) => {
                chartContainerRefs.current[index] = el
              }}
              style={{ width, height: height * 0.7 }}
              className="border border-gray-200 rounded relative z-10"
            ></div>
            {/* Chart title positioned above chart but overlapping */}
            <div
              style={{ zIndex: 1000, top: 0, left: 0 }}
              className="absolute bg-gray-700 bg-opacity-90 px-2 py-1 rounded shadow-sm pointer-events-none font-bold"
            >
              <h3 className="text-sm font-semibold text-gray-800 leading-tight">
                {config.displayName}
              </h3>

              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                  <div className="text-lg">Loading {config.displayName}...</div>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                  <div className="text-lg text-red-500">Error: {error}</div>
                </div>
              )}
              {!isLoading && !error && !hasData && (
                <div className="absolute inset-0 flex items-center justify-center bg-white rounded">
                  <div className="text-lg text-gray-500">No data available</div>
                </div>
              )}
            </div>
            <div
              style={{
                position: 'absolute',
                backgroundColor: 'white',
                opacity: 1,
                zIndex: 1000,
                bottom: '5px',
                left: 0,
                width: '60px',
                height: '20px',
              }}
            ></div>
          </div>
        )
      })}
    </div>
  )
}
