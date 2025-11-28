/**
 * Chart Configuration
 *
 * Lightweight-charts configuration for styling, axes, and behavior.
 */

import {
  DeepPartial,
  ChartOptions,
  Time,
  LineStyleOptions,
  SeriesOptionsCommon,
} from 'lightweight-charts'

/**
 * Format timestamp for display
 * Shows: MM/DD HH:mm in local timezone
 */
function timeFormatter(time: Time) {
  const date = new Date((time as number) * 1000)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString()
  const day = date.getDate().toString()
  return `${month}/${day} ${hours}:${minutes}`
}

/**
 * Get base chart configuration
 * Configures dual y-axes, grid, crosshair, and time scale
 */
export const getChartConfig = (height: number): DeepPartial<ChartOptions> => ({
  overlayPriceScales: {},
  height,
  localization: {
    timeFormatter,
  },
  layout: {
    background: { color: '#ffffff' },
    textColor: '#333',
    attributionLogo: false,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { color: '#f0f0f0' },
  },
  // Dual Y-Axes configuration
  rightPriceScale: {
    visible: false,
    minimumWidth: 80,
  },
  leftPriceScale: {
    visible: false,
    minimumWidth: 80,
  },
  // X-Axis (time scale)
  timeScale: {
    visible: true,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: timeFormatter,
  },
  // Crosshair settings
  crosshair: {
    mode: 0,
    vertLine: {
      visible: true,
      color: '#758391',
      width: 1,
      style: 0,
    },
    horzLine: {
      visible: true,
      color: '#758391',
      width: 1,
      style: 0,
    },
  },
  // Allow scroll, disable zoom
  handleScroll: true,
  handleScale: false,
})

/**
 * Get line series configuration
 * Base styling for chart line series
 */
export const getLineSeriesConfig = (): DeepPartial<
  LineStyleOptions & SeriesOptionsCommon
> => ({
  color: '#e8850d',
  crosshairMarkerBackgroundColor: 'transparent',
  crosshairMarkerBorderColor: 'transparent',
  crosshairMarkerBorderWidth: 0,
  crosshairMarkerVisible: true,
  priceLineVisible: false,
  lastValueVisible: false,
})

// Chart color constants
export const CHART_COLORS = {
  strength: '#ff9d00d7',
  price: '#0091ff98',
  zeroLine: '#ff9d00d7',
} as const


