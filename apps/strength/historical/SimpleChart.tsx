'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineData,
  LineSeries,
  Time,
  LogicalRange,
} from 'lightweight-charts'

// Configuration
const LAZY_LOAD_BARS_THRESHOLD = 50 // Load more when fewer than 50 bars before visible area
const LAZY_LOAD_FETCH_MINUTES = 120 // Fetch 2 hours of data per load
const INITIAL_FETCH_HOURS = 24 // Initial load: 24 hours of data

interface SimpleChartProps {
  ticker: string
}

/**
 * SimpleChart - A minimal chart implementation demonstrating lazy loading
 * 
 * Features:
 * - Fetches initial historical data on mount
 * - Detects when user scrolls near the beginning of data
 * - Loads more historical data (prepending to existing data)
 * - Preserves scroll position when new data is loaded
 * 
 * NO real-time updates, NO aggregation, NO complex state management
 */
export function SimpleChart({ ticker }: SimpleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  
  // Data state
  const [data, setData] = useState<LineData<Time>[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Track earliest timestamp for lazy loading
  const earliestTimeRef = useRef<number | null>(null)
  
  // Track previous data for detecting prepends
  const prevDataRef = useRef<LineData<Time>[]>([])
  
  // Track if we're currently in a lazy load to prevent scroll position restoration from failing
  const isLazyLoadingRef = useRef(false)

  /**
   * Fetch data from API
   */
  const fetchData = useCallback(async (fromDate: Date, toDate: Date): Promise<LineData<Time>[]> => {
    const params = new URLSearchParams({
      ticker,
      timenow_gt: fromDate.toISOString(),
      timenow_lt: toDate.toISOString(),
    })
    
    const response = await fetch(`/api/v1/strength?${params}`)
    const json = await response.json()
    
    if (json.error) {
      throw new Error(json.error)
    }
    
    if (!json.rows || json.rows.length === 0) {
      return []
    }
    
    // Convert to LineData format
    // Use 'price' field for the chart value
    return json.rows
      .map((row: { timenow: string; price: number }) => ({
        time: Math.floor(new Date(row.timenow).getTime() / 1000) as Time,
        value: row.price,
      }))
      .filter((d: LineData<Time>) => d.value != null && d.value > 0)
      .sort((a: LineData<Time>, b: LineData<Time>) => (a.time as number) - (b.time as number))
  }, [ticker])

  /**
   * Load initial data
   */
  const loadInitialData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const toDate = new Date()
      const fromDate = new Date(toDate.getTime() - INITIAL_FETCH_HOURS * 60 * 60 * 1000)
      
      const initialData = await fetchData(fromDate, toDate)
      
      if (initialData.length > 0) {
        earliestTimeRef.current = initialData[0]!.time as number
        setData(initialData)
      } else {
        setError('No data available for this ticker')
      }
    } catch (err) {
      console.error('[SimpleChart] Error loading initial data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [fetchData])

  /**
   * Load more historical data (for lazy loading)
   */
  const loadMoreHistory = useCallback(async () => {
    if (isLoadingMore || !earliestTimeRef.current) {
      return
    }
    
    setIsLoadingMore(true)
    isLazyLoadingRef.current = true
    
    try {
      const toDate = new Date(earliestTimeRef.current * 1000)
      const fromDate = new Date(toDate.getTime() - LAZY_LOAD_FETCH_MINUTES * 60 * 1000)
      
      const historicalData = await fetchData(fromDate, toDate)
      
      if (historicalData.length > 0) {
        // Update earliest time
        earliestTimeRef.current = historicalData[0]!.time as number
        
        // Prepend historical data to existing data
        setData(prevData => {
          // Merge and deduplicate by timestamp
          const dataMap = new Map<number, LineData<Time>>()
          
          // Add historical data first
          for (const point of historicalData) {
            dataMap.set(point.time as number, point)
          }
          
          // Add existing data (will overwrite if same timestamp)
          for (const point of prevData) {
            dataMap.set(point.time as number, point)
          }
          
          // Sort by time
          const merged = Array.from(dataMap.values()).sort(
            (a, b) => (a.time as number) - (b.time as number)
          )
          
          return merged
        })
      }
    } catch (err) {
      console.error('[SimpleChart] Error loading more history:', err)
    } finally {
      setIsLoadingMore(false)
      // Keep isLazyLoadingRef true until the chart update effect runs
    }
  }, [fetchData, isLoadingMore])

  /**
   * Initialize chart
   */
  useEffect(() => {
    if (!containerRef.current) return
    
    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#C3BCDB',
      },
      grid: {
        vertLines: { color: '#333344' },
        horzLines: { color: '#333344' },
      },
      timeScale: {
        borderColor: '#333344',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#333344',
      },
    })
    chartRef.current = chart
    
    // Create line series (v5 API)
    const series = chart.addSeries(LineSeries, {
      color: '#5B8DEF',
      lineWidth: 2,
      priceScaleId: 'right',
    })
    seriesRef.current = series
    
    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    
    // Load initial data
    loadInitialData()
    
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, []) // Only on mount - loadInitialData is stable

  /**
   * Update chart data and handle scroll position preservation
   */
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || data.length === 0) return
    
    const series = seriesRef.current
    const chart = chartRef.current
    const prevData = prevDataRef.current
    
    // Check if this is a lazy load (prepending historical data)
    // We need to save the visible range BEFORE updating the data
    let savedLogicalRange: LogicalRange | null = null
    let prependedCount = 0
    
    if (isLazyLoadingRef.current && prevData.length > 0) {
      // Save current visible logical range
      savedLogicalRange = chart.timeScale().getVisibleLogicalRange()
      
      // Calculate how many bars were prepended by comparing timestamps
      const oldFirstTime = prevData[0]?.time as number
      const newFirstTime = data[0]?.time as number
      
      if (newFirstTime < oldFirstTime) {
        // Find where the old first time appears in the new data
        const oldFirstIndex = data.findIndex(d => (d.time as number) >= oldFirstTime)
        if (oldFirstIndex > 0) {
          prependedCount = oldFirstIndex
        }
      }
      
    }
    
    // Update the series data
    series.setData(data)
    
    // Update previous data ref for next comparison
    prevDataRef.current = data
    
    // Restore scroll position if this was a lazy load
    if (isLazyLoadingRef.current && savedLogicalRange && prependedCount > 0) {
      // Use requestAnimationFrame to ensure the chart has processed the new data
      requestAnimationFrame(() => {
        if (chartRef.current && savedLogicalRange) {
          try {
            // Offset the logical range by the number of prepended bars
            const newRange = {
              from: savedLogicalRange.from + prependedCount,
              to: savedLogicalRange.to + prependedCount,
            }
            
            chartRef.current.timeScale().setVisibleLogicalRange(newRange)
          } catch {
            // Scroll position restoration failed - not critical
          }
        }
        
        // Mark lazy loading as complete
        isLazyLoadingRef.current = false
      })
    } else {
      isLazyLoadingRef.current = false
    }
  }, [data])

  /**
   * Subscribe to visible range changes for lazy loading detection
   */
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || data.length === 0) return
    
    const chart = chartRef.current
    const series = seriesRef.current
    
    const handleVisibleLogicalRangeChange = (logicalRange: LogicalRange | null) => {
      if (!logicalRange) return
      
      // Don't trigger lazy load while we're already loading
      if (isLazyLoadingRef.current || isLoadingMore) return
      
      // Get bars info to check how many bars are before the visible area
      const barsInfo = series.barsInLogicalRange(logicalRange)
      if (!barsInfo) return
      
      // If fewer than threshold bars before visible area, load more
      if (barsInfo.barsBefore !== null && barsInfo.barsBefore < LAZY_LOAD_BARS_THRESHOLD) {
        loadMoreHistory()
      }
    }
    
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange)
    
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange)
    }
  }, [data.length, isLoadingMore, loadMoreHistory])

  return (
    <div className="w-full">
      {/* Header */}
      <div className="p-4 bg-[#1a1a2e] border-b border-[#333344]">
        <h1 className="text-xl font-bold text-white mb-2">
          Simple Historical Chart - {ticker}
        </h1>
        <p className="text-sm text-gray-400">
          Scroll left to load more historical data. The view position will be preserved.
        </p>
        <div className="mt-2 text-xs text-gray-500">
          Data points: {data.length} | 
          Loading: {isLoading ? 'Initial...' : isLoadingMore ? 'More history...' : 'No'}
        </div>
      </div>
      
      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-900/20 text-red-400 text-center">
          {error}
        </div>
      )}
      
      {/* Loading state */}
      {isLoading && (
        <div className="p-4 bg-[#1a1a2e] text-gray-400 text-center">
          Loading initial data...
        </div>
      )}
      
      {/* Chart container */}
      <div 
        ref={containerRef} 
        className="w-full bg-[#1a1a2e]"
        style={{ minHeight: '500px' }}
      />
      
      {/* Loading overlay - shown while fetching additional historical data */}
      {isLoadingMore && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
          style={{ cursor: 'wait' }}
        >
          <div className="flex flex-col items-center gap-3">
            {/* Spinner */}
            <div className="w-10 h-10 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm text-gray-300 bg-black/50 px-3 py-1 rounded">
              Loading history...
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
