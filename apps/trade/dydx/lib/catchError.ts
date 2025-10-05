import { sqlLogAdd } from '@lib/common/sql/log/add'

export const catchError = async (error: Error, options: Record<string, any> = {}) => {
  // error
  const message = `${options.file || 'trade/dydx'} catch error ${options.bodyText ? `\n${options.bodyText}` : ''}`
  // notify
  console.error(message, error)
  sqlLogAdd({
    name: 'error',
    message,
    stack: error || {},
  })
}
