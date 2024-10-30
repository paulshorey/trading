import { catchError } from '@src/be/dydx/lib/catchError'
import { isNumber } from '../../lib/numbers'
import { defaults } from '@src/be/dydx/constants/notes/defaults'
import { numberOrZero } from '@src/lib/numbers'
import Dydx from '.'
import { MarketOrderOutput, MarketOrderProps } from './types'
import { validateInputsMarket } from '@src/be/dydx/lib/validateInputsMarket'

export const dydxPlaceOrderMarket = async (
  input: MarketOrderProps
): Promise<MarketOrderOutput> => {
  const output = {} as MarketOrderOutput
  const timeNow = Date.now()
  output.seconds_passed = (Date.now() - timeNow) / 1000
  try {
    /*
     * Validate Inputs
     */
    validateInputsMarket(input, output)

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
    if (output.price === 0) {
      throw new Error('Price is 0. Indexer must be down.')
    }
    const daily0 = output.daily?.[0] || 0
    const daily1 = output.daily?.[1] || 0
    output.price_direction = daily0 < daily1 ? 'down' : 'up' // daily[0] is most recent
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
      const positions = await dydx.getPositions(input.ticker, 'OPEN')
      const size_current = positions?.[0]?.size
      output.size_unfilled = output.size_intended - size_current
      output.size_filled = size_current - output.size_original
      output.size_is_filled = Math.abs(output.size_unfilled * output.price) < 10
    }

    /*
     * Place order
     */
    await dydx.placeOrderMarket({
      ticker: input.ticker,
      side: input.side,
      size: output.size_absolute,
      price: output.price,
    })
    output.size_is_filled = false
    output.seconds_passed = (Date.now() - timeNow) / 1000

    /*
     * Check 10
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 10000)
      )
    }

    /*
     * Check 20
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 20000)
      )
    }

    /*
     * Check 30
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 30000)
      )
    }

    /*
     * Check 40
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 40000)
      )
    }

    /*
     * Check 50
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 50000)
      )
    }

    /*
     * Check 60
     */
    if (!output.size_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await checkIfFilled()
          resolve(true)
        }, 60000)
      )
    }

    /*
     * Stoploss on the filled portion
     */
    if (output.size_filled) {
      await dydx.placeOrderStop({
        ticker: input.ticker,
        side: input.side === 'LONG' ? 'SHORT' : 'LONG',
        size: Math.abs(output.size_filled),
        price: output.price,
        debugData: output,
      })
    }

    /*
     * Order unfilled
     */
    // output.seconds_passed = (Date.now() - timeNow) / 1000
    // if (!output.size_is_filled) {
    //   output.seconds_passed_cancelled = (Date.now() - timeNow) / 1000
    //   // cancel stoploss
    //   // await dydx.placeOrderCancel({
    //   //   ticker: input.ticker,
    //   //   side: input.side,
    //   //   orderId: orderIdStoploss,
    //   //   data: output,
    //   // })
    //   // // cancel order
    //   // await dydx.placeOrderCancel({
    //   //   ticker: input.ticker,
    //   //   side: input.side,
    //   //   orderId,
    //   //   data: output,
    //   // })
    // }

    output.seconds_passed = (Date.now() - timeNow) / 1000
    // @ts-ignore
  } catch (err: Error) {
    catchError(err)
  }
  return output
}
