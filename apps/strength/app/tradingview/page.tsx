import SyncedChartsWrapper from '../../tradingview/SyncedChartsWrapper'
import { ThemeWrapper } from '../../components/ThemeWrapper'

export default function Page() {
  return (
    <ThemeWrapper colorScheme="light">
      <SyncedChartsWrapper />
    </ThemeWrapper>
  )
}
