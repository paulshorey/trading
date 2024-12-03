import { ErrorBoundary } from '@my/fe/ui/components/wrappers/ErrorBoundary'
import { Providers } from '@my/fe/ui/components/wrappers/Providers'
// import '@src/styles/tailwind.css'
// import '@src/styles/global.scss'
// import '@mantine/core/styles.css'
import React from 'react'
import { Toaster } from 'react-hot-toast'
import SessionProvider from '@src/context/SessionProvider'
import { sessionGet } from '@my/be/auth/actions/session'
import dynamic from 'next/dynamic'
import NavLeft from '../components/templates/NavLeft'
import NavRight from '../components/templates/NavRight'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const metadata = {
  title: 'Auth',
}

const OnLoad = dynamic(
  async () => (await import('@my/fe/auth/components/OnLoad')).default,
  {
    ssr: false,
    loading: () => <p>Loading...</p>,
  }
)

export default async function RootLayout({ children }: { children: any }) {
  const session = await sessionGet()
  const defaultColorScheme =
    session.user?.untrusted_metadata?.color_scheme || 'dark'
  // const defaultColorScheme = 'dark'
  return (
    <html
      lang="en"
      data-mantine-color-scheme={defaultColorScheme}
      suppressHydrationWarning
    >
      <head>
        <link rel="shortcut icon" href="/favicon.svg" />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
        />
      </head>
      <body>
        <SessionProvider session={session}>
          <Providers defaultColorScheme={defaultColorScheme}>
            <ErrorBoundary>
              <div className="flex w-full" style={{ width: '100%' }}>
                <NavLeft />
                <NavRight />
                <div className="w-full">
                  <div className="page-height">
                    <div className="page-width">{children}</div>
                  </div>
                </div>
              </div>
              <Toaster
                containerStyle={{
                  maxWidth: '100%',
                  padding: '0',
                }}
                toastOptions={{
                  className: 'reactHotToast',
                  style: {
                    justifyContent: 'bottom',
                    padding: '0 0.75rem 0 1.25rem',
                    maxWidth: '100%',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
              <OnLoad />
            </ErrorBoundary>
          </Providers>
        </SessionProvider>
      </body>
    </html>
  )
}
