import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { add } from '@my/be/sql/log/add'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { dydxScout } from '@src/be/dydx/scout'

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

    // notify sms
    // sendToMyselfSMS(bodyText || 'no text in request')

    // dydx status
    const data = dydxScout()

    // notify log
    const log = await add('trade-scout', bodyText, { data: bodyData })

    // api response
    return formatResponse({
      ok: true,
      data,
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
