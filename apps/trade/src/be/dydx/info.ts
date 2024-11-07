import {
  OrderExecution,
  OrderSide,
  OrderType,
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  OrderTimeInForce,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { sendToMyselfSMS } from '@my/be/twillio/sendToMyselfSMS'
import { logAdd } from '@my/be/sql/log/add'
import { Order } from '@src/be/dydx/methods/getOrders'
import Dydx from '@src/be/dydx'
import { numberOrZero } from '@src/lib/numbers'
import { getCandles } from '@src/be/dydx/methods/getCandles'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Output = Record<string, any>

/**
 * Throws error if something went wrong!
 */
export const dydxScout = async (): Promise<Output | undefined> => {
  const output = {
    account: {},
    data: {},
  } as Output
  try {
    /*
     * Connection
     */
    const dydx = new Dydx()
    await sleep(300)
    /*
     * Account
     */
    const accountData = await dydx.getAccount()
    const cashAvailable = numberOrZero(accountData?.freeCollateral)
    if (!cashAvailable) {
      throw new Error('updatePositionCheckMargin() !cashAvailable')
    }
    // Margin
    output.account.equity = numberOrZero(Number(accountData.equity).toFixed(2))
    output.account.margin = numberOrZero(
      numberOrZero(accountData?.freeCollateral).toFixed(2)
    )
    // Positions
    const positions = accountData.openPerpetualPositions || {}
    output.account.positions = {}
    // output.data.positions = positions
    // console.log('positions', positions)
    // Orders
    const orders = await dydx.getOrders(undefined, true)
    output.data.orders = orders
    // Order per position
    for (let ticker in positions) {
      const raw = positions[ticker]
      const position = {} as Record<string, any>
      output.account.positions[ticker] = position
      position.to_stoploss = 0
      position.dollars = 0
      // Price
      let candles = await dydx.getCandles(ticker, '1MIN', 1)
      // position.side = raw.side
      position.price = numberOrZero(candles[0]?.close)
      position.size = numberOrZero(raw.size)
      position.dollars = Math.round(position.size * position.price)
      // Entry price
      // const entryPrice = Number(
      //   numberOrZero(raw.entryPrice).toString().substring(0, 7)
      // )
      // const entry = Math.round(numberOrZero(raw.size) * entryPrice)
      // position.pnl = (position.price - entryPrice) * raw.size
      // position.entry = entry
      // position.percent = entry + position.pnl
      // position.entryPrice = entryPrice
      // Orders
      position.orders = {}
      let position_sl = 0
      let sl_size_total = 0
      for (let ord of orders) {
        if (ord.ticker === ticker) {
          let order = {} as Record<string, any>
          position.orders[
            `${ord.type.toLowerCase()} ${
              ord.status === 'UNTRIGGERED' ? '' : ord.status
            }`
          ] = order
          order.price = numberOrZero(ord.triggerPrice)
          // order.side = ord.side
          order.size =
            Math.abs(numberOrZero(ord.size)) * (ord.side === 'LONG' ? 1 : -1)
          // sl
          if (ord.type.substring(0, 4) === 'STOP') {
            // instead of averaging all stop loss amounts,
            // simply record the sl value for the largest order
            if (!position_sl || order.size > sl_size_total) {
              position_sl = order.price
            }
            // increment order size after calculating sl value
            sl_size_total += order.size
          }
        }
      }
      position.___ORDERS_SIZE_LEFTOVER___THIS_SHOULD_BE_ZERO___ =
        (position.size + sl_size_total) / position.size
      if (
        !position.___ORDERS_SIZE_LEFTOVER___THIS_SHOULD_BE_ZERO___ ||
        position.___ORDERS_SIZE_LEFTOVER___THIS_SHOULD_BE_ZERO___ < 0.01
      ) {
        delete position.___ORDERS_SIZE_LEFTOVER___THIS_SHOULD_BE_ZERO___
      }

      // PNL vs SL
      const pnl_sl = ((position.price - position_sl) / position_sl) * -100
      if (position.size > 0) {
        position.to_stoploss =
          ' ' + Math.abs(pnl_sl).toFixed(2).replace('0.', '.') + '  %'
      }
      if (position.size < 0) {
        position.to_stoploss =
          ' ' + Math.abs(pnl_sl).toFixed(2).replace('0.', '.') + '  %'
      }

      // Cleanup before returning
      // position.percent = Number(
      //   ((position.percent / position.entry) * 100).toFixed(2)
      // )
      // position.pnl = Math.round(position.pnl)
      // position.entry = Math.round(position.entry)
    }

    // @ts-ignore
  } catch (err: Error) {
    // Error
    const message =
      'DYDX Error! in scout ' +
      (typeof err?.message === 'string' ? err?.message : 'unknown')
    // notify sms
    sendToMyselfSMS(message)
    // notify log
    await logAdd('error', message, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }
  return output
}
