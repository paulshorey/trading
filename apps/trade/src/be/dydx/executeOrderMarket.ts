import { catchError } from '@src/be/dydx/lib/catchError'
import { defaults } from '@src/be/dydx/constants/defaults'
import { numberOrZero, ohlc4 } from '@src/lib/numbers'
import Dydx from '.'
import { MarketOrderOutput, MarketOrderProps } from './types'
import { validateInputsMarket } from '@src/be/dydx/lib/validateInputsMarket'
import { cc } from '@my/be/cc'
import { Order } from './methods/getOrders'

export const executeOrderMarket = async (
  input: MarketOrderProps
): Promise<MarketOrderOutput> => {
  const output = {
    order_is_filled: false,
    coins_unfilled: 0,
    size_current: 0,
    coins_intended: 0,
    coins_add: 0,
    coins_stop_order: 0,
  } as unknown as MarketOrderOutput
  const timeStarted = Date.now()
  function timer() {
    output.seconds_passed = (Date.now() - timeStarted) / 1000
  }
  timer()
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
     * Helpers
     */
    async function updatePosition() {
      const positionData = (await dydx.getPositions(input.ticker, 'OPEN'))?.[0]
      output.size_current = numberOrZero(positionData?.size)
      output.coins_unfilled = output.size_intended - output.size_current
      output.order_is_filled =
        Math.abs(output.coins_unfilled * output.price) < 10
    }
    async function updateFloorCheckMargin() {
      // Size
      const floor =
        defaults?.[input.ticker]?.floor || defaults?.default?.floor || 1
      output.coins_add =
        Math.floor(input.dollars / output.price / floor) * floor
      output.size_intended =
        output.size_current +
        (input.side === 'LONG' ? output.coins_add : -output.coins_add)
      // Equity
      const accountData = await dydx.getAccount()
      const cashAvailable = numberOrZero(accountData?.freeCollateral)
      // Margin
      output.margin_available = cashAvailable * 9 // 90% of 10x
      output.margin_needed = output.price * output.coins_add
      // Not enough margin!
      if (output.margin_available < output.margin_needed) {
        output.error = `Not enough margin: ${output.margin_needed} > ${output.margin_available}`
        output.order_is_filled = true // can not fill any more, stop everything!
        return false
      }
      // Enough, continue
      return true
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
     * Order attempt #1 - limit
     */
    // Get latest price, current position, and margin
    await updatePrice()
    await updatePosition()
    // Check that I have enough available cash margin to place this order
    if (!updateFloorCheckMargin()) {
      throw new Error(output.error)
    }
    // Place limit order
    output.order_client_id = Math.ceil(Math.random() * 1000000)
    await dydx.orderLimit({
      clientId: output.order_client_id,
      ticker: input.ticker,
      side: input.side,
      coins: output.coins_add,
      price: output.price,
      x1: 0.0001,
    })
    output.order_is_filled = false
    timer()
    // check that it's filled
    await new Promise((resolve) =>
      setTimeout(async () => {
        await updatePosition()
        resolve(true)
      }, 15000)
    )
    timer()

    /*
     * Order attempt #2 - limit
     */
    if (!output.order_is_filled) {
      // Get latest price, current position, and margin
      await updatePrice()
      await updatePosition()
      // Check that I have enough available cash margin to place this order
      if (!updateFloorCheckMargin()) {
        throw new Error(output.error)
      }
      // Place limit order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderLimit({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: output.coins_add,
        price: output.price,
        x1: 0.001,
      })
      output.order_is_filled = false
      timer()
      // check that it's filled
      await new Promise((resolve) =>
        setTimeout(async () => {
          await updatePosition()
          resolve(true)
        }, 15000)
      )
      timer()
    }

    /*
     * Order attempt #3 - limit
     */
    if (!output.order_is_filled) {
      // Get latest price, current position, and margin
      await updatePrice()
      await updatePosition()
      // Check that I have enough available cash margin to place this order
      if (!updateFloorCheckMargin()) {
        throw new Error(output.error)
      }
      // Place limit order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderLimit({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: output.coins_add,
        price: output.price,
        x1: 0.01,
      })
      output.order_is_filled = false
      timer()
      // check that it's filled
      await new Promise((resolve) =>
        setTimeout(async () => {
          await updatePosition()
          resolve(true)
        }, 15000)
      )
      timer()
    }

    /*
     * Order attempt #4 - market
     */
    if (!output.order_is_filled) {
      // Get latest price, current position, and margin
      await updatePrice()
      await updatePosition()
      // Check that I have enough available cash margin to place this order
      if (!updateFloorCheckMargin()) {
        throw new Error(output.error)
      }
      // Place market order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderMarket({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: output.coins_add,
        price: output.price,
      })
      output.order_is_filled = false
      timer()
      // check that it's filled
      await new Promise((resolve) =>
        setTimeout(async () => {
          timer()
          await updatePosition()
          resolve(true)
        }, 15000)
      )
      timer()
    }

    /*
     * Order attempt #5 - market
     */
    if (!output.order_is_filled) {
      // Get latest price, current position, and margin
      await updatePrice()
      await updatePosition()
      // Check that I have enough available cash margin to place this order
      if (!updateFloorCheckMargin()) {
        throw new Error(output.error)
      }
      // Place market order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderMarket({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: output.coins_add,
        price: output.price,
      })
      output.order_is_filled = false
      timer()
      // check that it's filled
      await new Promise((resolve) =>
        setTimeout(async () => {
          timer()
          await updatePosition()
          resolve(true)
        }, 15000)
      )
      timer()
    }

    /**
     * Cancel any old stop orders that are not exactly like the new one
     * @returns order with same size as new one, or undefined if none found
     */
    const findSameStopOrder = async (
      size: number,
      side: 'SHORT' | 'LONG'
    ): Promise<Order | undefined> => {
      // get all open orders
      const orders = await dydx.getOrders(
        input.ticker,
        (order) =>
          order.type.substring(0, 4) === 'STOP' &&
          (order.status === 'UNTRIGGERED' ||
            order.status === 'OPEN' ||
            order.status === 'UNFILLED') // && order.side !== input.side
      )
      // find the same size stop order, to avoid creating a duplicate new one
      return orders.find((order) => {
        // found one with same size! No need to start a new one
        if (
          Math.abs(numberOrZero(order.size)) === size &&
          order.side === side
        ) {
          return true
        } else {
          // cancel all other unfilled orders before adding the new one
          dydx.orderCancel({
            ticker: input.ticker,
            clientId: order.clientId,
          })
          return false
        }
      })
    }

    /*
     * Stoploss on the current position
     */
    await updatePrice()
    let whileStopAttemptNumber = 0
    if (output.size_current !== 0) {
      output.coins_stop_order = 0
      // keep checking after every dydx.orderStop if it was placed
      while (!output.coins_stop_order) {
        whileStopAttemptNumber++
        // make sure to have stop order opposite of current position
        const stopCoins = Math.abs(output.size_current)
        const stopSide = output.size_current > 0 ? 'SHORT' : 'LONG'
        // try to find an existing order with same exact parameters
        const stopOrder = await findSameStopOrder(stopCoins, stopSide)
        if (stopOrder) {
          // if found done, else place another
          output.coins_stop_order = stopCoins
        } else {
          // create new order if none found with same parameters
          await dydx.orderStop({
            ticker: input.ticker,
            side: stopSide,
            coins: stopCoins,
            price: output.price,
            sl: input.sl,
          })
          timer()
          // wait 10 seconds for the new stop order to take effect
          await new Promise((resolve) =>
            setTimeout(async () => {
              resolve(true)
            }, 10000)
          )
          timer()
        }
      }
    }

    timer()
    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'executeOrderMarket' })
  }
  timer()
  return output
}
