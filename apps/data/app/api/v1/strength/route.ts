import { NextRequest } from 'next/server'
import { formatResponse } from '@apps/common/lib/nextjs/formatResponse'
import { sqlLogAdd } from '@apps/common/sql/log/add'
import { parseStrengthText } from '@/lib/parseStrengthText'
import { strengthAdd } from '@apps/common/sql/strength'
import { strengthGets } from '@apps/common/sql/strength/gets'
import { sendToMyselfSMS } from '@apps/common/twillio/sendToMyselfSMS'
import { cc } from '@apps/common/cc'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const callId = Math.random().toString(36).substring(7)

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const ticker = searchParams.get('ticker')
    const timenow_gt = searchParams.get('timenow_gt')
    const server_name = searchParams.get('server_name')
    const app_name = searchParams.get('app_name')
    const node_env = searchParams.get('node_env')
    const limit = searchParams.get('limit')

    // Build where clause
    const where: any = {}
    if (ticker) where.ticker = ticker
    if (timenow_gt) where.timenow_gt = timenow_gt
    if (server_name) where.server_name = server_name
    if (app_name) where.app_name = app_name
    if (node_env) where.node_env = node_env
    if (limit) where.limit = parseInt(limit, 10)

    // Call the strengthGets function
    const { rows, error } = await strengthGets({ where })

    if (error) {
      cc.error(`API strengthGet [${callId}] ERROR:`, error)
      return formatResponse(
        {
          ok: false,
          error: error.message || 'Failed to fetch strength data',
        },
        500
      )
    }

    return formatResponse({
      ok: true,
      rows: rows || [],
    })
  } catch (error: any) {
    cc.error(`API strengthGet [${callId}] CATCH ERROR:`, error)
    return formatResponse(
      {
        ok: false,
        error: error.message || 'Failed to fetch strength data',
      },
      500
    )
  }
}

export async function POST(request: NextRequest) {
  let bodyData
  let bodyText = ''

  /**
   * Parse body
   */
  try {
    const contentType = request.headers.get('Content-Type')
    if (contentType && contentType.includes('form')) {
      bodyData = Object.fromEntries(await request.formData())
    } else {
      bodyText = await request.text()
    }

    /**
     * 1. Save strength
     */
    const strengthData = parseStrengthText(bodyText)
    // Check if we have both strength and interval values
    if (
      strengthData?.strength !== undefined &&
      strengthData?.interval !== undefined &&
      strengthData?.ticker !== undefined
    ) {
      // Validate parsed data
      if (
        strengthData.strength === null ||
        strengthData.interval === null ||
        strengthData.ticker === null
      ) {
        await sqlLogAdd({
          name: 'log',
          message: `/v1/strength invalid strengthData`,
          stack: {
            bodyText,
          },
        })
        return formatResponse(
          {
            ok: false,
            error: `Invalid strengthData`,
          },
          400
        )
      }

      try {
        // Save to database
        const result = await strengthAdd(strengthData)

        return formatResponse({
          ok: true,
          message: 'Strength data saved successfully',
          resultId: result?.id,
          data: strengthData,
        })
      } catch (error: any) {
        // Log error
        await sqlLogAdd({
          name: 'warn',
          message: `Strength endpoint error: ${error.message}`,
          stack: {
            url: request.nextUrl.href,
            bodyText: bodyText,
            method: request.method,
            stack: error.stack,
          },
        })
        // Done
        return formatResponse(
          {
            ok: false,
            error: error.message,
          },
          400
        )
      }
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    await sqlLogAdd({
      name: 'error',
      message: `/v1/strength error "${error.message}" executing bodyText "${bodyText}"`,
      stack: {
        stack: error.stack,
        bodyText,
        bodyData,
      },
    })
    return formatResponse({ error: error.message }, 500)
  }
}

process.on('uncaughtException', async (err) => {
  const message = `Uncaught Exception: ${
    err?.message ? err.message : err.toString()
  }`
  console.error(message, err)
  sendToMyselfSMS(message)
  await sqlLogAdd({
    name: 'error',
    message,
    stack: {
      str: err?.toString(),
      json: JSON.stringify(err),
    },
  })
  return formatResponse({ error: 'Uncaught Exception' }, 500)
})

process.on('unhandledRejection', async (reason, promise) => {
  const message = `Unhandled Rejection: ${reason ? reason : promise.toString()}`
  console.error(message, promise, 'reason:', reason)
  sendToMyselfSMS(message)
  await sqlLogAdd({
    name: 'error',
    message,
    stack: {
      str: reason?.toString(),
      json: JSON.stringify(reason),
    },
  })
  return formatResponse({ error: 'Unhandled Rejection' }, 500)
})
