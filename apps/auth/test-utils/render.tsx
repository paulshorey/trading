import { render as testingLibraryRender } from '@testing-library/react'
import { MantineProvider } from '@my/fe/src/components/mantine'
import { theme } from '../theme'

export function render(ui: React.ReactNode) {
  return testingLibraryRender(<>{ui}</>, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <MantineProvider theme={theme}>{children}</MantineProvider>
    ),
  })
}
