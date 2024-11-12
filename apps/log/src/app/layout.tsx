import { Providers } from '@my/fe/src/components/wrappers/Providers'
// import dynamic from 'next/dynamic'
// const Providers = dynamic(
//   () =>
//     import('@my/fe/src/components/wrappers/Providers').then(
//       (mod) => mod.Providers
//     ),
//   {
//     ssr: false,
//   }
// )

// export const revalidate = 0
// export const fetchCache = 'force-no-store'
export const metadata = {
  title: 'Log',
}

export default async function RootLayout({ children }: { children: any }) {
  const defaultColorScheme = 'dark'
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
      <body suppressHydrationWarning>
        <Providers defaultColorScheme={defaultColorScheme}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
