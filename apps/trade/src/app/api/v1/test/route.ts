import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { dydxTest } from '@src/be/dydx/test'
import { parseLine } from '@src/be/tv/parseLine'
// import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
// import { addLog } from '@my/be/sql/log/add'
// import { hash } from 'crypto'

export const maxDuration = 70

const handler = async (request: NextRequest) => {
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

    // dydx status
    const trades = parseLine(bodyText)
    const trade = trades[0]
    const data = await dydxTest(trade)
    fixDydxDataTx(data)

    // api response
    if (data?.error) {
      return formatResponse(
        {
          ok: false,
          data,
          message: data.error,
        },
        405
      )
    }
    return formatResponse({
      ok: true,
      data,
    })

    // @ts-ignore
  } catch (error: Error) {
    let errorMessage = 'Something went wrong'
    const stackArray = error?.stack?.split('\n') || []
    const stackInfo = stackArray.find((line: string) => line?.includes('.ts:'))
    if (error instanceof Error) {
      errorMessage = stackArray.length
        ? stackArray[0] + stackInfo
        : error.message
    }
    return formatResponse({ error: errorMessage }, 500)
  }
}

export async function POST(request: NextRequest) {
  return handler(request)
}

// process.on('uncaughtException', async (err) => {
//   const message = `Uncaught Exception: ${
//     err?.message ? err.message : err.toString()
//   }`
//   console.error(message, err)
//   sendToMyselfSMS(message)
//   await addLog('trade-error', message, {
//     str: err?.toString(),
//     json: JSON.stringify(err),
//   })
//   return formatResponse({ error: 'Uncaught Exception' }, 500)
// })
// process.on('unhandledRejection', async (reason, promise) => {
//   const message = `Unhandled Rejection: ${reason ? reason : promise.toString()}`
//   console.error(message, promise, 'reason:', reason)
//   sendToMyselfSMS(message)
//   await addLog('trade-error', message, {
//     str: reason?.toString(),
//     json: JSON.stringify(reason),
//   })
//   return formatResponse({ error: 'Unhandled Rejection' }, 500)
// })

function fixDydxDataTx(data: any) {
  if (typeof data?.tx === 'object' && data?.tx !== null) {
    try {
      if (data.tx.data)
        data.tx.data = btoa(String.fromCharCode.apply(null, data.tx.data))
      if (data.tx.hash)
        data.tx.hash = btoa(String.fromCharCode.apply(null, data.tx.hash))
      data.tx = {
        code: data.tx.code,
        codespace: data.tx.codespace,
        log: data.tx.log,
        events: data.tx.events,
        data: data.tx.data,
        hash: data.tx.hash,
      }
    } catch (error) {
      console.error('error in JSON.stringify(data.tx)', error)
      data.tx = {}
    }
  }
  return data
}
