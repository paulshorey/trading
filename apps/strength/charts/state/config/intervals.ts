/**
 * Interval configuration for strength data aggregation
 * Intervals represent different time periods for calculating momentum/strength
 */

/**
 * All available strength interval values (in minutes)
 */
export const strengthIntervals = ['2', '4', '12', '30', '60', '240'] as const

export type StrengthInterval = (typeof strengthIntervals)[number]

export interface IntervalOption {
  value: string[]
  label: string
}

/**
 * Available interval configurations for strength data aggregation
 * Each option represents a set of intervals to average together
 */
export const intervalsOptions: IntervalOption[] = [
  { value: [...strengthIntervals], label: 'all' },
  { value: ['12', '30', '60', '240'], label: 'long' },
  { value: ['2', '4', '12'], label: 'short' },
  { value: ['2'], label: '2m' },
  { value: ['4'], label: '4m' },
  { value: ['12'], label: '12m' },
  { value: ['30'], label: '30m' },
  { value: ['60'], label: '1h' },
  { value: ['240'], label: '4h' },
]

/**
 * Get default interval selection (all intervals)
 */
export const getDefaultInterval = (): string[] => {
  return intervalsOptions[0]!.value
}
