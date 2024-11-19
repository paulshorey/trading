export function log001(value: number) {
  const logValue = Math.log10(1 + value * 99) / Math.log10(100)
  return logValue
}

export function roundToCustomDecimal(
  number: number,
  precision: number,
  upDown?: 'up' | 'down'
): number {
  const factor = Math.pow(10, -Math.log10(precision))
  if (upDown === 'up') return Math.ceil(number * factor) / factor
  if (upDown === 'down') return Math.floor(number * factor) / factor
  return Math.round(number * factor) / factor
}

/**
 * Because JS isNaN and Number can't be trusted with whitespace, null, and boolean!
 * Fun fact:
 * Number() actually removes any whitespace (including special codes) before converting,
 * and isNaN() uses Number() internally, so it does the same thing before checking!
 */
export const isNumber = function (val: any): boolean {
  if (val === undefined) return false
  if (typeof val === 'object' || typeof val === 'boolean') return false // null, true, false
  let str = val.toString().trim()
  if (!str) return false // '', '\n', ' ', ' 0 ', '\n 0 \t', etc.
  let num = Number(str)
  if (isNaN(num)) return false // obvious non-numeric characters
  return true
}

/**
 * Does not check, but simply forces a value to be a number (if not Number then zero)
 */
export const numberOrZero = function (val: any): number {
  return isNumber(val) ? Number(val) : 0
}

/**
 * One way hash a string into a number.
 */
// export function stringToHash(str: string): number {
//   let hash = 0
//   for (let i = 0; i < str.length; i++) {
//     const charCode = str.charCodeAt(i)
//     hash = (hash << 5) - hash + charCode
//     hash |= 0 // Convert to 32-bit integer
//   }
//   return hash
// }
// type HashableOrder = {
//   type: string
//   ticker: string
//   side: 'LONG' | 'SHORT'
// }
// export function orderToHash(data: HashableOrder): number {
//   return stringToHash(`${data.type}:${data.ticker}:${data.side}`)
// }

type Candle = {
  open: number
  high: number
  low: number
  close: number
}
export const ohlc4 = function (c: Candle): number {
  return (
    (Number(c?.close || 0) +
      Number(c?.open || 0) +
      Number(c?.high || 0) +
      Number(c?.low || 0)) /
    4
  )
}
