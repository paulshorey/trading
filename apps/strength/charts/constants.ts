import { TimeMarkerConfig } from './lib/primitives/timeMarkers'
import { TimeRangeConfig } from './lib/primitives/TimeRangeHighlight'

export const SCALE_FACTOR_DESKTOP = 2
export const SCALE_FACTOR_MOBILE = 1

// Fetch this much data from the database (enough for all hoursBack values)
export const FETCH_DATA_HOURS_BACK = 240
export const FETCH_DATA_ROWS = 7250

// Time in ms to wait after user stops scrolling before resuming polling
export const SCROLL_PAUSE_RESUME_MS = 300000 // 30 seconds

export const SHOW_100_LINES = false

// Color palette
export const COLORS = {
  red: 'hsl(0 75.53% 53.53%)',
  green: 'hsl(120 70.8% 44.31%)',
  purple: 'hsl(275 85% 70%)', // Purple
  dark: '#777777',
  neutral: '#999999',
  // Indicator
  indicator: 'hsl(120 70.8% 44.31%)',
  // Strength
  strength: 'hsl(35 100% 50%)', // Orange
  // Price
  price: 'hsl(233 100% 75%)', // Blue
  // Etc
  light: '#B5B5B566', // Light gray

  // Individual lines (lighter versions)
  strength_i: 'hsla(35 100% 50% / 0.55)', // Orange transparent
  strength_ii: 'hsla(35 100% 50% / 0.44)', // Orange transparent
  strength_iii: 'hsla(35 100% 50% / 0.22)', // Orange transparent

  // price_i: 'hsla(275 85% 70% / 0.5)', // Purple transparent
  price_i: 'hsla(233 100% 75% / 0.67)', // Blue transparent
  light_i: '#CDCCC835',
}

// Time markers - vertical lines on the chart
export const TIME_MARKERS: TimeMarkerConfig[] = [
  {
    label: '8am',
    utcHour: 14,
    utcMinute: 0,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '11:30am',
    utcHour: 17,
    utcMinute: 30,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  // AFTER US MARKET:
  {
    label: '6pm',
    utcHour: 0,
    utcMinute: 0,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '7pm',
    utcHour: 1,
    utcMinute: 0,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  // {
  //   label: '8pm',
  //   utcHour: 2,
  //   utcMinute: 0,
  //   color: COLORS.dark,
  //   labelBackgroundColor: COLORS.dark,
  //   labelTextColor: 'white',
  //   lineStyle: 'solid',
  //   width: 1,
  //   showLabel: false,
  // },
  {
    label: '8:30pm',
    utcHour: 2,
    utcMinute: 30,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '11:45pm',
    utcHour: 5,
    utcMinute: 45,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
  {
    label: '3am',
    utcHour: 9,
    utcMinute: 0,
    color: COLORS.light,
    labelBackgroundColor: COLORS.light,
    labelTextColor: 'white',
    lineStyle: 'solid',
    width: 1,
    showLabel: false,
  },
]

// Time Ranges - shaded vertical areas on the chart
export const TIME_RANGE_HIGHLIGHTS: TimeRangeConfig[] = [
  {
    startUtcHour: 20, // 2:45pm
    startUtcMinute: 45,
    endUtcHour: 13, // 7:30am
    endUtcMinute: 30,
    color: COLORS.light_i,
  },
  {
    startUtcHour: 22, // 5pm
    startUtcMinute: 0,
    endUtcHour: 12, // 6am
    endUtcMinute: 0,
    color: COLORS.light_i,
  },
  {
    startUtcHour: 1, // 8pm
    startUtcMinute: 0,
    endUtcHour: 10, // 4:30am
    endUtcMinute: 30,
    color: COLORS.light_i,
  },
]
