import { getLogs } from '@my/be/sql/log/get'
import Data from '../fe/blocks/Data'

export const revalidate = 0

export default async function () {
  let data = {} as Record<string, any>
  try {
    const where = { name: 'trade-scout' }
    const { error, result } = await getLogs({ where })

    if (error) {
      data['log get error'] = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    if (result.rows) {
      for (let row of result.rows) {
        data[row.id] = row
      }
    }

    // @ts-ignore
  } catch (error: Error) {
    data['catch error'] = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return <Data data={data} />
}
