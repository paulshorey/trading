import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import { logAdd } from '@my/be/sql/log/add'
import { DydxInterface } from '@src/be/dydx'

type Props = {
  ticker: string
  side: 'SHORT' | 'LONG'
  size: number
  price: number
  debugData: Record<string, any>
}

export async function orderStop(
  this: DydxInterface,
  { ticker, side, size: sizeAbs, price, debugData }: Props
) {
  const compositeClient = await this.getCompositeClient()
  const slMultiplier = 1 + (side === 'SHORT' ? -sizeAbs : sizeAbs) / 100 // if shorting, trigger price is bellow market
  const triggerPrice = price * slMultiplier
  const size = side === 'SHORT' ? -sizeAbs : sizeAbs // if shorting, size is negative
  const orderId = Math.ceil(Math.random() * 1000000)
  const type = OrderType.STOP_MARKET // order type
  const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
  const goodTilTimeInSeconds = 60 * 60 * 24 * 7 // week
  const execution = OrderExecution.IOC // OrderExecution.DEFAULT
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
    reduceOnly,
    triggerPrice
  )
  // notify
  await logAdd(
    'info',
    `placeOrderStop: ${ticker} ${side} ${size
      .toString()
      .substring(0, 5)} ${triggerPrice.toString().substring(0, 5)}`,
    {
      order: {
        ticker,
        type,
        side: (side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY).toString(),
        executionPrice,
        size,
        orderId,
        timeInForce,
        goodTilTimeInSeconds,
        execution,
        postOnly,
        reduceOnly,
        price,
        slMultiplier,
        triggerPrice,
      },
      debugData,
    }
    // { sms: true }
  )
  return orderId
}
