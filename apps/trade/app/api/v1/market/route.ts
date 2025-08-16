import { NextRequest, NextResponse } from 'next/server'
import { formatResponse } from '@apps/data/next/lib/formatResponse'
import { executeOrderMarket } from '@/dydx/executeOrderMarket'
import { parseOrdersText } from '@/dydx/lib/parseOrdersText'
import { sqlLogAdd } from '@apps/data/sql/log/add'
import { MarketOrderOutput } from '@/dydx/types'
import { sendToMyselfSMS } from '@apps/data/twillio/sendToMyselfSMS'

export const maxDuration = 60

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let bodyData
    let bodyText = ''
    const contentType = request.headers.get('Content-Type')
    if (contentType && contentType.includes('form')) {
      bodyData = Object.fromEntries(await request.formData())
    } else {
      bodyText = await request.text()
    }

    let access_key = request.nextUrl.searchParams.get('access_key')
    if (!access_key) throw new Error('!access_key')
    if (!(access_key === 'testkeyx' || access_key === 'postmansecret')) {
      throw new Error('wrong access_key')
    }

    try {
      // dydx status
      const parsedOrders = parseOrdersText(bodyText)
      if (!parsedOrders[0]) {
        // relay message to myself
        sendToMyselfSMS(bodyText)
        // log to db
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
            message: '!parsedOrders[0]',
            parsedOrders,
          },
          405
        )
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

      // @ts-ignore
    } catch (error: Error) {
      await sqlLogAdd({
        name: 'error',
        message: `${bodyText} failed with error: ${error.message}`,
        stack: {
          error: error.stack,
          bodyText,
          bodyData,
        },
      })
      return formatResponse({ error: error.message }, 500)
    }

    // @ts-ignore
  } catch (error: Error) {
    await sqlLogAdd({ name: 'error', message: error.message, stack: error.stack })
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
