import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { addLog } from '@my/be/sql/log/add'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { dydxTest } from '@src/be/dydx/test'
// import { dydxScout } from '@src/be/dydx/scout'

const handler = async (request: NextRequest) => {
  try {
    let bodyData
    let bodyText = ''
    const contentType = request.headers.get('Content-Type')
    if (contentType && contentType.includes('form')) {
      bodyData = Object.fromEntries(await request.formData())
    } else {
      bodyText = (await request.text()) || ''
    }
    let access_key = request.nextUrl.searchParams.get('access_key')
    // if (!access_key) throw new Error('!access_key')
    // if (
    //   !(access_key === 'itisverysecretddd' || access_key === 'postmansecret')
    // ) {
    //   throw new Error('wrong access_key')
    // }

    // notify sms
    // sendToMyselfSMS(`${bodyText} tvline#${access_key}`)

    // notify log
    const log = await addLog('trade-tvline', bodyText + '...' + access_key, {
      data: bodyData,
    })

    // trade
    // if (bodyText.trim() === 'buy-1-sol') {
    //   await dydxTest({
    //     ticker: 'NEAR-USD',
    //     side: 'LONG',
    //     size: 1,
    //   })
    // } else if (bodyText.trim() === 'sell-1-sol') {
    //   await dydxTest({
    //     ticker: 'NEAR-USD',
    //     side: 'SHORT',
    //     size: 1,
    //   })
    // }

    // api response
    return formatResponse({
      ok: true,
      // data,
      log,
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

//, { params }: RouteParams
//, { params }
//, { params }: RouteParams
// type RouteParams = {
//   params: {
//     type: string
//   }
// }
export async function POST(request: NextRequest) {
  return handler(request)
}
