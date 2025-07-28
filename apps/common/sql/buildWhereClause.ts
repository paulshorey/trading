import { Where } from './types'

type BuildWhereClauseResult = {
  where: string
  params: (string | number)[]
}

/**
 * Builds a SQL WHERE clause from a key-value object.
 *
 * @param where - An object where keys are column names and values are the values to filter by.
 *                If a value is an array, it will be converted to an IN clause.
 *                The special keys `time_start` and `time_end` are used for time-range filtering.
 * @returns A SQL WHERE clause string (e.g., "WHERE name='test' AND category IN ('a','b')").
 */
export function buildWhereClause(where?: Where): BuildWhereClauseResult {
  const result: BuildWhereClauseResult = {
    where: '',
    params: [],
  }
  if (!where || Object.keys(where).length === 0) {
    return result
  }

  const whereArr: string[] = []
  const params: (string | number)[] = []
  let paramIndex = 1

  for (const key in where) {
    const value = where[key]

    if (key === 'time_start' && value) {
      whereArr.push(`time >= $${paramIndex++}`)
      params.push(Number(value))
    } else if (key === 'time_end' && value) {
      whereArr.push(`time <= $${paramIndex++}`)
      params.push(Number(value))
    } else if (key === 'search' && value) {
      whereArr.push(
        `(message ILIKE $${paramIndex++} OR stack ILIKE $${paramIndex++})`
      )
      params.push(`%${value}%`, `%${value}%`)
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        const placeholders = value.map(() => `$${paramIndex++}`).join(',')
        whereArr.push(`${key} IN (${placeholders})`)
        params.push(...value)
      }
    } else if (value !== undefined && value !== null) {
      whereArr.push(`${key} = $${paramIndex++}`)
      params.push(value as string)
    }
  }

  if (whereArr.length === 0) {
    return result
  }

  result.where = `WHERE ${whereArr.join(' AND ')}`
  result.params = params
  return result
}
