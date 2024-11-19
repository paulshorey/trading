import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import { cc } from '@my/be/cc'
import { orderAdd } from '@my/be/sql/order/add'
import { DydxInterface } from '@src/be/dydx'
import { catchError } from '@src/be/dydx/lib/catchError'

type Props = {
  clientId?: number
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  /**
   * Fraction of 1%
   */
  x1: number
}

export async function orderReduce(
  this: DydxInterface,
  { clientId, ticker, side, coins, price, x1 }: Props
) {
  try {
    await cc.info('dydx.orderReduce input:', { ticker, side, coins, price })
    const compositeClient = await this.getCompositeClient()
    const type = OrderType.LIMIT // order type
    const timeInForce = OrderTimeInForce.IOC // UX TimeInForce
    const goodTilTimeInSeconds = 15 // 20 seconds
    const execution = OrderExecution.DEFAULT
    const multiplier = 1 + (side === 'LONG' ? x1 : -x1) // buy high / sell low
    const executionPrice = price * multiplier
    const reduceOnly = true
    const postOnly = false
    clientId = clientId || Math.ceil(Math.random() * 1000000)

    // record
    orderAdd({
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
    let action = side === 'LONG' ? ('warn' as const) : ('info' as const)
    await cc[action](
      `order Limit ${side === 'LONG' ? 'Buy' : 'Sell'} ${ticker} ${
        reduceOnly ? 'reduce' : ''
      }  
      $:${(coins * price).toString().substring(0, 7)} 
      n:${coins.toString().substring(0, 5)} 
      p:${price.toString().substring(0, 7)} 
      x:${executionPrice.toString().substring(0, 7)}
      %:${(executionPrice / price).toString().substring(0, 7)}
      `,
      { ticker, side, coins, price },
      {
        category: 'order',
        tag: 'place',
      }
    )
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'dydx.orderReduce' })
  }
}
