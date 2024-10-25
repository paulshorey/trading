import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { dydxScout } from '@src/be/dydx/scout'
import { add } from '@my/be/sql/log/add'

type RouteParams = {
  params: {
    type: string
  }
}

const handler = async (request: NextRequest, { params }: RouteParams) => {
  try {
    const data = dydxScout()
    // const log = await add(body, {
    //   'trade-scout',
    //   access_key,
    //   message: qs.q || qs.title || qs.message,
    // })
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

export async function GET(request: NextRequest, { params }: RouteParams) {
  return handler(request, { params })
}
