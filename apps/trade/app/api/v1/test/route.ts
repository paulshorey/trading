import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@lib/common/lib/nextjs/formatResponse'
import Dydx from '@/dydx'

export const maxDuration = 60

/**
 * Test endpoint to verify DYDX connection
 * GET /api/v1/test?action=account|positions|orders|candles
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const action = request.nextUrl.searchParams.get('action') || 'account'
    const ticker = request.nextUrl.searchParams.get('ticker') || 'XRP-USD'

    const dydx = new Dydx()
    await dydx.init()

    let data: any

    switch (action) {
      case 'account':
        data = await dydx.getAccount()
        break
      case 'positions':
        data = await dydx.getPositions(ticker)
        break
      case 'orders':
        data = await dydx.getOrders(ticker)
        break
      case 'candles':
        data = await dydx.getCandles(ticker, '1MIN', 5)
        break
      case 'market':
        data = await dydx.getPerpetualMarket(ticker)
        break
      default:
        return formatResponse({ ok: false, error: 'Invalid action' }, 400)
    }

    return formatResponse({
      ok: true,
      action,
      ticker,
      data,
    })
  } catch (err: any) {
    return formatResponse(
      {
        ok: false,
        error: err?.message || 'Unknown error',
        stack: err?.stack,
      },
      500
    )
  }
}
