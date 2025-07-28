'use server'

import { headers } from 'next/headers'
import { sqlQuery } from '../sqlQuery'
import { pool } from '../pool/events'
import { cc } from '../../cc'
import { LogRowGet } from './types'
import { buildWhereClause } from '../buildWhereClause'
import { Where } from '../types'

type Output = {
  ip?: string
  rows?: LogRowGet[]
  error?: {
    name: string
    message: string
    stack: string
  }
}

type Props = {
  where?: Where
}

export const logGets = async function ({ where }: Props = {}): Promise<Output> {
  'use server'

  const output = {} as Output
  const headersList = headers()
  const ip =
    headersList.get('x-forwarded-for') ||
    headersList.get('remote-addr') ||
    'IP not available'

  try {
    const { where: whereSQL, params } = buildWhereClause(where)
    const result = await sqlQuery(
      pool,
      `SELECT * FROM logs_v1 ${whereSQL} ORDER BY time DESC LIMIT 100`,
      params
    )
    output.ip = ip
    output.rows = result.rows
    //@ts-ignore - this Error type is correct
  } catch (e: any) {
    try {
      const error = {
        name: 'Error lib/sql/logsGet.ts catch',
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      }
      output.error = error
      cc.error('sql/log/gets Error', error)
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(e)
    }
  }
  return output
}
