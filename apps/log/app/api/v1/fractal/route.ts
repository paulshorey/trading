import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@apps/data/lib/nextjs/formatResponse'
import { fractalAdd, FractalRowAdd } from '@apps/data/sql/fractal'
import { sqlLogAdd } from '@apps/data/sql/log/add'

export const maxDuration = 60

/**
 * Parses fractal data from text format: key=value key=value
 * Example: ticker=ETHUSD interval=2 time=2025-08-17T20:46:00Z timenow=2025-08-17T20:46:34Z volumeStrength=33.32665822909558 priceStrength=-14.005869947279702 priceVolumeStrength=-49.941121303580324 volumeStrengthMa=36.30304183354799 priceStrengthMa=-12.175479058829573 priceVolumeStrengthMa=-45.76830524619087
 * TradingView message: ticker={{ticker}} interval={{interval}} time={{time}} timenow={{timenow}} volumeStrength={{plot("volumeStrength")}} priceStrength={{plot("priceStrength")}} priceVolumeStrength={{plot("priceVolumeStrength")}} volumeStrengthMa={{plot("volumeStrengthMa")}} priceStrengthMa={{plot("priceStrengthMa")}} priceVolumeStrengthMa={{plot("priceVolumeStrengthMa")}}
 */
function parseFractalText(bodyText: string) {
  const data = {} as FractalRowAdd

  // Split by spaces and parse key=value pairs
  const pairs = bodyText.trim().split(/\s+/)

  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      if (key === 'ticker') {
        data.ticker = value
      } else if (key === 'interval') {
        data.interval = value
      } else if (key === 'time') {
        data.time = new Date(value)
      } else if (key === 'timenow') {
        data.timenow = new Date(value)
      } else if (key === 'volumeStrength') {
        data.volumeStrength = parseFloat(value)
      } else if (key === 'priceStrength') {
        data.priceStrength = parseFloat(value)
      } else if (key === 'priceVolumeStrength') {
        data.priceVolumeStrength = parseFloat(value)
      } else if (key === 'volumeStrengthMa') {
        data.volumeStrengthMa = parseFloat(value)
      } else if (key === 'priceStrengthMa') {
        data.priceStrengthMa = parseFloat(value)
      } else if (key === 'priceVolumeStrengthMa') {
        data.priceVolumeStrengthMa = parseFloat(value)
      }
    }
  }
  return data
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  let bodyText = ''
  try {
    bodyText = await request.text()
  } catch {}
  try {
    if (!bodyText || bodyText.trim() === '') {
      throw new Error('No body text provided')
    }

    // Parse the fractal data
    const fractalData = parseFractalText(bodyText)

    // Validate parsed data
    if (!fractalData.interval || fractalData.interval.trim() === '') {
      throw new Error('Invalid interval value')
    }
    if (isNaN(fractalData.time.getTime())) {
      throw new Error('Invalid time format')
    }
    if (isNaN(fractalData.timenow.getTime())) {
      throw new Error('Invalid timenow format')
    }
    if (
      isNaN(fractalData.volumeStrength) ||
      isNaN(fractalData.priceStrength) ||
      isNaN(fractalData.priceVolumeStrength) ||
      isNaN(fractalData.volumeStrengthMa) ||
      isNaN(fractalData.priceStrengthMa) ||
      isNaN(fractalData.priceVolumeStrengthMa)
    ) {
      throw new Error('Invalid numeric values')
    }

    // Save to database
    const result = await fractalAdd(fractalData)

    // Log success
    return formatResponse({
      ok: true,
      message: 'Fractal data saved successfully',
      data: {
        id: result?.id,
        ticker: fractalData.ticker,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    // Log the error
    await sqlLogAdd({
      name: 'warn',
      message: `Fractal endpoint error: ${error.message}`,
      stack: {
        url: request.nextUrl.href,
        bodyText: bodyText,
        method: request.method,
        stack: error.stack,
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
