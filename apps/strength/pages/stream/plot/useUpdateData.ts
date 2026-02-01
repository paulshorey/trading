import { useCallback } from 'react'
import type { Candle } from '@/lib/market-data/candles'
import { SERIES } from './constants'
import type { SeriesRefs, AbsorptionRefs } from './useChart'

interface UseUpdateDataProps {
  seriesRefs: SeriesRefs
  absorptionRefs: AbsorptionRefs
}

interface UseUpdateDataReturn {
  updateChartData: (candles: Candle[]) => void
}

export function useUpdateData({
  seriesRefs,
  absorptionRefs,
}: UseUpdateDataProps): UseUpdateDataReturn {
  const updateChartData = useCallback(
    (candles: Candle[]) => {
      // Update price series
      if (seriesRefs.price.current && SERIES.price.formatter) {
        seriesRefs.price.current.setData(SERIES.price.formatter(candles))
      }

      // Update CVD series (OHLC bars)
      if (seriesRefs.cvd.current && SERIES.cvd.formatter) {
        seriesRefs.cvd.current.setData(SERIES.cvd.formatter(candles))
      }

      // Update RSI
      if (seriesRefs.rsi.current && SERIES.rsi.formatter) {
        seriesRefs.rsi.current.setData(SERIES.rsi.formatter(candles))
      }

      // Update OHLC bar series
      if (seriesRefs.evr.current && SERIES.evr.formatter) {
        seriesRefs.evr.current.setData(SERIES.evr.formatter(candles))
      }
      if (seriesRefs.vwap.current && SERIES.vwap.formatter) {
        seriesRefs.vwap.current.setData(SERIES.vwap.formatter(candles))
      }
      if (seriesRefs.spreadBps.current && SERIES.spreadBps.formatter) {
        seriesRefs.spreadBps.current.setData(
          SERIES.spreadBps.formatter(candles)
        )
      }
      if (seriesRefs.pricePct.current && SERIES.pricePct.formatter) {
        seriesRefs.pricePct.current.setData(SERIES.pricePct.formatter(candles))
      }

      // Update line series
      if (seriesRefs.bookImbalance.current && SERIES.bookImbalance.formatter) {
        seriesRefs.bookImbalance.current.setData(
          SERIES.bookImbalance.formatter(candles)
        )
      }
      if (seriesRefs.volume.current && SERIES.volume.formatter) {
        seriesRefs.volume.current.setData(SERIES.volume.formatter(candles))
      }
      if (seriesRefs.bigTrades.current && SERIES.bigTrades.formatter) {
        seriesRefs.bigTrades.current.setData(
          SERIES.bigTrades.formatter(candles)
        )
      }
      if (seriesRefs.bigVolume.current && SERIES.bigVolume.formatter) {
        seriesRefs.bigVolume.current.setData(
          SERIES.bigVolume.formatter(candles)
        )
      }
      if (seriesRefs.vdStrength.current && SERIES.vdStrength.formatter) {
        seriesRefs.vdStrength.current.setData(
          SERIES.vdStrength.formatter(candles)
        )
      }

      // Temporarily disable absorption markers:
      // // Update absorption markers
      // if (seriesRefs.price.current) {
      //   const absorptionTimestamps = detectAbsorptionPoints(candles)
      //   // Add markers for new absorption points (avoid duplicates)
      //   for (const timestamp of absorptionTimestamps) {
      //     if (!absorptionRefs.timestamps.current.has(timestamp)) {
      //       const marker = new VerticalLinePrimitive(
      //         (timestamp / 1000) as Time,
      //         ABSORPTION_MARKER
      //       )
      //       seriesRefs.price.current.attachPrimitive(marker)
      //       absorptionRefs.markers.current.push(marker)
      //       absorptionRefs.timestamps.current.add(timestamp)
      //     }
      //   }
      // }
    },
    [seriesRefs, absorptionRefs]
  )

  return { updateChartData }
}
