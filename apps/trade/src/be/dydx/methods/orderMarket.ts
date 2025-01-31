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
  clientId: number
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  reduceOnly?: boolean
}

export async function orderMarket(
  this: DydxInterface,
  { clientId, ticker, side, coins, price, reduceOnly }: Props
) {
  try {
    const compositeClient = await this.getCompositeClient()
    const type = OrderType.MARKET // order type
    const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
    const goodTilTimeInSeconds = 15 // 20 seconds
    const execution = OrderExecution.DEFAULT
    const executionPrice = side === 'LONG' ? 10000000 : 0.01
    const postOnly = false
    reduceOnly = !!reduceOnly // default false

    // record
    await orderAdd({
      client_id: clientId,
      type: 'MARKET',
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
      `order Market ${side === 'LONG' ? 'Buy' : 'Sell'} ${ticker} ${
        reduceOnly ? 'reduce' : ''
      }`,
      {
        ticker,
        side,
        coins: coins.toPrecision(5),
        price: price.toPrecision(7),
        amount: (coins * price).toPrecision(5),
      },
      {
        category: 'order',
        tag: 'place',
      }
    )
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'dydx.orderMarket' })
  }
}
