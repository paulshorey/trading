import dynamic from 'next/dynamic'
import { ThemeWrapper } from '@/components/ThemeWrapper'

// Dynamic import with no SSR - Highcharts requires window
const RealTimeChart = dynamic(
  () =>
    import('@/components/real-time/Wrapper').then(
      (mod) => mod.RealTimeChart
    ),
  { ssr: false }
)

export default function Page() {
  return (
    <ThemeWrapper>
      <RealTimeChart />
    </ThemeWrapper>
  )
}
