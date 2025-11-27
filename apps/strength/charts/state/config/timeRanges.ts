/**
 * Time range configuration for historical data display
 */

/**
 * Available time range options for historical data
 * Format: number + 'h' suffix (e.g., '24h', '48h')
 */
export const hoursBackOptions = ['120h', '96h', '72h', '48h', '24h'] as const

export type HoursBackOption = (typeof hoursBackOptions)[number]

/**
 * Get default hours back selection (48h - second to last option)
 */
export const getDefaultHoursBack = (): string => {
  return hoursBackOptions[hoursBackOptions.length - 2]!
}

/**
 * Parse hours from option string (e.g., '24h' -> 24)
 */
export const parseHoursBack = (option: string): number => {
  return parseInt(option.replace('h', ''), 10)
}
