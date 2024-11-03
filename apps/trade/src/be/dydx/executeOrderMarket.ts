import { catchError } from '@src/be/dydx/lib/catchError'
import { defaults } from '@src/be/dydx/constants/defaults'
import { numberOrZero, ohlc4 } from '@src/lib/numbers'
import Dydx from '.'
import { MarketOrderOutput, MarketOrderProps } from './types'
import { validateInputsMarket } from '@src/be/dydx/lib/validateInputsMarket'
import { cc } from '@my/be/cc'

export const dydxPlaceOrderMarket = async (
  input: MarketOrderProps
): Promise<MarketOrderOutput> => {
  const output = {} as MarketOrderOutput
  const timeNow = Date.now()
  output.seconds_passed = (Date.now() - timeNow) / 1000
  cc.log('dydx.orderMarket inputs:', input)
  try {
    /*
     * Validate Inputs
     */
    validateInputsMarket(input, output)

    /*
     * Connection
     */
    const dydx = new Dydx()
    async function updatePosition() {
      const positionData = (await dydx.getPositions(input.ticker, 'OPEN'))?.[0]
      output.coins_current = numberOrZero(positionData?.size)
      output.coins_unfilled = output.coins_intended - output.coins_current
      output.coins_is_filled =
        Math.abs(output.coins_unfilled * output.price) < 10
    }
    async function updateMargin() {
      const accountData = await dydx.getAccount()
      output.margin_available = numberOrZero(accountData?.freeCollateral) * 9 // 90% of 10x
      if (input.dollars > output.margin_available) {
        output.error = `Not enough margin: $${input.dollars} > ${output.margin_available}`
        throw new Error(output.error)
      }
      output.margin_needed = output.price * output.coins_add
      output.enough_margin =
        output.margin_available > output.price * output.coins_add
      if (!output.enough_margin) {
        output.error = `Not enough margin: ${output.margin_needed} > ${output.margin_available}`
      }
      return output.enough_margin
    }
    async function updatePrice() {
      const candles = await dydx.getCandles(input.ticker, '1HOUR', 48)
      output.price = numberOrZero(candles?.[0]?.close)
      output.hourly = [ohlc4(candles?.[0]), ohlc4(candles?.[1])]
      output.daily = [ohlc4(candles?.[23]), ohlc4(candles?.[47])]
      if (output.price === 0) {
        throw new Error('Price is 0. Indexer must be down.')
      }
    }

    /*
     * Fetch Data
     */
    await updatePrice()
    await updatePosition()
    output.coins_original = output.coins_current
    const floor =
      defaults?.[input.ticker]?.floor || defaults?.default?.floor || 1
    output.coins_add = Math.floor(input.dollars / output.price / floor) * floor
    output.coins_intended =
      output.coins_current +
      (input.side === 'LONG' ? output.coins_add : -output.coins_add)

    /*
     * Validate
     */
    if (!updateMargin()) {
      throw new Error(output.error)
    }

    /*
     * Cancel old stop orders
     */
    const orders = await dydx.getOrders(
      input.ticker,
      (order) =>
        order.type.substring(0, 4) === 'STOP' && order.status === 'UNTRIGGERED' // && order.side !== input.side
    )
    for (let order of orders) {
      dydx.orderCancel({
        ticker: input.ticker,
        clientId: order.clientId,
      })
    }
    cc.info('orders', orders)

    /*
     * Place new market order
     */
    output.order_client_id = Math.ceil(Math.random() * 1000000)
    await dydx.orderMarket({
      clientId: output.order_client_id,
      ticker: input.ticker,
      side: input.side,
      coins: output.coins_add,
      price: output.price,
    })
    output.coins_is_filled = false
    output.seconds_passed = (Date.now() - timeNow) / 1000

    /*
     * Check 10
     */
    if (!output.coins_is_filled) {
      await new Promise((resolve) =>
        setTimeout(async () => {
          await updatePosition()
          resolve(true)
        }, 10000)
      )
    }

    // /*
    //  * Check 20
    //  */
    // if (!output.coins_is_filled) {
    //   await new Promise((resolve) =>
    //     setTimeout(async () => {
    //       await updatePosition()
    //       resolve(true)
    //     }, 20000)
    //   )
    // }

    // /*
    //  * Check 30
    //  */
    // if (!output.coins_is_filled) {
    //   await new Promise((resolve) =>
    //     setTimeout(async () => {
    //       await updatePosition()
    //       resolve(true)
    //     }, 30000)
    //   )
    // }

    /*
     * Stoploss on the filled portion
     */
    if (output.coins_current) {
      await dydx.orderStop({
        ticker: input.ticker,
        side: output.coins_current > 0 ? 'SHORT' : 'LONG',
        coins: Math.abs(output.coins_current),
        price: output.price,
        sl: input.sl,
      })
    }

    /*
     * Cancel unfilled portion
     */
    if (output.coins_unfilled) {
      dydx.orderCancel({
        ticker: input.ticker,
        clientId: output.order_client_id,
        short: true,
      })
    }

    output.seconds_passed = (Date.now() - timeNow) / 1000
    // @ts-ignore
  } catch (err: Error) {
    catchError(err)
  }
  return output
}
