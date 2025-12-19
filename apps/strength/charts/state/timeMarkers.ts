const COLOR_ASIA_SESSION = 'rgba(0,0,0,0.05)'
const COLOR_ASIA_SESSION2 = 'rgba(0,0,0,0.1)'
const COLOR_US_SESSION = 'rgba(0,0,0,0.05)'
const COLOR_US_SESSION2 = 'rgba(0,0,0,0.1)'

/**
 * Time Markers Configuration
 *
 * Defines vertical line markers to display on the chart at specific times.
 * All times are stored in UTC to avoid timezone issues.
 * The chart will display them in the user's local timezone.
 */

import { VerticalLineOptions } from '../lib/VerticalLinePrimitive'
import { TimeRangeConfig } from '../lib/TimeRangeHighlight'

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
  lineStyle: 'solid' | 'dashed' | 'dotted'
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
    id: '6-cst',
    label: '6 CST',
    utcHour: 12,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '7-cst',
    label: '7 CST',
    utcHour: 13,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '9-cst',
    label: '9 CST',
    utcHour: 15,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '10-cst',
    label: '10 CST',
    utcHour: 16,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '11-cst',
    label: '11 CST',
    utcHour: 17,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '12-cst',
    label: '12 CST',
    utcHour: 18,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '13-cst',
    label: '13 CST',
    utcHour: 19,
    utcMinute: 0,
    color: COLOR_US_SESSION2,
    labelBackgroundColor: COLOR_US_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '18-cst',
    label: '18 CST',
    utcHour: 0,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '19-cst',
    label: '19 CST',
    utcHour: 1,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '21-cst',
    label: '21 CST',
    utcHour: 3,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '22-cst',
    label: '22 CST',
    utcHour: 4,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '23-cst',
    label: '23 CST',
    utcHour: 5,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    id: '24-cst',
    label: '24 CST',
    utcHour: 6,
    utcMinute: 0,
    color: COLOR_ASIA_SESSION2,
    labelBackgroundColor: COLOR_ASIA_SESSION2,
    labelTextColor: 'white',
    lineStyle: 'solid',
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
    color: COLOR_US_SESSION, // Grey
  },
  {
    id: 'closing-time',
    startUtcHour: 20, // 14:45 Central
    startUtcMinute: 45,
    endUtcHour: 23, // 17 Central
    endUtcMinute: 0,
    color: COLOR_US_SESSION, // Grey
  },
  {
    id: 'asia-until-europe',
    startUtcHour: 2, // 20 Central (previous day)
    startUtcMinute: 0,
    endUtcHour: 9, // 3 Central
    endUtcMinute: 0,
    color: COLOR_ASIA_SESSION, // Grey
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
