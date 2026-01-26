import dynamic from 'next/dynamic'
import { ThemeWrapper } from '../../components/ThemeWrapper'

// Dynamic import with no SSR - lightweight-charts requires window
const StreamChartWrapper = dynamic(
  () => import('../../stream/Wrapper').then((mod) => mod.StreamChartWrapper),
  { ssr: false }
)

export default function Page() {
  return (
    <ThemeWrapper colorScheme="light">
      <StreamChartWrapper />
    </ThemeWrapper>
  )
}
