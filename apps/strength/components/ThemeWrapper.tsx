'use client'

import { useEffect } from 'react'
import { MantineProvider } from '@mantine/core'
import { theme } from '@apps/common/fe/styles/theme'
import { ErrorBoundary } from '@apps/common/fe/components/wrappers/ErrorBoundary'

// Import all the styles that were in Providers
import '@apps/common/fe/styles/tailwind.css'
import '@apps/common/fe/styles/global.scss'
import '@mantine/core/styles.css'
import '@apps/common/fe/styles/mantine.scss'

export function ThemeWrapper({
  children,
  colorScheme = 'dark',
}: {
  children: React.ReactNode
  colorScheme?: 'dark' | 'light'
}) {
  // Update the HTML element's data attribute when color scheme changes
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-mantine-color-scheme',
      colorScheme
    )
  }, [colorScheme])

  return (
    <MantineProvider forceColorScheme={colorScheme} theme={theme}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </MantineProvider>
  )
}
