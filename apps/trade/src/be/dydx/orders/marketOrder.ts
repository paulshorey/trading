import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import type { CompositeClient } from '@dydxprotocol/v4-client-js/build/src/clients/composite-client.d.ts'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'

type Props = {
  compositeClient: CompositeClient
  subaccount: any
  ticker: string
  side: 'SHORT' | 'LONG'
  size: number
  price: number
}

export const marketOrder = ({
  compositeClient,
  subaccount,
  ticker,
  side,
  size,
  price,
}: Props) => {
  const orderId = Math.ceil(Math.random() * 1000000)
  const type = OrderType.MARKET // order type
  const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
  const goodTilTimeInSeconds = Date.now() / 1000 + 60 * 5 // epoch seconds
  const execution = OrderExecution.DEFAULT
  const executionPrice = side === 'LONG' ? 10000000 : 0.01 //= 30_000; // price of 30,000;
  const postOnly = true // If true, order is post only
  const reduceOnly = false // if true, the order will only reduce the position size
  compositeClient.placeOrder(
    subaccount,
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
  sendToMyselfSMS(
    `marketOrder: ${ticker} ${side} ${size.toString().substring(0, 5)} ${price
      .toString()
      .substring(0, 5)}`
  )
  return orderId
}
