import {
  DeepPartial,
  ChartOptions,
  Time,
  LineStyleOptions,
  SeriesOptionsCommon,
} from 'lightweight-charts'

function timeFormatter(time: Time) {
  // Convert the time (which is in seconds since epoch) to milliseconds
  const date = new Date((time as number) * 1000)
  // Format the time in the user's local time zone
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')

  const month = (date.getMonth() + 1).toString()
  const day = date.getDate().toString()
  return `${month}/${day} ${hours}:${minutes}`
}

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
    timeFormatter,
  },
  layout: {
    background: { color: '#ffffff' },
    textColor: '#333',
    attributionLogo: false, // Hide TradingView logo
  },
  grid: {
    vertLines: { visible: false }, // Hide vertical grid lines to reduce clutter
    horzLines: { color: '#f0f0f0' },
  },
  // Y-Axis
  rightPriceScale: {
    visible: window.innerWidth > 1200 ? true : false,
    minimumWidth: 80,
    // invertScale: true,
  },
  // X-Axis
  timeScale: {
    visible: true,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: timeFormatter,
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
