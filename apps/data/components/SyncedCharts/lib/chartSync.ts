import { IChartApi, ISeriesApi, Time, LineData } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'
import { getNearestSeriesValueAtTime } from './chartUtils'

/**
 * Apply time range to all charts
 */
export const applyTimeRangeToAllCharts = (
  chartRefs: (IChartApi | null)[],
  range: { from: Time; to: Time } | null
) => {
  if (!range) return

  chartRefs.forEach((chart) => {
    if (chart) {
      try {
        chart.timeScale().setVisibleRange(range)
      } catch (error) {
        console.warn('Failed to set visible range:', error)
      }
    }
  })
}

/**
 * Apply cursor position to all charts
 */
export const applyCursorToAllCharts = (
  time: Time | null,
  chartRefs: (IChartApi | null)[],
  seriesRefs: (ISeriesApi<'Line'> | null)[],
  allChartsData: (LineData[] | null)[],
  rawData: (StrengthRowGet[] | null)[],
  control_interval: string,
  isUpdatingCursor: { current: boolean }
) => {
  if (isUpdatingCursor.current) return
  isUpdatingCursor.current = true

  chartRefs.forEach((chart, index) => {
    if (!chart || !seriesRefs[index]) return
    try {
      if (time !== null) {
        const price = getNearestSeriesValueAtTime(
          allChartsData[index],
          time,
          index,
          rawData,
          control_interval
        )
        if (price != null) {
          chart.setCrosshairPosition(price, time, seriesRefs[index]!)
        } else {
          chart.clearCrosshairPosition()
        }
      } else {
        chart.clearCrosshairPosition()
      }
    } catch (error) {
      console.warn('Failed to set crosshair position:', error)
    }
  })

  setTimeout(() => {
    isUpdatingCursor.current = false
  }, 0)
}

/**
 * Handle window resize for all charts
 */
export const handleWindowResize = (
  chartRefs: (IChartApi | null)[],
  chartContainerRefs: (HTMLDivElement | null)[]
) => {
  chartRefs.forEach((chart, index) => {
    if (chart && chartContainerRefs[index]) {
      chart.applyOptions({
        width: chartContainerRefs[index]!.clientWidth,
      })
    }
  })
}
