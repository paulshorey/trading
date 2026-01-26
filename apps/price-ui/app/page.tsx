import Link from 'next/link'
import { ThemeWrapper } from '@/components/ThemeWrapper'

export default function Page() {
  return (
    <ThemeWrapper>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a2e',
          color: '#e0e0e0',
          padding: '40px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            textAlign: 'center',
            maxWidth: '420px',
          }}
        >
          <div>
            <h1 style={{ marginBottom: '8px', fontSize: '28px' }}>Price UI</h1>
            <p style={{ margin: 0, color: '#a0a0b0' }}>
              Choose a chart view
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <Link
              href="/historical"
              style={{
                padding: '14px 18px',
                borderRadius: '10px',
                background: '#2d2d4a',
                color: '#e0e0e0',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Historical chart
            </Link>
            <Link
              href="/real-time"
              style={{
                padding: '14px 18px',
                borderRadius: '10px',
                background: '#4a6fa5',
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Real-time chart
            </Link>
          </div>
        </div>
      </main>
    </ThemeWrapper>
  )
}
