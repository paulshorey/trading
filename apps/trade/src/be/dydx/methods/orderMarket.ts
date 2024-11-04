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
import { catchError } from '@src/be/dydx/lib/catchError'

type Props = {
  clientId: number
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  reduce?: boolean
}

export async function orderMarket(
  this: DydxInterface,
  { clientId, ticker, side, coins, price, reduce }: Props
) {
  try {
    await cc.info('dydx.orderMarket input:', { ticker, side, coins, price })
    const compositeClient = await this.getCompositeClient()
    const type = OrderType.MARKET // order type
    const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
    const goodTilTimeInSeconds = 15 // 20 seconds
    const execution = OrderExecution.DEFAULT
    const executionPrice = side === 'LONG' ? 10000000 : 0.01
    const postOnly = false
    const reduceOnly = !!reduce

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
      `dydx.orderMarket: ${ticker} ${side} ${reduceOnly ? 'reduce' : ''}
      n:${coins.toString().substring(0, 5)} 
      p:${price.toString().substring(0, 7)}`,
      { ticker, side, coins, price }
    )
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'dydx.orderMarket' })
  }
}
