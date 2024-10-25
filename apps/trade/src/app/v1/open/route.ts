import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { add } from '@my/be/sql/log/add'
// import { dydxScout } from '@src/be/dydx/scout'

type RouteParams = {
  params: {
    type: string
  }
}

const handler = async (request: NextRequest, { params }: RouteParams) => {
  try {
    let bodyData
    let bodyText = ''
    const contentType = request.headers.get('Content-Type')
    if (contentType && contentType.includes('form')) {
      bodyData = Object.fromEntries(await request.formData())
    } else {
      bodyText = await request.text()
    }

    // const data = dydxScout()
    const log = await add('trade-scout', bodyText, { data: bodyData })
    return formatResponse({
      ok: true,
      log,
      // data,
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

export async function POST(request: NextRequest, { params }: RouteParams) {
  return handler(request, { params })
}
