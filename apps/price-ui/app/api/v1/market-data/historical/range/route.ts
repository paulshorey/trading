import { NextRequest, NextResponse } from 'next/server'
import { cc } from '@lib/common/cc'
import { getDateRange } from '@/lib/market-data/candles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * Historical Candles - Date Range
 * Returns the available date range for a ticker
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const ticker = searchParams.get('ticker')

    if (!ticker) {
      return NextResponse.json(
        { error: 'Missing required param: ticker' },
        { status: 400 }
      )
    }

    const range = await getDateRange(ticker)

    if (!range) {
      return NextResponse.json(
        { error: 'No data available for ticker' },
        { status: 404 }
      )
    }

    return NextResponse.json(range)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? { error: error.stack } : { error: String(error) }
    cc.error('GET /api/v1/market-data/historical/range ERROR: ' + message, stack)
    return NextResponse.json(
      {
        error: 'Failed to fetch date range',
        message,
      },
      { status: 500 }
    )
  }
}
