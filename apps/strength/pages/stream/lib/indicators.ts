import { Time } from 'lightweight-charts'
import type { Candle } from '@/lib/market-data/candles'
import { RSI_PERIOD } from '../plot/constants'

export type IndicatorOutput = { time: Time; value: number }[]

/**
 * Convert a value using power transformation for moderate compression
 * Exponent controls compression: 1.0 = linear, 0.5 = sqrt, lower = more compression
 * Returns 0 for values <= 0 to handle edge cases
 */
export function toLogScale(value: number, exponent: number = 0.5): number {
  if (value <= 0) return 0
  // return Math.log10(value)
  return Math.pow(value, exponent)
}

/**
 * Calculate RSI (Relative Strength Index) for a given period
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over the period
 */
export function calculateRSI(
  candles: Candle[],
  period: number = RSI_PERIOD,
  property: keyof Candle = 'close'
): IndicatorOutput {
  if (candles.length < period + 1) {
    return []
  }

  const result: IndicatorOutput = []

  // Calculate price changes
  const changes: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i]
    const previous = candles[i - 1]
    if (current && previous) {
      changes.push(current[property] - previous[property])
    }
  }

  // Calculate initial average gain and loss using SMA
  let avgGain = 0
  let avgLoss = 0

  for (let i = 0; i < period; i++) {
    const change = changes[i]
    if (change !== undefined) {
      if (change > 0) {
        avgGain += change
      } else {
        avgLoss += Math.abs(change)
      }
    }
  }

  avgGain /= period
  avgLoss /= period

  // First RSI value
  // Handle edge cases: flat market (no gains/losses) = 50, all gains = 100
  const firstRSI =
    avgGain === 0 && avgLoss === 0
      ? 50 // Neutral when no price movement
      : avgLoss === 0
        ? 100 // All gains, no losses = extreme overbought
        : 100 - 100 / (1 + avgGain / avgLoss)

  const firstCandle = candles[period]
  if (firstCandle) {
    result.push({
      time: (firstCandle.time / 1000) as Time,
      value: firstRSI,
    })
  }

  // Calculate subsequent RSI values using smoothed moving average (Wilder's smoothing)
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]
    if (change === undefined) continue

    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    // Wilder's smoothing: avgGain = (prevAvgGain * (period - 1) + currentGain) / period
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    // Handle edge cases: flat market (no gains/losses) = 50, all gains = 100
    const rsi =
      avgGain === 0 && avgLoss === 0
        ? 50 // Neutral when no price movement
        : avgLoss === 0
          ? 100 // All gains, no losses = extreme overbought
          : 100 - 100 / (1 + avgGain / avgLoss)

    const candle = candles[i + 1]
    if (candle) {
      result.push({
        time: (candle.time / 1000) as Time,
        value: rsi,
      })
    }
  }

  return result
}

/**
 * Detect absorption points where all conditions are met:
 * Returns timestamps of candles that meet all criteria
 */
export function detectAbsorptionPoints(candles: Candle[]): number[] {
  const absorptionTimestamps: number[] = []

  for (const candle of candles) {
    const hasSpreadData = candle.spread_bps_close != null
    const hasBigTrades = candle.big_trades > 0

    // Price movement divergence
    const hasPriceDivergence = Math.abs(candle.close - candle.open) > 0

    // All conditions are met:
    if (hasPriceDivergence && hasSpreadData && hasBigTrades) {
      absorptionTimestamps.push(candle.time)
    }
  }

  return absorptionTimestamps
}

/**
 * Format time for chart display
 */
export function timeFormatter(time: Time) {
  const date = new Date((time as number) * 1000)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString()
  const day = date.getDate().toString()
  return `${month}/${day} ${hours}:${minutes}`
}
