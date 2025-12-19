import { StrengthRowGet } from '@lib/common/sql/strength'
import { LineData, Time } from 'lightweight-charts'
import {
  extractGlobalTimestamps,
  forwardFillData,
  normalizeMultipleTickerData,
  generateFutureTimestamps,
} from './aggregateDataUtils'
import { TickerPriceData } from '../state/useChartControlsStore'

/**
 * Aggregate price data from all tickers with normalization
 * Creates a single chart data series that averages normalized price values from all tickers
 * Each ticker is normalized to contribute equally regardless of its absolute price level
 * Uses the new utility functions for interpolation and normalization
 */
export const aggregatePriceData = (
  allRawData: (StrengthRowGet[] | null)[],
  allMarketData?: (StrengthRowGet[] | null)[] // Optional: all market data for consistent timestamps
): LineData[] => {
  // Step 1: Extract all timestamps from ALL market data to ensure consistency
  // This prevents issues when switching between Average and individual tickers
  const dataForTimestamps = allMarketData || allRawData
  const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)

  if (sortedTimestamps.length === 0) {
    return []
  }

  // Step 2: Process each ticker with forward-fill interpolation
  const processedTickers: {
    filledPrices: Map<number, number>
    lastValidPrice: number
    hasAnyData: boolean
  }[] = []

  let tickersWithData = 0
  let totalDataPoints = 0

  allRawData.forEach((tickerData) => {
    const filledPrices = new Map<number, number>()
    let hasAnyValidData = false
    let lastKnownPrice = 0

    if (!tickerData || tickerData.length === 0) {
      processedTickers.push({
        filledPrices,
        lastValidPrice: 0,
        hasAnyData: false,
      })
      return
    }

    // Convert ticker data to timestamp/value pairs for interpolation
    const tickerPrices = tickerData
      .map((item) => ({
        timestamp: new Date(item.timenow).getTime() / 1000,
        value:
          item.price !== null &&
          item.price !== undefined &&
          item.price !== 0 &&
          Number.isFinite(item.price)
            ? item.price
            : undefined,
      }))
      .filter((item) => item.value !== undefined) as Array<{
      timestamp: number
      value: number
    }>

    if (tickerPrices.length > 0) {
      hasAnyValidData = true
      lastKnownPrice = tickerPrices[tickerPrices.length - 1]!.value
      tickersWithData++
      totalDataPoints += tickerPrices.length

      // Apply forward-fill interpolation using the utility function
      const interpolatedPrices = forwardFillData(tickerPrices, sortedTimestamps)

      // Get the last filled price for normalization
      const lastFilledPrice = interpolatedPrices.get(
        sortedTimestamps[sortedTimestamps.length - 1]!
      )

      processedTickers.push({
        filledPrices: interpolatedPrices,
        lastValidPrice: lastFilledPrice || lastKnownPrice,
        hasAnyData: hasAnyValidData,
      })
    } else {
      processedTickers.push({
        filledPrices,
        lastValidPrice: 0,
        hasAnyData: false,
      })
    }
  })

  // Step 3: Use the normalization utility
  const normalizedResult = normalizeMultipleTickerData(
    processedTickers,
    sortedTimestamps
  )

  // Convert to LineData format - ensure we create new objects
  const lineData = normalizedResult.map((point) => ({
    time: point.time as Time,
    value: point.value,
  }))

  // Extend data 12 hours into the future with the last known value
  if (lineData.length > 0) {
    const lastDataPoint = lineData[lineData.length - 1]!
    const lastTimestamp = lastDataPoint.time as number
    const lastValue = lastDataPoint.value

    // Generate future timestamps (12 hours at 1-minute intervals)
    const futureTimestamps = generateFutureTimestamps(lastTimestamp, 12)

    // Add future data points with the last known value
    futureTimestamps.forEach((timestamp) => {
      lineData.push({
        time: timestamp as Time,
        value: lastValue,
      })
    })
  }

  return lineData
}

/**
 * Aggregate price data for each individual ticker separately
 * Creates a LineData array for each ticker, normalized to the same scale
 * Uses forward-fill interpolation to handle missing values
 *
 * Each ticker's price is normalized relative to its last price = 1.0,
 * then scaled by the average of all tickers' last prices to maintain
 * a meaningful price range that matches the aggregated price line.
 *
 * @param allRawData - Raw data from all tickers (array in same order as tickers)
 * @param tickers - Array of ticker symbols
 * @param allMarketData - Optional: all market data for consistent timestamps
 * @returns Object mapping ticker -> LineData[] for each ticker
 */
export const aggregatePriceByTicker = (
  allRawData: (StrengthRowGet[] | null)[],
  tickers: string[],
  allMarketData?: (StrengthRowGet[] | null)[]
): TickerPriceData => {
  // Extract all unique timestamps from ALL market data to ensure consistency
  const dataForTimestamps = allMarketData || allRawData
  const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)

  if (sortedTimestamps.length === 0) {
    return {}
  }

  const result: TickerPriceData = {}

  // First pass: Calculate the last valid price for each ticker for normalization
  const tickerLastPrices: number[] = []

  allRawData.forEach((tickerData) => {
    if (!tickerData || tickerData.length === 0) {
      tickerLastPrices.push(0)
      return
    }

    // Find the last valid price
    let lastPrice = 0
    for (let i = tickerData.length - 1; i >= 0; i--) {
      const price = tickerData[i]?.price
      if (
        price !== null &&
        price !== undefined &&
        price !== 0 &&
        Number.isFinite(price)
      ) {
        lastPrice = price
        break
      }
    }
    tickerLastPrices.push(lastPrice)
  })

  // Calculate average of all last prices for scaling
  const validLastPrices = tickerLastPrices.filter((p) => p > 0)
  const avgLastPrice =
    validLastPrices.length > 0
      ? validLastPrices.reduce((sum, p) => sum + p, 0) / validLastPrices.length
      : 1

  // Second pass: Process each ticker
  allRawData.forEach((tickerData, index) => {
    const ticker = tickers[index]
    if (!ticker) return

    if (!tickerData || tickerData.length === 0) {
      return
    }

    // Convert ticker data to timestamp/value pairs for interpolation
    const tickerPrices = tickerData
      .map((item) => ({
        timestamp: new Date(item.timenow).getTime() / 1000,
        value:
          item.price !== null &&
          item.price !== undefined &&
          item.price !== 0 &&
          Number.isFinite(item.price)
            ? item.price
            : undefined,
      }))
      .filter((item) => item.value !== undefined) as Array<{
      timestamp: number
      value: number
    }>

    if (tickerPrices.length === 0) {
      return
    }

    // Apply forward-fill interpolation
    const interpolatedPrices = forwardFillData(tickerPrices, sortedTimestamps)

    // Normalize this ticker's prices
    const lastPrice = tickerLastPrices[index] || 1
    const normalizationFactor = lastPrice > 0 ? 1 / lastPrice : 0

    // Convert to LineData format with normalization
    const lineData: LineData[] = []
    interpolatedPrices.forEach((price, timestamp) => {
      // Normalize relative to last price, then scale by average
      const normalizedPrice = price * normalizationFactor * avgLastPrice
      lineData.push({
        time: timestamp as Time,
        value: normalizedPrice,
      })
    })

    // Sort by time
    lineData.sort((a, b) => (a.time as number) - (b.time as number))

    // Extend data 12 hours into the future with the last known value
    if (lineData.length > 0) {
      const lastDataPoint = lineData[lineData.length - 1]!
      const lastTimestamp = lastDataPoint.time as number
      const lastValue = lastDataPoint.value

      // Generate future timestamps (12 hours at 1-minute intervals)
      const futureTimestamps = generateFutureTimestamps(lastTimestamp, 12)

      // Add future data points with the last known value
      futureTimestamps.forEach((timestamp) => {
        lineData.push({
          time: timestamp as Time,
          value: lastValue,
        })
      })
    }

    // Only add if we have data
    if (lineData.length > 0) {
      result[ticker] = lineData
    }
  })

  return result
}
