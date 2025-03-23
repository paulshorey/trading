import { formatResponse } from '@my/be/api/formatResponse'

export const maxDuration = 60

export async function POST() {
  return formatResponse({ ok: true, method: 'POST', time: new Date().toISOString() }, 200)
}
export async function GET() {
  return formatResponse({ ok: true, method: 'GET', time: new Date().toISOString() }, 200)
}
