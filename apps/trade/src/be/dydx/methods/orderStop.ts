import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import { DydxInterface } from '@src/be/dydx'
import { defaults } from '../constants/defaults'
import { cc } from '@my/be/cc'
import { orderAdd } from '@my/be/sql/order/add'
import { catchError } from '@src/be/dydx/lib/catchError'

type Props = {
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  sl?: number
}

export async function orderStop(
  this: DydxInterface,
  { ticker, side, coins, price, sl }: Props
) {
  try {
    coins = Math.abs(coins) // UNLIKE MARKET ORDER WHICH REQUIRES NEGATIVE FOR SHORT ORDERS, STOP LOSS SIZE IS ALWAYS ABSOLUTE
    await cc.info('dydx.orderStop input:', {
      ticker,
      side,
      coins,
      price,
      sl,
    })
    const slDefined =
      sl || defaults?.[ticker]?.[side] || defaults?.default?.[side] || 0.33
    const compositeClient = await this.getCompositeClient()
    const slMultiplier = 1 + (side === 'SHORT' ? -slDefined : slDefined) / 100 // if shorting, trigger price is bellow market
    const triggerPrice = price * slMultiplier
    const clientId = Math.ceil(Math.random() * 1000000)
    const type = OrderType.STOP_MARKET // order type
    const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
    const goodTilTimeInSeconds = 60 * 60 * 24 * 7 // week
    const execution = OrderExecution.IOC // OrderExecution.DEFAULT
    const executionPrice = side === 'LONG' ? 10000000 : 0.01 //= 30_000; // price of 30,000;
    const postOnly = true // If true, order is post only
    const reduceOnly = true // if true, the order will only reduce the position

    // record
    await orderAdd({
      client_id: clientId,
      type: 'STOP_MARKET',
      ticker,
      side,
      size: coins,
      price,
    })

    // place
    await compositeClient.placeOrder(
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
      reduceOnly,
      triggerPrice
    )

    // notify
    await cc.info(
      `order Stop ${side === 'LONG' ? 'Buy' : 'Sell'} ${ticker}  
      $:${(coins * triggerPrice).toString().substring(0, 7)} 
      n:${coins.toString().substring(0, 5)} 
      p:${price.toString().substring(0, 7)} 
      x:${triggerPrice.toString().substring(0, 7)}
      %:${(triggerPrice / price).toString().substring(0, 7)}
      `,
      {
        order: {
          ticker,
          type,
          side: (side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY).toString(),
          executionPrice,
          coins,
          clientId,
          timeInForce,
          goodTilTimeInSeconds,
          execution,
          postOnly,
          reduceOnly,
          triggerPrice,
        },
        input: {
          price,
          slMultiplier,
        },
      },
      {
        category: 'order',
        tag: 'stop',
      }
    )
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    if (err?.message) {
      console.log('catch error dydx.oroderStop', err.message)
    } else {
      catchError(err, { file: 'dydx.orderStop' })
    }
  }
}
