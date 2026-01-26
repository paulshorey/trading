import dynamic from 'next/dynamic'
import { ThemeWrapper } from '@/components/ThemeWrapper'

// Dynamic import with no SSR - Highcharts requires window
const HistoricalChart = dynamic(
  () =>
    import('@/components/historical/Wrapper').then(
      (mod) => mod.HistoricalChart
    ),
  { ssr: false }
)

export default function Page() {
  return (
    <ThemeWrapper>
      <HistoricalChart />
    </ThemeWrapper>
  )
}
