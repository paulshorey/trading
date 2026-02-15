import { NextRequest } from 'next/server'
import { formatResponse } from '@lib/common/lib/nextjs/formatResponse'
import { strengthGets } from '@lib/common/sql/strength/gets'
import { cc } from '@lib/common/cc'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  // const callId = Math.random().toString(36).substring(7)

  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const ticker = searchParams.get('ticker')
    const timenow_gt = searchParams.get('timenow_gt')
    const timenow_lt = searchParams.get('timenow_lt')
    const server_name = searchParams.get('server_name')
    const app_name = searchParams.get('app_name')
    const node_env = searchParams.get('node_env')
    const limit = searchParams.get('limit')

    // Build where clause
    const where: any = {}
    if (ticker) where.ticker = ticker
    if (timenow_gt) where.timenow_gt = timenow_gt
    if (timenow_lt) where.timenow_lt = timenow_lt
    if (server_name) where.server_name = server_name
    if (app_name) where.app_name = app_name
    if (node_env) where.node_env = node_env
    if (limit) where.limit = parseInt(limit, 10000)

    // Call the strengthGets function
    const { rows, error } = await strengthGets({ where })

    if (error) {
      cc.error(`API strengthGet ERROR: ` + error.message, error)
      return formatResponse(
        {
          ok: false,
          error: error.message || 'Failed to fetch strength data',
        },
        500
      )
    }

    // Delete every other row if rows exist
    let filteredRows = rows
    // if (rows?.length) {
    //   filteredRows = rows.filter((_, index) => index % 2 === 0)
    // }

    return formatResponse({
      ok: true,
      rows: filteredRows || [],
    })
  } catch (error: any) {
    cc.error(`GET /api/v1/tradingview CATCH ERROR: ` + error.message, error)
    return formatResponse(
      {
        ok: false,
        error: error.message || 'Failed to fetch strength data',
      },
      500
    )
  }
}
