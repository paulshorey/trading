import { ISeriesApi, Time, LineData } from 'lightweight-charts'
import { StrengthRowGet } from '@apps/common/sql/strength'
import { getNearestSeriesValueAtTime } from './chartUtils'

/**
 * Apply cursor position to all charts
 */
export const applyCursorToAllCharts = (
  time: Time | null,
  chartRefs: any[], // Using any to avoid IChartApi import issues
  seriesRefs: (ISeriesApi<'Line'> | null)[],
  allChartsData: (LineData[] | null)[],
  rawData: (StrengthRowGet[] | null)[],
  control_intervals: string[],
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
          control_intervals
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
  chartRefs: any[], // Using any to avoid IChartApi import issues
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
