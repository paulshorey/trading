import { DydxInterface } from '@src/be/dydx'
import { cc } from '@my/be/cc'
import { numberOrZero } from '../../../lib/numbers'
// import { catchError } from '@src/be/dydx/lib/catchError'

type Props = {
  short?: boolean
  ticker: string
  clientId: number
  orderType?: string
}

export async function orderCancel(this: DydxInterface, input: Props) {
  try {
    const clientId = numberOrZero(input.clientId)
    if (!clientId) throw new Error('dydx.orderCancel !clientId')
    const compositeClient = await this.getCompositeClient()
    // cancel
    if (input.short) {
      // short term (MARKET)
      const indexerClient = await this.getIndexerClient()
      const block = await indexerClient.utility.getHeight()
      const blockHeight = Number(block.height)
      if (!blockHeight || isNaN(blockHeight)) {
        throw new Error('blockHeight is NaN')
      }
      await compositeClient.cancelOrder(
        this.subaccount,
        clientId,
        0,
        input.ticker,
        blockHeight + 15
      )
    } else {
      // stateful order (STOP_MARKET)
      await compositeClient.cancelOrder(
        this.subaccount,
        clientId,
        32,
        input.ticker,
        0,
        60 * 60 * 24 * 7
      )
    }
    // notify
    await cc.info(
      `order Cancel`,
      {
        ticker: input.ticker,
        clientId,
        type: input.orderType,
      },
      {
        category: 'order',
        tag: 'cancel',
      }
    )
    // done
    return clientId

    // @ts-ignore
  } catch (err: Error) {
    // catchError(err, { file: 'dydx.orderCancel' })
  }
}
