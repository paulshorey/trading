import { estimateDataInterval } from './estimateDataInterval'

describe('estimateDataInterval', () => {
  it('returns default interval when data has less than 2 points', () => {
    expect(estimateDataInterval([])).toBe(60000)
    expect(estimateDataInterval([[1000, 100, 110, 90, 105]])).toBe(60000)
  })

  it('calculates interval from two data points', () => {
    const data = [
      [1000, 100, 110, 90, 105], // timestamp 1000
      [2000, 101, 111, 91, 106], // timestamp 2000, interval = 1000
    ]
    expect(estimateDataInterval(data)).toBe(1000)
  })

  it('returns median interval to handle gaps', () => {
    // Data with a weekend gap (3 days instead of 1 day)
    const oneDay = 86400000 // 1 day in ms
    const data = [
      [1000000, 100, 110, 90, 105], // Day 1
      [1000000 + oneDay, 101, 111, 91, 106], // Day 2 (1 day gap)
      [1000000 + 2 * oneDay, 102, 112, 92, 107], // Day 3 (1 day gap)
      [1000000 + 5 * oneDay, 103, 113, 93, 108], // Day 6 (3 day gap - weekend)
      [1000000 + 6 * oneDay, 104, 114, 94, 109], // Day 7 (1 day gap)
    ]
    // Intervals: [1day, 1day, 3days, 1day] -> sorted: [1day, 1day, 1day, 3days]
    // Median index: floor(4/2) = 2 -> 1 day
    expect(estimateDataInterval(data)).toBe(oneDay)
  })

  it('handles minute-level data', () => {
    const oneMinute = 60000
    const data = [
      [1000000, 100, 110, 90, 105],
      [1000000 + oneMinute, 101, 111, 91, 106],
      [1000000 + 2 * oneMinute, 102, 112, 92, 107],
      [1000000 + 3 * oneMinute, 103, 113, 93, 108],
    ]
    expect(estimateDataInterval(data)).toBe(oneMinute)
  })

  it('only samples up to specified sample size', () => {
    // Create data with 200 points, but only sample first 10
    const data: number[][] = []
    for (let i = 0; i < 200; i++) {
      data.push([i * 1000, 100 + i, 110 + i, 90 + i, 105 + i])
    }
    // With sampleSize=10, we only look at first 10 points (9 intervals)
    expect(estimateDataInterval(data, 10)).toBe(1000)
  })

  it('uses custom default interval when specified', () => {
    expect(estimateDataInterval([], 100, 30000)).toBe(30000)
    expect(estimateDataInterval([[1000, 100, 110, 90, 105]], 100, 30000)).toBe(
      30000
    )
  })

  it('handles malformed data gracefully', () => {
    // Data with missing timestamps
    const data: number[][] = [
      [1000, 100, 110, 90, 105],
      [], // Empty array
      [3000, 102, 112, 92, 107],
    ]
    // Should skip invalid entries and still calculate
    expect(estimateDataInterval(data)).toBe(60000) // Falls back because can't get valid intervals
  })

  it('handles single valid interval among invalid data', () => {
    const data: number[][] = [
      [1000, 100, 110, 90, 105],
      [2000, 101, 111, 91, 106],
      [], // Invalid
      [], // Invalid
    ]
    // Only one valid interval (1000)
    expect(estimateDataInterval(data)).toBe(1000)
  })
})
