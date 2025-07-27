import { logGets } from '@my/be/sql/log/gets'
import { LogsWrapper } from '@src/list/components/data/LogsWrapper'

export const revalidate = 0

export default async function Page({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const awaitedSearchParams = await searchParams
  const where: Record<string, any> = {}

  if (awaitedSearchParams.name) where.name = awaitedSearchParams.name
  if (awaitedSearchParams.category)
    where.category = awaitedSearchParams.category
  if (awaitedSearchParams.tag) where.tag = awaitedSearchParams.tag
  if (awaitedSearchParams.app_name)
    where.app_name = awaitedSearchParams.app_name
  if (awaitedSearchParams.server_name)
    where.server_name = awaitedSearchParams.server_name
  if (awaitedSearchParams.dev !== undefined)
    where.dev = awaitedSearchParams.dev === 'true'

  if (awaitedSearchParams.time_start) {
    where.time_start = Number(awaitedSearchParams.time_start)
  }

  if (awaitedSearchParams.time_end) {
    where.time_end = Number(awaitedSearchParams.time_end)
  }

  try {
    const { error, result } = await logGets({ where })
    if (error) {
      console.error(error)
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
