'use client'

import { Chart } from './Chart'

export function RealTimeChart() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#1a1a2e',
      }}
    >
      <Chart />
    </div>
  )
}
