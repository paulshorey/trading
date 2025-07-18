import { logGets } from '@my/be/sql/log/get'
import { LogsWrapper } from '@src/fe/blocks/LogsWrapper'
import { Log } from '@src/types'

export const revalidate = 0

export default async function Page({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const where: Record<string, any> = {}
  const validFilters = [
    'name',
    'category',
    'tag',
    'app_name',
    'server_name',
    'dev',
  ]

  for (const key of validFilters) {
    if (searchParams[key] !== undefined) {
      if (key === 'dev') {
        where[key] = searchParams[key] === 'true'
      } else {
        where[key] = searchParams[key]
      }
    }
  }

  try {
    const { error, result } = await logGets({ where })
    if (error) {
      throw error
    }
    let logs = (result?.rows as Log[]) || []
    logs = logs.filter((log) => log.tag !== 'place')
    return <LogsWrapper logs={logs} where={where} />
  } catch (error) {
    console.error(error)
    throw error
  }
}
