import { cc } from '@my/be/cc'

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
  cc.error(message, {
    name: error.name,
    message: error.message,
    stack: error.stack,
  })
}
