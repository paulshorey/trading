'use server'

import { catchError } from '@/dydx/lib/catchError'
import { defaults } from '@/dydx/constants/defaults'
import { numberOrZero, ohlc4, roundToCustomDecimal } from '@/lib/numbers'
import Dydx from '.'
import { MarketOrderOutput, MarketOrderInput } from './types'
import { validateInputsMarket } from '@/dydx/lib/validateInputsMarket'
import { cc } from '@apps/data/cc'

export const executeOrderMarket = async (input: MarketOrderInput): Promise<MarketOrderOutput> => {
  'use server'
  const output = {} as unknown as MarketOrderOutput
  const timeStarted = Date.now()
  function timer() {
    output.seconds_passed = (Date.now() - timeStarted) / 1000
  }
  timer()
  cc.log(
    `
  
new executeOrderMarket 
${input.ticker} $${input.position} ${input.sl ? '/' + input.sl : ''}`,
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
    await dydx.init()

    /*
     * Helpers
     */
    async function updatePosition() {
      const positionData = (await dydx.getPositions(input.ticker, 'OPEN'))?.[0]
      // Minimum number of coins able to buy/sell. SUI=10. ETH=0.001. Etc.
      output.precision = defaults?.[input.ticker]?.precision || defaults?.default?.precision || 1
      // Current position
      output.size_current = numberOrZero(positionData?.size)
      // Intended position
      if (output.size_original === undefined) {
        output.size_original = output.size_current
        output.size_intended = roundToCustomDecimal(input.position / output.price, output.precision, 'down')
        cc.log('output.size_intended', output.size_intended)
      }
      // How much to add
      if (output.size_intended === output.size_current) {
        output.size_unfilled = 0
        output.order_is_filled = true
        output.message = `Position already at ${output.size_intended}`
      } else {
        output.size_unfilled = roundToCustomDecimal(output.size_intended - output.size_current, output.precision, 'up')
      }
      cc.log('output.size_unfilled', output.size_unfilled)
      // Side
      if (output.size_unfilled > 0) {
        output.side = 'LONG'
      } else if (output.size_unfilled < 0) {
        output.side = 'SHORT'
      }
      // Filled to top
      const unfilled = Math.abs(output.size_unfilled)
      output.order_is_filled = unfilled < output.precision || unfilled * output.price < 15
      cc.log('output.order_is_filled', output.order_is_filled)
    }
    async function updatePositionCheckMargin() {
      // Equity
      await updatePosition()
      const accountData = await dydx.getAccount()
      const cashAvailable = numberOrZero(accountData?.freeCollateral)
      if (!cashAvailable) {
        throw new Error('updatePositionCheckMargin() !cashAvailable')
      }
      // Margin
      output.margin_available = Math.floor(cashAvailable * 9) // 90% of 10x
      output.margin_needed = Math.ceil(output.price * output.size_unfilled)
      // Not enough margin!
      // if (output.margin_available < output.margin_needed) {
      //   output.error = `Not enough margin: ${output.margin_needed} > ${output.margin_available}`
      //   output.order_is_filled = true // can not fill any more, stop everything!
      //   return false
      // }
      // Enough, continue
      return true
    }
    async function updatePrice() {
      const candles = await dydx.getCandles(input.ticker, '1MIN', 60)
      output.price = numberOrZero(candles?.[0]?.close)
      output.hourly = [ohlc4(candles?.[0]), ohlc4(candles?.[59])]
      if (output.price === 0) {
        throw new Error('Price is 0. Indexer must be down.')
      }
    }

    // /*
    //  * Order attempt #1 - limit
    //  */
    // // Get latest price, current position, and margin
    // await updatePrice()
    // // Check that I have enough available cash margin to place this order
    // if (!(await updatePositionCheckMargin())) {
    //   throw new Error(output.error)
    // }
    // // New position = wait, in case there are outstanding orders still processing
    // // if (output.size_intended > output.size_original) {
    // //   await cancelOtherStops()
    // // }
    // // #1 order attempt, updatePrice() and updatePositionCheckMargin()
    // // must go outside of !output.order_is_filled check
    // if (!output.order_is_filled) {
    //   // Place limit order
    //   if (output.size_unfilled) {
    //     output.order_client_id = Math.ceil(Math.random() * 1000000)
    //     await dydx.orderLimit({
    //       clientId: output.order_client_id,
    //       ticker: input.ticker,
    //       side: output.side,
    //       coins: Math.abs(output.size_unfilled),
    //       price: output.price,
    //       reduceOnly: output.size_intended === 0,
    //       x1: 0.005,
    //     })
    //     output.order_is_filled = false
    //     timer()
    //     // check that it's filled
    //     await new Promise((resolve) =>
    //       setTimeout(async () => {
    //         await updatePosition()
    //         resolve(true)
    //       }, 15000)
    //     )
    //     timer()
    //   }
    // }

    // /*
    //  * Order attempt #2 - limit
    //  */
    // if (!output.order_is_filled) {
    //   // Get latest price, current position, and margin
    //   await updatePrice()
    //   // Check that I have enough available cash margin to place this order
    //   if (!(await updatePositionCheckMargin())) {
    //     throw new Error(output.error)
    //   }
    //   // Place limit order
    //   if (output.size_unfilled) {
    //     output.order_client_id = Math.ceil(Math.random() * 1000000)
    //     await dydx.orderLimit({
    //       clientId: output.order_client_id,
    //       ticker: input.ticker,
    //       side: output.side,
    //       coins: Math.abs(output.size_unfilled),
    //       price: output.price,
    //       reduceOnly: output.size_intended === 0,
    //       x1: 0.01,
    //     })
    //     output.order_is_filled = false
    //     timer()
    //     // check that it's filled
    //     await new Promise((resolve) =>
    //       setTimeout(async () => {
    //         await updatePosition()
    //         resolve(true)
    //       }, 15000)
    //     )
    //     timer()
    //   }
    // }

    /*
     * Order attempt #3 - market
     */
    if (!output.order_is_filled) {
      // Get latest price, current position, and margin
      await updatePrice()
      // Check that I have enough available cash margin to place this order
      if (!(await updatePositionCheckMargin())) {
        throw new Error(output.error)
      }
      // Place market order
      if (output.size_unfilled) {
        output.order_client_id = Math.ceil(Math.random() * 1000000)
        await dydx.orderMarket({
          clientId: output.order_client_id,
          ticker: input.ticker,
          side: output.side,
          coins: Math.abs(output.size_unfilled),
          price: output.price,
          reduceOnly: output.size_intended === 0,
        })
        output.order_is_filled = false
        timer()
        // check that it's filled
        await new Promise((resolve) =>
          setTimeout(async () => {
            timer()
            await updatePosition()
            resolve(true)
          }, 20000)
        )
        timer()
      }
    }

    // /*
    //  * Order attempt #4 - market
    //  */
    // if (!output.order_is_filled) {
    //   // Get latest price, current position, and margin
    //   await updatePrice()
    //   // Check that I have enough available cash margin to place this order
    //   if (!(await updatePositionCheckMargin())) {
    //     throw new Error(output.error)
    //   }
    //   // Place market order
    //   if (output.size_unfilled) {
    //     output.order_client_id = Math.ceil(Math.random() * 1000000)
    //     await dydx.orderMarket({
    //       clientId: output.order_client_id,
    //       ticker: input.ticker,
    //       side: output.side,
    //       coins: Math.abs(output.size_unfilled),
    //       price: output.price,
    //       reduceOnly: output.size_intended === 0,
    //     })
    //     output.order_is_filled = false
    //     timer()
    //     // check that it's filled
    //     await new Promise((resolve) =>
    //       setTimeout(async () => {
    //         timer()
    //         await updatePosition()
    //         resolve(true)
    //       }, 15000)
    //     )
    //     timer()
    //   }
    // }

    /**
     * Is it filled successfully?
     */
    if (!output.order_is_filled) {
      cc.warn(`order could not be filled ${input.ticker} ${output.side} ${output.size_original}/${output.size_unfilled}/${output.size_intended} $:${output.size_unfilled * output.price} @:${output.price}`, output)
    }

    /**
     * Cancel any old stop orders that are not exactly like the new one (or all if unspecified)
     * @returns true if exact match was found (new stop order successfully created)
     */
    // async function cancelOtherStops(size?: number, side?: 'SHORT' | 'LONG') {
    //   // get all open orders
    //   const orders = await dydx.getOrders(
    //     input.ticker,
    //     true,
    //     (order) => order.type.substring(0, 4) === 'STOP'
    //   )
    //   // find the same size stop order, to avoid creating a duplicate new one
    //   let foundTheOne = false
    //   for (let order of orders) {
    //     // found one with same size! No need to start a new one
    //     if (
    //       Math.abs(numberOrZero(order.size)) === size &&
    //       order.side === side
    //     ) {
    //       // do not cancel the first match, return it
    //       if (!foundTheOne) {
    //         foundTheOne = true
    //         continue
    //       }
    //       // but if it's not the first, then go on to cancel
    //     }
    //     // cancel all other unfilled orders before adding the new one
    //     await dydx.orderCancel({
    //       ticker: input.ticker,
    //       clientId: order.clientId,
    //       orderType: order.type,
    //     })
    //   }
    //   return foundTheOne
    // }

    /*
     * Stoploss on the current position
     */
    // let whileStopAttemptNumber = 0
    // if (output.size_current !== 0) {
    //   // keep checking after every dydx.orderStop if it was placed
    //   while (true) {
    //     whileStopAttemptNumber++
    //     cc.log(`whileStopAttemptNumber # ${whileStopAttemptNumber}`)
    //     if (whileStopAttemptNumber > 5) {
    //       cc.error(
    //         `whileStopAttemptNumber>5 ${input.ticker} ${output.side} $${input.position} size_current:${output.size_current}`,
    //         output
    //       )
    //       break
    //     }
    //     // make sure to have stop order opposite of current position
    //     await updatePosition()
    //     const stopCoins = Math.abs(output.size_current)
    //     if (!stopCoins) {
    //       break
    //     }
    //     const stopSide = output.size_current > 0 ? 'SHORT' : 'LONG'
    //     // create new stop
    //     await dydx.orderStop({
    //       ticker: input.ticker,
    //       side: stopSide,
    //       coins: stopCoins,
    //       price: output.price,
    //       sl: input.sl,
    //     })
    //     timer()
    //     // wait 10 seconds for the new stop order to take effect
    //     await new Promise((resolve) =>
    //       setTimeout(async () => {
    //         resolve(true)
    //       }, 10000)
    //     )
    //     timer()
    //     // cancel other stops
    //     if (await cancelOtherStops(stopCoins, stopSide)) {
    //       break
    //     }
    //   }
    // }

    timer()
  } catch (err: any) {
    catchError(err, { file: 'executeOrderMarket' })
  }
  timer()
  return output
}
