import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import type { CompositeClient } from '@dydxprotocol/v4-client-js/build/src/clients/composite-client.d.ts'
import { logAdd } from '@my/be/sql/log/add'
import { DydxInterface } from '@src/be/dydx'

type Props = {
  ticker: string
  side: 'SHORT' | 'LONG'
  size: number
  price: number
}

export async function orderMarket(
  this: DydxInterface,
  { ticker, side, size, price }: Props
) {
  const compositeClient = await this.getCompositeClient()
  const orderId = Math.ceil(Math.random() * 1000000)
  const type = OrderType.MARKET // order type
  const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
  const goodTilTimeInSeconds = Date.now() / 1000 + 60 * 5 // epoch seconds
  const execution = OrderExecution.DEFAULT
  const executionPrice = side === 'LONG' ? 10000000 : 0.01 //= 30_000; // price of 30,000;
  const postOnly = true // If true, order is post only
  const reduceOnly = false // if true, the order will only reduce the position size
  compositeClient.placeOrder(
    this.subaccount,
    ticker,
    type,
    side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY,
    executionPrice,
    size,
    orderId,
    timeInForce,
    goodTilTimeInSeconds,
    execution,
    postOnly,
    reduceOnly
  )
  // notify
  await logAdd(
    'info',
    `marketOrder: ${ticker} ${side} ${size.toString().substring(0, 5)} ${price
      .toString()
      .substring(0, 5)}`,
    { ticker, side, size, price },
    { sms: true }
  )
  return orderId
}
