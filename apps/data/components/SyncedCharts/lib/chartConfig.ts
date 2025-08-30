import {
  DeepPartial,
  ChartOptions,
  Time,
  LineStyleOptions,
  SeriesOptionsCommon,
} from 'lightweight-charts'

/**
 * Get base chart configuration
 */
export const getChartConfig = (
  width: number,
  height: number
): DeepPartial<ChartOptions> => ({
  width,
  height: height, // Use full height passed from parent
  localization: {
    timeFormatter: (time: Time) => {
      // Convert the time (which is in seconds since epoch) to milliseconds
      const date = new Date((time as number) * 1000)
      // Format the date in the user's local time zone
      return date.toLocaleTimeString()
    },
  },
  layout: {
    background: { color: '#ffffff' },
    textColor: '#333',
  },
  grid: {
    vertLines: { visible: false }, // Hide vertical grid lines to reduce clutter
    horzLines: { color: '#f0f0f0' },
  },
  rightPriceScale: {
    visible: false, // Hide the entire y-axis
  },
  timeScale: {
    visible: true,
    timeVisible: true,
    secondsVisible: false,
  },
  crosshair: {
    mode: 0, // Normal mode: we'll set Y explicitly via setCrosshairPosition
    vertLine: {
      visible: true,
      color: '#758391',
      width: 1,
      style: 0, // Solid line
    },
    horzLine: {
      visible: false, // Hide horizontal price line
    },
  },
  // Disable zoom/scroll but allow crosshair interactions
  handleScroll: false,
  handleScale: false,
})

/**
 * Get line series configuration
 */
export const getLineSeriesConfig = (): DeepPartial<
  LineStyleOptions & SeriesOptionsCommon
> => ({
  color: '#e8850d',
  lineWidth: 1 as any, // Cast to any to avoid type issues with LineWidth
  crosshairMarkerBackgroundColor: 'transparent',
  crosshairMarkerBorderColor: 'transparent',
  crosshairMarkerBorderWidth: 0,
  crosshairMarkerVisible: true,
  priceLineVisible: false, // Hide horizontal price line
  lastValueVisible: false, // Hide last value label
})
