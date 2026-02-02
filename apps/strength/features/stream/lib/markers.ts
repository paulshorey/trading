import { Candle } from '@/lib/market-data/candles'

/**
 * Detect absorption points where all conditions are met:
 * Returns timestamps of candles that meet all criteria
 * Used in usePlotData.ts
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
