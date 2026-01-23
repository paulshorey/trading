/**
 * Estimate the data interval from an array of OHLC data points.
 * Returns the median interval between consecutive points, which handles
 * gaps like weekends and holidays better than using the mean.
 *
 * @param data - Array of OHLC data in format [[timestamp, open, high, low, close], ...]
 * @param sampleSize - Maximum number of points to sample (default: 100)
 * @param defaultInterval - Default interval in ms if cannot be calculated (default: 60000 = 1 minute)
 * @returns The estimated interval in milliseconds
 */
export function estimateDataInterval(
  data: number[][],
  sampleSize = 100,
  defaultInterval = 60000
): number {
  if (data.length < 2) return defaultInterval

  const intervals: number[] = []
  const limit = Math.min(data.length, sampleSize)

  for (let i = 1; i < limit; i++) {
    const current = data[i]
    const previous = data[i - 1]
    const currentTimestamp = current?.[0]
    const previousTimestamp = previous?.[0]

    if (
      typeof currentTimestamp === 'number' &&
      typeof previousTimestamp === 'number'
    ) {
      intervals.push(currentTimestamp - previousTimestamp)
    }
  }

  if (intervals.length === 0) return defaultInterval

  // Return the median interval to handle gaps (weekends, holidays)
  intervals.sort((a, b) => a - b)
  const medianIndex = Math.floor(intervals.length / 2)
  return intervals[medianIndex] ?? defaultInterval
}
