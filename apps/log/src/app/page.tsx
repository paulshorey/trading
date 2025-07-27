import { logGets } from '@my/be/sql/log/gets'
import { LogsWrapper } from '@src/list/components/data/LogsWrapper'

export const revalidate = 0

export default async function Page({
  params,
  searchParams,
}: {
  params: {}
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const where: Record<string, any> = {}

  if (searchParams.name) where.name = searchParams.name
  if (searchParams.category) where.category = searchParams.category
  if (searchParams.tag) where.tag = searchParams.tag
  if (searchParams.app_name) where.app_name = searchParams.app_name
  if (searchParams.server_name) where.server_name = searchParams.server_name
  if (searchParams.dev !== undefined) where.dev = searchParams.dev === 'true'

  if (searchParams.time_start) {
    where.time_start = Number(searchParams.time_start)
  }

  if (searchParams.time_end) {
    where.time_end = Number(searchParams.time_end)
  }

  try {
    const { error, result } = await logGets({ where })
    if (error) {
      throw error
    }
    let logs = result?.rows || []
    logs = logs.filter((log) => log.tag !== 'place')
    return <LogsWrapper logs={logs} where={where} />
  } catch (error) {
    console.error(error)
    throw error
  }
}
