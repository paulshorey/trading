import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { logAdd } from '@my/be/sql/log/add'

export const catchError = async (
  error: Error,
  options: Record<string, any> = {}
) => {
  console.error(`${options.file || 'be/dydx/lib'} catchError`, error)
  // Error
  const message =
    `catch in dydx: ` +
    (typeof error?.message === 'string' ? error?.message : '!message')
  // notify sms
  sendToMyselfSMS(message)
  // notify log
  await logAdd('error', message, {
    name: error.name,
    message: error.message,
    stack: error.stack,
  })
}
