import { catchError } from '@src/be/dydx/lib/catchError'
import { defaults } from '@src/be/dydx/constants/defaults'
import { numberOrZero, ohlc4, roundToCustomDecimal } from '@src/lib/numbers'
import Dydx from '.'
import { MarketOrderOutput, MarketOrderInput } from './types'
import { validateInputsMarket } from '@src/be/dydx/lib/validateInputsMarket'
import { cc } from '@my/be/cc'
import { Order } from './methods/getOrders'

export const executeOrderMarket = async (
  input: MarketOrderInput
): Promise<MarketOrderOutput> => {
  const output = {} as unknown as MarketOrderOutput
  const timeStarted = Date.now()
  function timer() {
    output.seconds_passed = (Date.now() - timeStarted) / 1000
  }
  timer()
  cc.log(
    `
  
new executeOrderMarket 
${input.ticker} ${input.side} $${input.dollars} <$${input.dollarsMax} 
  
`,
    input
  )
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
      // Minimum number of coins able to buy/sell. SUI=10. ETH=0.001. Etc.
      output.precision =
        defaults?.[input.ticker]?.precision || defaults?.default?.precision || 1
      cc.log('output.precision', output.precision)
      // Current position
      output.size_current = numberOrZero(positionData?.size)
      cc.log('output.size_current', output.size_current)
      // Max to add/subtract
      output.size_max =
        roundToCustomDecimal(
          input.dollarsMax / output.price,
          output.precision
        ) * (input.side === 'SHORT' ? -1 : 1)
      cc.log('output.size_max', output.size_max)
      // Signed add
      output.size_add =
        roundToCustomDecimal(input.dollars / output.price, output.precision) *
        (input.side === 'SHORT' ? -1 : 1)
      cc.log('output.size_add', output.size_add)
      // If adding would put me over the max
      if (
        (input.side === 'LONG' &&
          output.size_current + output.size_add > output.size_max) ||
        (input.side === 'SHORT' &&
          output.size_current + output.size_add < output.size_max)
      ) {
        // then only add the difference to get to the max and not over
        output.size_add = roundToCustomDecimal(
          output.size_max - output.size_current,
          output.precision
        )
      }
      // Set size_intended (only first time this function is run)
      if (output.size_original === undefined) {
        output.size_original = output.size_current
        output.size_intended = roundToCustomDecimal(
          output.size_original + output.size_add,
          output.precision
        )
      }
      cc.log('output.size_intended', output.size_intended)
      // How much is left to fill
      output.size_unfilled = roundToCustomDecimal(
        output.size_intended - output.size_current,
        output.precision
      )
      cc.log('output.size_unfilled', output.size_unfilled)
      // Finished filling
      output.order_is_filled = Math.abs(output.size_unfilled) < output.precision
      // Reached size_max
      if (
        (input.side === 'LONG' && output.size_current >= output.size_max) ||
        (input.side === 'SHORT' && output.size_current <= output.size_max)
      ) {
        output.order_is_filled = true
        output.message = `Reached maximum position size: ${output.size_max}`
      }
      cc.log('output.order_is_filled', output.order_is_filled)
    }
    async function updatePositionCheckMargin() {
      // Equity
      await updatePosition()
      const accountData = await dydx.getAccount()
      const cashAvailable = numberOrZero(accountData?.freeCollateral)
      // Margin
      output.margin_available = Math.floor(cashAvailable * 9) // 90% of 10x
      output.margin_needed = Math.ceil(output.price * output.size_add)
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
     * Order attempt #2 - limit
     */
    // Get latest price, current position, and margin
    await updatePrice()
    // Check that I have enough available cash margin to place this order
    if (!(await updatePositionCheckMargin())) {
      throw new Error(output.error)
    }
    if (!output.order_is_filled) {
      // Place limit order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderLimit({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: Math.abs(output.size_add),
        price: output.price,
        x1: 0.005,
        reduce: input.dollarsMax === 0,
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
      // Check that I have enough available cash margin to place this order
      if (!(await updatePositionCheckMargin())) {
        throw new Error(output.error)
      }
      // Place limit order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderLimit({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: Math.abs(output.size_add),
        price: output.price,
        x1: 0.01,
        reduce: input.dollarsMax === 0,
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
      // Check that I have enough available cash margin to place this order
      if (!(await updatePositionCheckMargin())) {
        throw new Error(output.error)
      }
      // Place market order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderMarket({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: Math.abs(output.size_add),
        price: output.price,
        reduce: input.dollarsMax === 0,
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
      // Check that I have enough available cash margin to place this order
      if (!(await updatePositionCheckMargin())) {
        throw new Error(output.error)
      }
      // Place market order
      output.order_client_id = Math.ceil(Math.random() * 1000000)
      await dydx.orderMarket({
        clientId: output.order_client_id,
        ticker: input.ticker,
        side: input.side,
        coins: Math.abs(output.size_add),
        price: output.price,
        reduce: input.dollarsMax === 0,
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
     * @returns true if exact match was found (new stop order successfully created)
     */
    const cancelOtherStops = async (size: number, side: 'SHORT' | 'LONG') => {
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
      let foundTheOne = false
      for (let order of orders) {
        // found one with same size! No need to start a new one
        if (
          Math.abs(numberOrZero(order.size)) === size &&
          order.side === side
        ) {
          // do not cancel the first match, return it
          if (!foundTheOne) {
            foundTheOne = true
            continue
          }
          // but if it's not the first, then go on to cancel
        }
        // cancel all other unfilled orders before adding the new one
        await dydx.orderCancel({
          ticker: input.ticker,
          clientId: order.clientId,
        })
      }
      return foundTheOne
    }

    /*
     * Stoploss on the current position
     */
    let whileStopAttemptNumber = 0
    if (output.size_current !== 0) {
      // keep checking after every dydx.orderStop if it was placed
      while (true) {
        whileStopAttemptNumber++
        cc.log(`whileStopAttemptNumber # ${whileStopAttemptNumber}`)
        if (whileStopAttemptNumber > 5) {
          cc.error(
            `whileStopAttemptNumber>5 ${input.ticker} ${input.side} $${input.dollars} size_current:${output.size_current}`,
            output
          )
          break
        }
        // make sure to have stop order opposite of current position
        await updatePosition()
        const stopCoins = Math.abs(output.size_current)
        if (!stopCoins) {
          break
        }
        const stopSide = output.size_current > 0 ? 'SHORT' : 'LONG'
        // cancel other stops
        if (await cancelOtherStops(stopCoins, stopSide)) {
          break
        }
        // create new stop
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

    timer()
    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'executeOrderMarket' })
  }
  timer()
  return output
}
