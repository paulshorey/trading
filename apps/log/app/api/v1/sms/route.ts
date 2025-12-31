import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@lib/common/lib/nextjs/formatResponse'
import { sqlLogAdd } from '@lib/common/sql/log/add'
import { sendToMyselfSMS } from '@lib/common/twillio/sendToMyselfSMS'

export const maxDuration = 60

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract POST data
    let bodyData = null
    let bodyText = ''

    if (request.method === 'POST') {
      const contentType = request.headers.get('Content-Type')
      if (contentType && contentType.includes('application/json')) {
        try {
          bodyData = await request.json()
        } catch {
          bodyText = await request.text()
        }
      } else if (contentType && contentType.includes('form')) {
        bodyData = Object.fromEntries(await request.formData())
      } else {
        bodyText = await request.text()
      }
    }

    // Extract URL querystring parameters
    const searchParams = Object.fromEntries(
      request.nextUrl.searchParams.entries()
    )

    // Extract important headers
    const headers = {
      'user-agent': request.headers.get('user-agent'),
      'content-type': request.headers.get('content-type'),
      accept: request.headers.get('accept'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
      'x-forwarded-for': request.headers.get('x-forwarded-for'),
      'x-real-ip': request.headers.get('x-real-ip'),
    }

    // Create data object for logging
    const logData = {
      method: request.method,
      url: request.nextUrl.href,
      pathname: request.nextUrl.pathname,
      searchParams,
      headers,
      bodyData,
      bodyText,
    }

    // Log to database
    await sqlLogAdd({
      name: 'log',
      message: '/api/v1/sms',
      stack: logData,
    })
    await sendToMyselfSMS(bodyText)

    return formatResponse({
      ok: true,
      message: 'Logged successfully',
      data: {
        method: request.method,
        time: new Date().toISOString(),
      },
    })
    // @ts-ignore
  } catch (error: Error) {
    // Log the error as well
    try {
      await sqlLogAdd({
        name: 'error',
        message: `Log endpoint error: ${error.message}`,
        stack: {
          error: error.stack,
          method: request.method,
          url: request.nextUrl.href,
        },
      })
    } catch (logError) {
      console.error('Failed to log error:', logError)
    }

    return formatResponse(
      {
        ok: false,
        error: error.message,
      },
      500
    )
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request)
}
