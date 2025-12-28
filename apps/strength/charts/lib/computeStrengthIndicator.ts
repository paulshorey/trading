import { LineData, Time } from 'lightweight-charts'

/**
 * Compute the strength indicator from strength average data
 *
 * This is the main entry point for indicator computation.
 * Expand this function to add more sophisticated indicator logic.
 *
 * @param strengthAverage - The aggregated strength average data
 * @returns The computed indicator series
 */
export function computeStrengthIndicator(
  strengthAverage: LineData<Time>[] | null
): LineData<Time>[] | null {
  // Currently uses a 20-period simple moving average
  // TODO: Expand with more sophisticated indicator logic
  return movingAverage(strengthAverage, 20)
}

/**
 * Compute a Simple Moving Average (SMA) from LineData
 *
 * @param data - The source data (e.g., strengthAverage)
 * @param period - Number of data points to average over
 * @returns Moving average data with same time points
 */
function movingAverage(
  data: LineData<Time>[] | null,
  period: number
): LineData<Time>[] | null {
  if (!data || data.length === 0) return null

  const result: LineData<Time>[] = []

  for (let i = 0; i < data.length; i++) {
    // Calculate SMA for this point
    const start = Math.max(0, i - period + 1)
    const window = data.slice(start, i + 1)
    const sum = window.reduce((acc, d) => acc + d.value, 0)
    const avg = sum / window.length

    result.push({
      time: data[i]!.time,
      value: avg,
    })
  }

  return result
}
