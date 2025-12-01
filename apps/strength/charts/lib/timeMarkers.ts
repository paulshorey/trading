/**
 * Time Markers Configuration
 *
 * Defines vertical line markers to display on the chart at specific times.
 * All times are stored in UTC to avoid timezone issues.
 * The chart will display them in the user's local timezone.
 */

import { VerticalLineOptions } from './VerticalLinePrimitive'
import { TimeRangeConfig } from './TimeRangeHighlight'

export interface TimeMarkerConfig {
  /** Unique identifier for the marker */
  id: string
  /** Label text displayed on the marker */
  label: string
  /** Hour in UTC (0-23) */
  utcHour: number
  /** Minute in UTC (0-59) */
  utcMinute: number
  /** Color of the vertical line */
  color: string
  /** Background color of the label */
  labelBackgroundColor: string
  /** Text color of the label */
  labelTextColor: string
  /** Line style: 'solid' or 'dashed' */
  lineStyle: 'solid' | 'dashed'
  /** Line width in pixels */
  width: number
  /** Whether to show the label */
  showLabel: boolean
}

/**
 * Configured time markers
 *
 * Add new markers here. Times are in UTC.
 * Examples:
 * - 23:00 UTC = 17:00 US Central (CST) / 18:00 US Central (CDT)
 * - 14:30 UTC = 08:30 US Central (CST) / 09:30 US Central (CDT)
 */
export const TIME_MARKERS: TimeMarkerConfig[] = [
  {
    id: '11am-cst',
    label: '11am CST',
    utcHour: 17,
    utcMinute: 0,
    color: '#22c55e', // green
    labelBackgroundColor: '#22c55e',
    labelTextColor: 'white',
    lineStyle: 'dashed',
    width: 1,
    showLabel: false,
  },
  // {
  //   id: 'us-equities-open',
  //   label: 'US Equities Open',
  //   utcHour: 14,
  //   utcMinute: 30,
  //   color: '#22c55e', // green
  //   labelBackgroundColor: '#22c55e',
  //   labelTextColor: 'white',
  //   lineStyle: 'dashed',
  //   width: 1,
  //   showLabel: true,
  // },
  // {
  //   id: 'us-futures-open',
  //   label: 'US Futures Open',
  //   utcHour: 23,
  //   utcMinute: 0,
  //   color: '#ef4444', // red
  //   labelBackgroundColor: '#ef4444',
  //   labelTextColor: 'white',
  //   lineStyle: 'dashed',
  //   width: 1,
  //   showLabel: true,
  // },
]

/**
 * Time Range Highlights Configuration
 *
 * Defines shaded time ranges to display on the chart.
 * For example, to highlight market hours vs. overnight sessions.
 * Times are in UTC.
 */
export const TIME_RANGE_HIGHLIGHTS: TimeRangeConfig[] = [
  {
    id: 'us-equities',
    startUtcHour: 14, // 8 Central
    startUtcMinute: 0,
    endUtcHour: 21, // 15 Central
    endUtcMinute: 0,
    color: 'rgba(34, 197, 94, 0.08)', // Green
  },
  {
    id: 'asia-until-europe',
    startUtcHour: 2, // 20 Central (previous day)
    startUtcMinute: 0,
    endUtcHour: 9, // 3 Central
    endUtcMinute: 0,
    color: 'rgba(200, 100, 0, 0.08)', // Yellow
  },
]

/**
 * Convert a UTC time to a Unix timestamp for today (or the most recent occurrence)
 * that falls within the chart's data range.
 *
 * @param utcHour - Hour in UTC (0-23)
 * @param utcMinute - Minute in UTC (0-59)
 * @param dataStartTime - Start time of chart data (Unix timestamp)
 * @param dataEndTime - End time of chart data (Unix timestamp)
 * @returns Array of Unix timestamps for each occurrence within the data range
 */
export function getMarkerTimestamps(
  utcHour: number,
  utcMinute: number,
  dataStartTime: number,
  dataEndTime: number
): number[] {
  const timestamps: number[] = []

  // Start from the data start time and find all occurrences
  const startDate = new Date(dataStartTime * 1000)
  const endDate = new Date(dataEndTime * 1000)

  // Set to the target UTC time on the start date
  const markerDate = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
      utcHour,
      utcMinute,
      0,
      0
    )
  )

  // If the marker time is before the start date, move to next day
  if (markerDate.getTime() < startDate.getTime()) {
    markerDate.setUTCDate(markerDate.getUTCDate() + 1)
  }

  // Find all occurrences within the data range
  while (markerDate.getTime() <= endDate.getTime()) {
    timestamps.push(Math.floor(markerDate.getTime() / 1000))
    markerDate.setUTCDate(markerDate.getUTCDate() + 1)
  }

  return timestamps
}

/**
 * Convert TimeMarkerConfig to VerticalLineOptions
 */
export function markerConfigToOptions(
  config: TimeMarkerConfig
): Omit<VerticalLineOptions, 'labelText'> & { labelText: string } {
  return {
    color: config.color,
    width: config.width,
    labelText: config.label,
    labelBackgroundColor: config.labelBackgroundColor,
    labelTextColor: config.labelTextColor,
    showLabel: config.showLabel,
    lineStyle: config.lineStyle,
  }
}
