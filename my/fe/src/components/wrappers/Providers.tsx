import { MantineProvider } from '@mantine/core'
import { theme } from '../../styles/theme'

import '../../styles/tailwind.css'
import '../../styles/global.scss'
import '@mantine/core/styles.css'
import '../../styles/mantine.scss'
import ErrorBoundary from './ErrorBoundary'

export function Providers({ children, defaultColorScheme }: any) {
  return (
    <MantineProvider forceColorScheme={defaultColorScheme} theme={theme}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </MantineProvider>
  )
}
