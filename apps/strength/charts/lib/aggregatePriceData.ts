import { StrengthRowGet } from '@lib/common/sql/strength'
import { LineData, Time } from 'lightweight-charts'
import {
  extractGlobalTimestamps,
  forwardFillData,
  normalizeMultipleTickerData,
  generateFutureTimestamps,
} from './aggregateDataUtils'

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
