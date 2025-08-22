import { OrderExecution, OrderType, OrderTimeInForce, OrderSide } from '@dydxprotocol/v4-client-js'
import { sqlLogAdd } from '@apps/data/sql/log/add'
import { orderAdd } from '@apps/data/sql/order/add'
import { DydxInterface } from '@/dydx'
import { catchError } from '@/dydx/lib/catchError'

type Props = {
  clientId: number
  ticker: string
  side: 'SHORT' | 'LONG'
  coins: number
  price: number
  reduceOnly?: boolean
}

export async function orderMarket(this: DydxInterface, { clientId, ticker, side, coins, price, reduceOnly }: Props) {
  try {
    const compositeClient = await this.getCompositeClient()
    const type = OrderType.MARKET // order type
    const timeInForce = OrderTimeInForce.IOC // UX TimeInForce (GTT old, IOC maybe new better)
    const goodTilTimeInSeconds = 20 // 20 seconds
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
      amount: coins * price,
      price,
    })

    // place
    try {
      compositeClient.placeOrder(this.subaccount, ticker, type, side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY, executionPrice, coins, clientId, timeInForce, goodTilTimeInSeconds, execution, postOnly, reduceOnly)
    } catch (error: any) {
      await sqlLogAdd({
        name: 'error',
        message: 'Error in orderMarket: ' + error.message,
        stack: error.stack,
      })
    }

    // notify
    await sqlLogAdd({
      name: 'warn',
      message: `order Market ${side === 'LONG' ? 'Buy' : 'Sell'} ${ticker} ${reduceOnly ? 'reduce' : ''}
      $:${(coins * price).toString().substring(0, 7)} 
      @:${price.toString().substring(0, 7)}
`,
      stack: {
        order: {
          ticker,
          type,
          side: (side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY).toString(),
          coins: coins.toPrecision(5),
          executionPrice,
          clientId,
          timeInForce,
          goodTilTimeInSeconds,
          execution,
          postOnly,
          reduceOnly,
        },
        input: {
          side,
          coins,
          price,
          reduceOnly,
        },
      },
      category: 'order',
      tag: 'place',
    })
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'dydx.orderMarket' })
  }
}
