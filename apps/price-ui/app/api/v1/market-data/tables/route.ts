import { NextResponse } from 'next/server'
import { cc } from '@lib/common/cc'
import { getSchema } from '@/lib/market-data/schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * Database Schema
 */
export async function GET() {
  try {
    const schema = await getSchema()
    const environment =
      process.env.VERCEL_ENV || process.env.NODE_ENV || 'local'

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment,
      database: schema,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? { error: error.stack } : { error: String(error) }
    cc.error('GET /api/v1/market-data/tables ERROR: ' + message, stack)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch database schema',
        message,
      },
      { status: 500 }
    )
  }
}
