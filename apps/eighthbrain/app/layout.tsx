import './globals.css'

export const metadata = {
  title: 'Eighth Brain — The AI-Powered Knowledge Universe',
  description:
    'An AI-powered knowledge base for science, engineering, commerce, and finance. Learn the skills to advance your career, build a business, or succeed in investing.',
  keywords: ['AI', 'knowledge base', 'science', 'finance', 'learning', 'career', 'investing'],
  openGraph: {
    title: 'Eighth Brain — The AI-Powered Knowledge Universe',
    description:
      'The world\'s knowledge, connected and made intelligent. Science. Engineering. Commerce. Finance. Your path to mastery starts here.',
    url: 'https://eighthbrain.ai',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/favicon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          minHeight: '100vh',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  )
}
