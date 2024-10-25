import { getLogs } from '@my/be/sql/log/get'
import Json from '@my/fe/src/components/blocks/Json'
import Logs from '@src/fe/blocks/Logs'

export const revalidate = 0

export default async function Page({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const where = {} as Record<string, string | string[]>
  const name = searchParams['name'] || ''
  if (name) {
    where.name = name
  }
  const { error, result } = await getLogs({ where })
  if (error) {
    throw error
  }
  if (result?.rows) {
    return <Logs logs={result?.rows} where={where} />
  } else {
    return <Json data={result} />
  }
}
