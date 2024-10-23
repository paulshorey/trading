import '@my/fe/styles/tailwind.css';
import '@my/fe/styles/global.scss';
import '@mantine/core/styles.css';
import '@my/fe/styles/mantine.scss';
// import 'react-json-view-lite/dist/index.css';
import { MantineProvider } from '@mantine/core';
import { theme } from '@my/fe/styles/theme';

export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata = {
  title: 'Web data',
};

export default async function RootLayout({ children }: { children: any }) {
  const defaultColorScheme = 'dark';
  return (
    <html lang="en" data-mantine-color-scheme={defaultColorScheme} suppressHydrationWarning>
      <head>
        <link rel="shortcut icon" href="/favicon.svg" />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
        />
      </head>
      <body>
        <MantineProvider forceColorScheme={defaultColorScheme} theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
