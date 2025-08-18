'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  IChartApi,
  LineData,
  LineSeries,
} from 'lightweight-charts'
import { FractalData, parseFractalCSV } from '../lib/parseFractalCSV'

interface ChartConfig {
  fileName: string
  displayName: string
  description: string
}

interface FractalChartProps {
  width?: number
  height?: number
}

// Configuration for all CSV files
const CHART_CONFIGS: ChartConfig[] = [
  {
    fileName: '/fractal/ETHUSD-15S.csv',
    displayName: 'ETH/USD 15-Second Chart',
    description: 'Ultra-short term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-30S.csv',
    displayName: 'ETH/USD 30-Second Chart',
    description: 'Very short term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-2.csv',
    displayName: 'ETH/USD 2-Minute Chart',
    description: 'Short term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-6.csv',
    displayName: 'ETH/USD 6-Minute Chart',
    description: 'Medium-short term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-8.csv',
    displayName: 'ETH/USD 8-Minute Chart',
    description: 'Medium term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-30.csv',
    displayName: 'ETH/USD 30-Minute Chart',
    description: 'Medium-long term fractal analysis',
  },
  {
    fileName: '/fractal/ETHUSD-90.csv',
    displayName: 'ETH/USD 90-Minute Chart',
    description: 'Long term fractal analysis',
  },
]

export default function FractalChart({
  width = 800,
  height = 400,
}: FractalChartProps) {
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

  // Initialize refs arrays
  useEffect(() => {
    chartRefs.current = new Array(CHART_CONFIGS.length).fill(null)
    chartContainerRefs.current = new Array(CHART_CONFIGS.length).fill(null)
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

  // Helper function to create a single chart
  const createSingleChart = (
    container: HTMLDivElement,
    fractalData: FractalData[]
  ): IChartApi => {
    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#e1e1e1' },
        horzLines: { color: '#e1e1e1' },
      },
      rightPriceScale: {
        borderColor: '#cccccc',
      },
      timeScale: {
        borderColor: '#cccccc',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    // Create line series for each metric
    const volumeStrengthSeries = chart.addSeries(LineSeries, {
      color: '#2196F3',
      lineWidth: 2,
      title: 'Volume Strength',
    })
    volumeStrengthSeries.setData(
      convertToChartData(fractalData, 'volumeStrength')
    )

    const volumeStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#1976D2',
      lineWidth: 2,
      title: 'Volume Strength MA',
    })
    volumeStrengthMaSeries.setData(
      convertToChartData(fractalData, 'volumeStrengthMa')
    )

    const priceStrengthSeries = chart.addSeries(LineSeries, {
      color: '#FF9800',
      lineWidth: 2,
      title: 'Price Strength',
    })
    priceStrengthSeries.setData(
      convertToChartData(fractalData, 'priceStrength')
    )

    const priceStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#F57C00',
      lineWidth: 2,
      title: 'Price Strength MA',
    })
    priceStrengthMaSeries.setData(
      convertToChartData(fractalData, 'priceStrengthMa')
    )

    const priceVolumeStrengthSeries = chart.addSeries(LineSeries, {
      color: '#4CAF50',
      lineWidth: 2,
      title: 'Price Volume Strength',
    })
    priceVolumeStrengthSeries.setData(
      convertToChartData(fractalData, 'priceVolumeStrength')
    )

    const priceVolumeStrengthMaSeries = chart.addSeries(LineSeries, {
      color: '#388E3C',
      lineWidth: 2,
      title: 'Price Volume Strength MA',
    })
    priceVolumeStrengthMaSeries.setData(
      convertToChartData(fractalData, 'priceVolumeStrengthMa')
    )

    // Fit the chart content
    chart.timeScale().fitContent()

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
              data
            )
            chartRefs.current[index] = chart
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

  // Legend component (shared across all charts)
  // const Legend = () => (
  //   <div className="mb-4 text-sm text-gray-600">
  //     <div className="flex flex-wrap gap-4">
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-blue-500 mr-1"></span>
  //         Volume Strength
  //       </span>
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-blue-700 mr-1"></span>
  //         Volume Strength MA
  //       </span>
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-orange-500 mr-1"></span>
  //         Price Strength
  //       </span>
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-orange-700 mr-1"></span>
  //         Price Strength MA
  //       </span>
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-green-500 mr-1"></span>
  //         Price Volume Strength
  //       </span>
  //       <span>
  //         <span className="inline-block w-3 h-3 bg-green-700 mr-1"></span>
  //         Price Volume Strength MA
  //       </span>
  //     </div>
  //   </div>
  // )

  return (
    <div className="fractal-charts">
      <h1 className="text-3xl font-bold mb-6">
        Fractal Analysis - ETH/USD Multi-Timeframe Charts
      </h1>

      {/* Global legend */}
      {/* <Legend /> */}

      {/* Render all charts stacked vertically */}
      {CHART_CONFIGS.map((config, index) => {
        const isLoading = loadingStates[index]
        const error = errors[index]
        const hasData = allChartsData[index] !== null

        return (
          <div key={config.fileName} className="fractal-chart mb-8">
            <h3 className="text-xl font-semibold mb-2">{config.displayName}</h3>
            <p className="text-sm text-gray-600 mb-4">{config.description}</p>

            <div
              ref={(el) => (chartContainerRefs.current[index] = el)}
              style={{ width, height }}
              className="relative"
            >
              {isLoading && (
                <div className="static inset-0 flex items-center justify-center bg-white border border-gray-200 rounded opacity-0">
                  <div className="text-lg">Loading {config.displayName}...</div>
                </div>
              )}
              {error && (
                <div className="static inset-0 flex items-center justify-center bg-white border border-gray-200 rounded opacity-0">
                  <div className="text-lg text-red-500">Error: {error}</div>
                </div>
              )}
              {!isLoading && !error && !hasData && (
                <div className="static inset-0 flex items-center justify-center bg-white border border-gray-200 rounded opacity-0">
                  <div className="text-lg text-gray-500">No data available</div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
