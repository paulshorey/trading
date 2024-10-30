import { catchError } from '@src/be/dydx/lib/catchError'
import { MarketOrderProps, MarketOrderOutput } from './types'
import { numberOrZero } from '@src/lib/numbers'
import Dydx from '.'
import { validateInputsMarket } from '@src/be/dydx/lib/validateInputsMarket'

/**
 * Requires same exact inputs as Market order.
 */
export const dydxPlaceOrderStop = async (
  input: MarketOrderProps
): Promise<MarketOrderOutput> => {
  const output = {} as MarketOrderOutput
  try {
    /*
     * Validate Inputs
     */
    validateInputsMarket(input, output)
    output.inputs = input

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

    /*
     * Place stoploss @ current price
     */
    await dydx.placeOrderStop({
      ticker: input.ticker,
      side: input.side,
      size: output.size_absolute,
      price: output.price,
      sl: input.sl,
      debugData: output,
    })

    // @ts-ignore
  } catch (err: Error) {
    catchError(err)
  }
  return output
}
