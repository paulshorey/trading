import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@apps/data/lib/nextjs/formatResponse'
import { executeOrderMarket } from '@/dydx/executeOrderMarket'
import { parseOrdersText } from '@/dydx/lib/parseOrdersText'
import { sqlLogAdd } from '@apps/data/sql/log/add'
import { MarketOrderOutput } from '@/dydx/types'
import { sendToMyselfSMS } from '@apps/data/twillio/sendToMyselfSMS'
import { parseFractalText } from '@/dydx/lib/parseFractalText'
import { fractalAdd } from '@apps/data/sql/fractal'

export const maxDuration = 60

export async function POST(request: NextRequest): Promise<NextResponse> {
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
     * 1. Save fractal
     */
    const fractalData = parseFractalText(bodyText)
    console.log('fractalData', fractalData)
    if (fractalData?.price_strength) {
      try {
        // Validate parsed data
        if (!fractalData.interval || !fractalData.interval.trim() || isNaN(fractalData.time.getTime()) || isNaN(fractalData.timenow.getTime())) {
          throw new Error(`Invalid bodyText "${bodyText}"`)
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
        // Log error
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

    /*
     * 2. Market order
     */
    const parsedOrders = parseOrdersText(bodyText)
    console.log('parsedOrders', parsedOrders)
    if (parsedOrders[0]?.position !== undefined) {
      try {
        let access_key = request.nextUrl.searchParams.get('access_key')
        if (!access_key) throw new Error('!access_key')
        if (!(access_key === 'testkeyx' || access_key === 'postmansecret')) {
          throw new Error('wrong access_key')
        }
        const datas = [] as MarketOrderOutput[]
        for (let order of parsedOrders) {
          const data = await executeOrderMarket(order)
          if (data?.error) {
            return formatResponse(
              {
                ok: false,
                message: 'data?.error',
                data,
                bodyText,
                bodyData,
                parsedOrders,
              },
              405
            )
          }
          datas.push(data)
        }
        return formatResponse({
          ok: true,
          data: datas,
          tvline: 1,
        })
      } catch (err: any) {
        const error = err instanceof Error ? err : new Error(String(err))
        await sqlLogAdd({
          name: 'error',
          message: `/v1/market error "${error.message}"`,
          stack: {
            stack: error.stack,
          },
        })
        return formatResponse({ error: error.message }, 500)
      }
    }

    /**
     * 3. Log message
     */
    console.log('bodyText', bodyText)
    sendToMyselfSMS(bodyText)
    await sqlLogAdd({
      name: 'log',
      message: `parseOrdersText failed`,
      stack: {
        bodyText,
        parsedOrders,
        bodyData,
      },
    })
    return formatResponse(
      {
        ok: false,
        message: 'could not parse body text',
        bodyText,
      },
      405
    )

    /**
     * 4. Something went wrong
     */
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    await sqlLogAdd({
      name: 'error',
      message: `/v1/market error "${error.message}" executing bodyText "${bodyText}"`,
      stack: {
        stack: error.stack,
        bodyText,
        bodyData,
      },
    })
    return formatResponse({ error: error.message }, 500)
  }
}

// process.on('uncaughtException', async (err) => {
//   const message = `Uncaught Exception: ${err?.message ? err.message : err.toString()}`
//   console.error(message, err)
//   sendToMyselfSMS(message)
//   await sqlLogAdd({
//     name: 'error',
//     message,
//     stack: {
//       str: err?.toString(),
//       json: JSON.stringify(err),
//     },
//   })
//   return formatResponse({ error: 'Uncaught Exception' }, 500)
// })
// process.on('unhandledRejection', async (reason, promise) => {
//   const message = `Unhandled Rejection: ${reason ? reason : promise.toString()}`
//   console.error(message, promise, 'reason:', reason)
//   sendToMyselfSMS(message)
//   await sqlLogAdd({
//     name: 'error',
//     message,
//     stack: {
//       str: reason?.toString(),
//       json: JSON.stringify(reason),
//     },
//   })
//   return formatResponse({ error: 'Unhandled Rejection' }, 500)
// })

// function fixDydxDataTx(data: any) {
//   if (typeof data?.tx === 'object' && data?.tx !== null) {
//     try {
//       if (data.tx.data) data.tx.data = btoa(String.fromCharCode.apply(null, data.tx.data))
//       if (data.tx.hash) data.tx.hash = btoa(String.fromCharCode.apply(null, data.tx.hash))
//       data.tx = {
//         code: data.tx.code,
//         codespace: data.tx.codespace,
//         log: data.tx.log,
//         events: data.tx.events,
//         data: data.tx.data,
//         hash: data.tx.hash,
//       }
//     } catch (error) {
//       console.error('error in JSON.stringify(data.tx)', error)
//       data.tx = {}
//     }
//   }
//   return data
// }
