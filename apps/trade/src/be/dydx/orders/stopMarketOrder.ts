import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'

type Props = {
  compositeClient: any
  subaccount: any
  ticker: string
  side: 'SHORT' | 'LONG'
  size: number
  triggerPrice: number
}

export const stopMarketOrder = ({
  compositeClient,
  subaccount,
  ticker,
  side,
  size: sizeAbs,
  triggerPrice,
}: Props) => {
  const size = side === 'LONG' ? sizeAbs : -sizeAbs
  const orderId = Math.ceil(Math.random() * 1000000)
  const type = OrderType.STOP_MARKET // order type
  const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
  const goodTilTimeInSeconds = 60 * 60 * 24 * 7 // week
  const execution = OrderExecution.IOC // OrderExecution.DEFAULT
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
    reduceOnly,
    triggerPrice
  )
  sendToMyselfSMS(
    `stopMarketOrder: ${ticker} ${side} ${size
      .toString()
      .substring(0, 5)} ${triggerPrice.toString().substring(0, 5)}`
  )
  return orderId
}
