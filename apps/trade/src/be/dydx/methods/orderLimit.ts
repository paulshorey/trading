import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import type { CompositeClient } from '@dydxprotocol/v4-client-js/build/src/clients/composite-client.d.ts'
import { cc } from '@my/be/cc'
import { orderAdd } from '@my/be/sql/order/add'
import { DydxInterface } from '@src/be/dydx'
import { orderToHash } from '@src/lib/numbers'
import { catchError } from '@src/be/dydx/lib/catchError'

type Props = {
  clientId: number
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  /**
   * Fraction of 1%
   */
  x1: number
}

export async function orderLimit(
  this: DydxInterface,
  { clientId, ticker, side, coins, price, x1 }: Props
) {
  try {
    await cc.info('dydx.orderLimit input:', { ticker, side, coins, price })
    const compositeClient = await this.getCompositeClient()
    const type = OrderType.LIMIT // order type
    const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
    const goodTilTimeInSeconds = 15 // 20 seconds
    const execution = OrderExecution.DEFAULT
    const multiplier = 1 + (side === 'LONG' ? x1 : -x1) // buy high / sell low
    const executionPrice = price * multiplier
    const postOnly = false
    const reduceOnly = false

    // record
    await orderAdd({
      client_id: clientId,
      type: 'LIMIT',
      ticker,
      side,
      size: coins,
      price,
    })

    // place
    compositeClient.placeOrder(
      this.subaccount,
      ticker,
      type,
      side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY,
      executionPrice,
      coins,
      clientId,
      timeInForce,
      goodTilTimeInSeconds,
      execution,
      postOnly,
      reduceOnly
    )

    // notify
    await cc.warn(
      `dydx.orderLimit: ${ticker} ${side} n:${coins.toString().substring(0, 5)} 
      p:${price.toString().substring(0, 7)} 
      x:${executionPrice.toString().substring(0, 7)}
      %:${(executionPrice / price).toString().substring(0, 7)}
      `,
      { ticker, side, coins, price }
    )
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'dydx.orderLimit' })
  }
}
