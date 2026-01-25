import { NextRequest, NextResponse } from 'next/server'
import { getCandles } from '@/lib/market-data/candles'

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
    const searchParams = request.nextUrl.searchParams
    const ticker = searchParams.get('ticker')
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!ticker) {
      return NextResponse.json(
        { error: 'Missing required param: ticker' },
        { status: 400 }
      )
    }

    // Use defaults if not provided
    const startMs = start ? parseInt(start, 10) : DEFAULT_START_MS
    const endMs = end ? parseInt(end, 10) : Date.now()

    if (isNaN(startMs) || isNaN(endMs)) {
      return NextResponse.json(
        { error: 'Invalid timestamps: start and end must be numbers (ms)' },
        { status: 400 }
      )
    }

    if (startMs >= endMs) {
      return NextResponse.json(
        { error: 'Invalid range: start must be less than end' },
        { status: 400 }
      )
    }

    const result = await getCandles(startMs, endMs, ticker)

    // Return just the data array for Highcharts compatibility
    // Include metadata in headers for debugging
    return NextResponse.json(result.data, {
      headers: {
        'X-Timeframe': result.timeframe,
        'X-Table': result.table,
        'X-Count': result.count.toString(),
      },
    })
  } catch (error) {
    console.error('Error fetching candles:', error)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: 'Failed to fetch candle data', message },
      { status: 500 }
    )
  }
}
