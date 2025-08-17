import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@apps/data/lib/nextjs/formatResponse'
import { momentumAdd, MomentumRowAdd } from '@apps/data/sql/momentum'
import { sqlLogAdd } from '@apps/data/sql/log/add'

export const maxDuration = 60

/**
 * Parses momentum data from text format: key=value key=value
 * Example: ticker=ETHUSD interval=30 time=2025-08-17T16:30:00Z timenow=2025-08-17T16:33:56Z volumeStrength=20.598249148121855 priceMovement=-20.44094088810119 priceMovementMa=-17.217636614376822
 * TradingView message: ticker={{ticker}} interval={{interval}} time={{time}} timenow={{timenow}} volumeStrength={{plot("volumeStrength")}} priceMovement={{plot("priceMovement")}} priceMovementMa={{plot("priceMovementMa")}}
 */
function parseMomentumText(bodyText: string) {
  const data = {} as MomentumRowAdd

  // Split by spaces and parse key=value pairs
  const pairs = bodyText.trim().split(/\s+/)

  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      if (key === 'ticker') {
        data.ticker = value
      } else if (key === 'interval') {
        data.interval = parseInt(value)
      } else if (key === 'time') {
        data.time = new Date(value)
      } else if (key === 'timenow') {
        data.timenow = new Date(value)
      } else if (key === 'volumeStrength') {
        data.volumeStrength = parseFloat(value)
      } else if (key === 'priceMovement') {
        data.priceMovement = parseFloat(value)
      } else if (key === 'priceMovementMa') {
        data.priceMovementMa = parseFloat(value)
      }
    }
  }
  return data
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract body text
    let bodyText = ''

    if (request.method === 'GET') {
      // For GET requests, check if there's a body (some clients send body with GET)
      try {
        bodyText = await request.text()
      } catch {
        // If no body, that's fine for GET
        bodyText = ''
      }
    } else {
      bodyText = await request.text()
    }

    if (!bodyText || bodyText.trim() === '') {
      throw new Error('No body text provided')
    }

    // Parse the momentum data
    const momentumData = parseMomentumText(bodyText)

    // Validate parsed data
    if (isNaN(momentumData.interval)) {
      throw new Error('Invalid interval value')
    }
    if (isNaN(momentumData.time.getTime())) {
      throw new Error('Invalid time format')
    }
    if (isNaN(momentumData.timenow.getTime())) {
      throw new Error('Invalid timenow format')
    }
    if (
      isNaN(momentumData.volumeStrength) ||
      isNaN(momentumData.priceMovement) ||
      isNaN(momentumData.priceMovementMa)
    ) {
      throw new Error('Invalid numeric values')
    }

    // Save to database
    const result = await momentumAdd(momentumData)

    // Log success
    await sqlLogAdd({
      name: 'info',
      message: `Momentum data saved for ${momentumData.ticker}`,
      stack: {
        momentumData,
        result,
      },
    })

    return formatResponse({
      ok: true,
      message: 'Momentum data saved successfully',
      data: {
        id: result?.id,
        ticker: momentumData.ticker,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    // Log the error
    await sqlLogAdd({
      name: 'error',
      message: `Momentum endpoint error: ${error.message}`,
      stack: {
        error: error.stack,
        method: request.method,
        url: request.nextUrl.href,
      },
    })

    return formatResponse(
      {
        ok: false,
        error: error.message,
      },
      400
    )
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRequest(request)
}
