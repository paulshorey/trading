import { NextRequest } from 'next/server'
import { formatResponse } from '@my/be/api/formatResponse'
import { addLog } from '@my/be/sql/log/add'

type RouteParams = {
  params: {
    type: string
  }
}

const handler = async (request: NextRequest, { params }: RouteParams) => {
  try {
    const type = params.type
    const qs = Object.fromEntries(request.nextUrl.searchParams.entries())

    let body
    const contentType = request.headers.get('Content-Type')
    if (contentType && contentType.includes('form')) {
      body = Object.fromEntries(await request.formData())
    } else {
      body = await request.text()
    }
    if (typeof body === 'string' && body.length > 0) {
      try {
        body = JSON.parse(body)
      } catch (error) {
        // not json
      }
    }

    // const access_key =
    //   request.nextUrl.searchParams.get('access_key') ||
    //   request.headers.get('x-access_key') ||
    //   ''

    // @ts-ignore
    const data = await addLog(type, qs.q || qs.title || qs.message || '', body)
    return formatResponse({
      saved: true,
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
    return formatResponse({ saved: false, error: errorMessage }, 500)
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return handler(request, { params })
}
