import { NextRequest, NextResponse } from 'next/server'
import { cc } from '@lib/common/cc'
import { getCandles } from '@/lib/market-data/candles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

// Default date range: 2010-01-01 to now
const DEFAULT_START_MS = new Date('2010-01-01').getTime()

/**
 * Historical Candles
 *
 * Query params:
 *   ticker - Ticker symbol (required)
 *   start  - Start timestamp in ms (default: 2010-01-01)
 *   end    - End timestamp in ms (default: now)
 *
 * Returns array of tuples: [timestamp_ms, open, high, low, close, volume]
 * Automatically selects the best timeframe based on date range.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const ticker = searchParams.get('ticker')
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!ticker) {
      return NextResponse.json(
        { error: 'Missing required param: ticker' },
        { status: 400 }
      )
    }

    const startMs = start ? parseInt(start, 10) : DEFAULT_START_MS
    const endMs = end ? parseInt(end, 10) : Date.now()

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return NextResponse.json(
        {
          error: 'Invalid timestamps: start and end must be numbers (ms)',
        },
        { status: 400 }
      )
    }

    if (startMs >= endMs) {
      return NextResponse.json(
        {
          error: 'Invalid range: start must be less than end',
        },
        { status: 400 }
      )
    }

    const result = await getCandles(startMs, endMs, ticker)
    const headers = new Headers()
    headers.set('X-Timeframe', result.timeframe)
    headers.set('X-Table', result.table)
    headers.set('X-Count', result.count.toString())

    return NextResponse.json(result.data, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? { error: error.stack } : { error: String(error) }
    cc.error('GET /api/v1/market-data/candles ERROR: ' + message, stack)
    return NextResponse.json(
      {
        error: 'Failed to fetch candle data',
        message,
      },
      { status: 500 }
    )
  }
}
