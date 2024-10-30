import {
  OrderExecution,
  OrderType,
  OrderTimeInForce,
  OrderSide,
} from '@dydxprotocol/v4-client-js'
import type { CompositeClient } from '@dydxprotocol/v4-client-js/build/src/clients/composite-client.d.ts'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import type { IndexerClient } from '@dydxprotocol/v4-client-js/build/src/clients/indexer-client.d.ts'
import { logAdd } from '@my/be/sql/log/add'
import { DydxInterface } from '@src/be/dydx'
import { orderMarket } from '@src/be/dydx/methods/orderMarket'

type Props = {
  ticker: string
  side: 'SHORT' | 'LONG'
  orderId: number
  data: any
}

export async function orderCancel(
  this: DydxInterface,
  { ticker, side, orderId, data }: Props
) {
  const indexerClient = await this.getIndexerClient()
  const compositeClient = await this.getCompositeClient()
  // cancel order needs blockheight
  const block = await indexerClient.utility.getHeight()
  const blockHeight = Number(block.height)
  if (!blockHeight || isNaN(blockHeight)) {
    throw new Error('blockHeight is NaN')
  }
  // cancel attempted
  compositeClient.cancelOrder(
    this.subaccount,
    orderId,
    0,
    ticker,
    blockHeight + 15
  )
  // notify
  await logAdd(
    'info',
    `dydx.orderCancel: ${ticker} ${side} ${orderId} Intended:${data.size_intended} Unfilled:${data.size_remaining}`,
    {
      ticker,
      side,
      orderId,
      ...data,
    }
  )
}
