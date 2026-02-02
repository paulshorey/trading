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
 * Calculate True Range for a single candle
 * TR = max(High - Low, |High - PreviousClose|, |Low - PreviousClose|)
 * Simplified: TR = max(High, PreviousClose) - min(Low, PreviousClose)
 *
 * True Range captures volatility including gaps from previous close.
 * Developed by J. Welles Wilder Jr.
 */
export function calculateTR(
  current: Candle,
  previousClose: number | null
): number {
  const highLow = current.high - current.low

  if (previousClose === null) {
    // First candle: just use high - low
    return highLow
  }

  const highPrevClose = Math.abs(current.high - previousClose)
  const lowPrevClose = Math.abs(current.low - previousClose)

  return Math.max(highLow, highPrevClose, lowPrevClose)
}

/**
 * Calculate Exponential Moving Average for a series of values
 * EMA_t = (Value_t × α) + (EMA_(t-1) × (1 - α))
 * where α = 2 / (period + 1)
 *
 * First EMA value is initialized with Simple Moving Average of first N values.
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period) {
    return []
  }

  const result: number[] = []
  const alpha = 2 / (period + 1)

  // Calculate initial SMA for the first EMA value
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += values[i] ?? 0
  }
  let ema = sum / period

  // First EMA value at index (period - 1)
  result.push(ema)

  // Calculate subsequent EMA values
  for (let i = period; i < values.length; i++) {
    const value = values[i] ?? 0
    ema = value * alpha + ema * (1 - alpha)
    result.push(ema)
  }

  return result
}

/**
 * Calculate Average True Range (ATR) using EMA smoothing
 * ATR is the exponential moving average of True Range values.
 *
 * @param candles - Array of candle data
 * @param period - EMA period (default 14, standard for ATR)
 * @returns Array of time/value pairs for charting
 */
export function calculateATR(
  candles: Candle[],
  period: number = 14
): IndicatorOutput {
  if (candles.length < period + 1) {
    return []
  }

  // Calculate True Range for each candle
  const trValues: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i]
    const previous = candles[i - 1]
    if (current) {
      const tr = calculateTR(current, previous?.close ?? null)
      trValues.push(tr)
    }
  }

  // Apply EMA to True Range values
  const atrValues = calculateEMA(trValues, period)

  // Map to output format (offset by period since EMA starts at index period-1)
  const result: IndicatorOutput = []
  for (let i = 0; i < atrValues.length; i++) {
    const candleIndex = i + period - 1
    const candle = candles[candleIndex]
    const atr = atrValues[i]
    if (candle && atr !== undefined) {
      result.push({
        time: (candle.time / 1000) as Time,
        value: atr,
      })
    }
  }

  return result
}
