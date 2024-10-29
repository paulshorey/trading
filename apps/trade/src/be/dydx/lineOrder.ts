import { catchError } from '@src/be/dydx/lib/catchError'
import { isNumber } from '../../lib/numbers'
import { MarketOrderProps } from '@src/be/types'
import { defaults } from '@src/be/dydx/constants/notes/defaults'
import { numberOrZero } from '@src/lib/numbers'
import Dydx from '.'
import { orderCancel } from './methods/orderCancel'

type MarketOrderOutput = {
  error: string
  price: number
  daily: number[]
  direction: string
  size_original: number
  margin_available: number
  size_absolute: number
  size_add: number
  size_intended: number
  margin_needed: number
  enough_margin: boolean
  size_unfilled: number
  size_filled: number
  size_is_filled: boolean
}

export const dydxLineOrder = async (
  input: MarketOrderProps
): Promise<MarketOrderOutput> => {
  const output = {} as MarketOrderOutput
  try {
    /*
     * Validate Inputs
     */
    input.dollar = Math.abs(numberOrZero(input.dollar))
    if (!input.ticker || !input.side || !input.dollar) {
      output.error = 'bad input: !ticker | !side | !dollar'
      throw new Error(output.error)
    }
    if (!/[A-Z]-USD/.test(input.ticker)) {
      output.error = 'malformed input: ticker="' + input.ticker + '"'
      throw new Error(output.error)
    }
    if (input.side !== 'SHORT' && input.side !== 'LONG') {
      output.error = 'malformed input: side="' + input.side + '"'
      throw new Error(output.error)
    }
    if (!input.sl || !isNumber(input.sl)) {
      // @ts-ignore
      const stoploss = defaults?.[input.ticker]?.[input.side]
      input.sl = stoploss || 0.33
    }

    /*
     * Connection
     */
    const dydx = new Dydx()

    /*
     * Fetch Data
     */
    const candles = await dydx.getCandles(input.ticker, '1DAY', 2)
    output.price = numberOrZero(candles?.[0]?.close)
    output.daily = Array.from([
      ...new Set(
        candles.map(
          (c: any) =>
            (Number(c?.close || 0) +
              Number(c?.open || 0) +
              Number(c?.high || 0) +
              Number(c?.low || 0)) /
            4
        )
      ),
    ]) as number[]
    // @ts-ignore
    output.direction = output.daily?.[0] < output.daily?.[1] ? 'down' : 'up' // daily[0] is most recent
    const accountData = await dydx.getAccount()
    const positionData = accountData?.openPerpetualPositions[input.ticker]
    output.margin_available = numberOrZero(accountData?.freeCollateral) * 9 //(90% of 10x)
    if (input.dollar > output.margin_available) {
      output.error = `Not enough margin: $${input.dollar} > ${output.margin_available}`
      throw new Error(output.error)
    }
    output.size_original = numberOrZero(positionData?.size)
    output.size_absolute = input.dollar / output.price
    output.size_add =
      input.side === 'LONG' ? output.size_absolute : -output.size_absolute
    output.size_intended = output.size_original + output.size_add

    /*
     * Validate data
     */
    output.margin_needed = output.price * output.size_absolute
    output.enough_margin =
      output.margin_available > output.price * output.size_absolute
    if (!output.enough_margin) {
      output.error = `Not enough margin: ${output.margin_needed} > ${output.margin_available}`
      throw new Error(output.error)
    }
    async function checkIfFilled() {
      const newPositionSize = ((
        await dydx.getPositions(input.ticker, 'OPEN')
      )?.[0]).size
      output.size_unfilled = output.size_intended - newPositionSize
      output.size_filled = newPositionSize - output.size_original
      // IDK DYDX compositeClient's logic, so just guess when it has finished (less than $x)
      return output.size_unfilled * output.price < 10
    }

    /*
     * Place order
     */
    const orderId = await dydx.placeOrderMarket({
      ticker: input.ticker,
      side: input.side,
      size: output.size_absolute,
      price: output.price,
    })
    output.size_is_filled = false

    /*
     * Check 1
     */
    if (!output.size_is_filled) {
      output.size_is_filled = await new Promise((resolve) =>
        setTimeout(async () => {
          resolve(await checkIfFilled())
        }, 5000)
      )
    }

    /*
     * Check 2
     */
    if (!output.size_is_filled) {
      output.size_is_filled = await new Promise((resolve) =>
        setTimeout(async () => {
          resolve(await checkIfFilled())
        }, 10000)
      )
    }

    /*
     * Check 3
     */
    if (!output.size_is_filled) {
      output.size_is_filled = await new Promise((resolve) =>
        setTimeout(async () => {
          resolve(await checkIfFilled())
        }, 15000)
      )
    }

    /*
     * Place stoploss
     */
    if (output.size_is_filled) {
      await dydx.placeOrderStop({
        ticker: input.ticker,
        side: input.side === 'LONG' ? 'SHORT' : 'LONG',
        size: output.size_absolute,
        price: output.price,
        debugData: output,
      })
    }

    /*
     * Order unfilled
     */
    if (!output.size_is_filled) {
      await dydx.placeOrderCancel({
        ticker: input.ticker,
        side: input.side,
        orderId,
        data: output,
      })
    }

    // @ts-ignore
  } catch (err: Error) {
    catchError(err)
  }
  return output
}
