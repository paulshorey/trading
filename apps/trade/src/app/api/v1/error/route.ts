import { formatResponse } from '@my/be/api/formatResponse'
import { logAdd } from '@my/be/sql/log/add'
import { sendToMyselfSMS } from '@my/be/twillio/sendToMyselfSMS'
import { NextRequest } from 'next/server'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  // @ts-expect-error - intentional error
  return formatResponse({ ok: true, method: 'POST', time: new Date().toISOString(), breakIntentionally: request.idk }, 200)
}
export async function GET(request: NextRequest) {
  // @ts-expect-error - intentional error
  return formatResponse({ ok: true, method: 'GET', time: new Date().toISOString(), breakIntentionally: request.idk }, 200)
}

process.on('uncaughtException', async (err) => {
  const message = `Uncaught Exception: ${err?.message ? err.message : err.toString()}`
  console.error(message, err)
  sendToMyselfSMS(message)
  await logAdd({
    name: 'error',
    message,
    stack: {
      str: err?.toString(),
      json: JSON.stringify(err),
    },
  })
  return formatResponse({ error: 'Uncaught Exception' }, 500)
})

process.on('unhandledRejection', async (reason, promise) => {
  const message = `Unhandled Rejection: ${reason ? reason : promise.toString()}`
  console.error(message, promise, 'reason:', reason)
  sendToMyselfSMS(message)
  await logAdd({
    name: 'error',
    message,
    stack: {
      str: reason?.toString(),
      json: JSON.stringify(reason),
    },
  })
  return formatResponse({ error: 'Unhandled Rejection' }, 500)
})
