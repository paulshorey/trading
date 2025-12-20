const COLOR_I = COLORS.neutral_i
const COLOR_ASIA = COLORS.neutral
const COLOR_US = COLORS.neutral

/**
 * Time Markers Configuration
 *
 * Defines vertical line markers to display on the chart at specific times.
 * All times are stored in UTC to avoid timezone issues.
 * The chart will display them in the user's local timezone.
 */

import { VerticalLineOptions } from '../lib/VerticalLinePrimitive'
import { TimeRangeConfig } from '../lib/TimeRangeHighlight'
import { COLORS } from '../constants'

export interface TimeMarkerConfig {
  /** Unique identifier for the marker */
  // id: string
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
  // {
  //   label: '6am',
  //   utcHour: 12,
  //   utcMinute: 0,
  //   color: COLOR_US,
  //   labelBackgroundColor: COLOR_US,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  {
    label: '8am',
    utcHour: 14,
    utcMinute: 0,
    color: COLOR_US,
    labelBackgroundColor: COLOR_US,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  // {
  //   label: '9am',
  //   utcHour: 15,
  //   utcMinute: 0,
  //   color: COLOR_US,
  //   labelBackgroundColor: COLOR_US,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  // {
  //   label: '10am',
  //   utcHour: 16,
  //   utcMinute: 0,
  //   color: COLOR_US,
  //   labelBackgroundColor: COLOR_US,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  {
    label: '11:30am',
    utcHour: 17,
    utcMinute: 30,
    color: COLOR_US,
    labelBackgroundColor: COLOR_US,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  // {
  //   label: '12am',
  //   utcHour: 18,
  //   utcMinute: 0,
  //   color: COLOR_US,
  //   labelBackgroundColor: COLOR_US,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  // {
  //   label: '13am',
  //   utcHour: 19,
  //   utcMinute: 0,
  //   color: COLOR_US,
  //   labelBackgroundColor: COLOR_US,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  // AFTER US MARKET
  {
    label: '6pm',
    utcHour: 0,
    utcMinute: 0,
    color: COLOR_ASIA,
    labelBackgroundColor: COLOR_ASIA,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '7pm',
    utcHour: 1,
    utcMinute: 0,
    color: COLOR_ASIA,
    labelBackgroundColor: COLOR_ASIA,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '8pm',
    utcHour: 2,
    utcMinute: 0,
    color: COLOR_ASIA,
    labelBackgroundColor: COLOR_ASIA,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
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
    startUtcHour: 20, // 2:45pm
    startUtcMinute: 45,
    endUtcHour: 13, // 7:30am
    endUtcMinute: 30,
    color: COLOR_I,
  },
  {
    startUtcHour: 22, // 5pm
    startUtcMinute: 0,
    endUtcHour: 12, // 6am
    endUtcMinute: 0,
    color: COLOR_I,
  },
  {
    startUtcHour: 3, // 9:30pm
    startUtcMinute: 30,
    endUtcHour: 10, // 4:30am
    endUtcMinute: 30,
    color: COLOR_I,
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
