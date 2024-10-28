import {
  // OrderExecution,
  // OrderSide,
  // OrderType,
  // OrderTimeInForce,
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { addLog } from '@my/be/sql/log/add'
import { marketOrder } from './orders/market'
import { getPosition as getPositionRaw } from './actions/getPosition'
import { catchError } from '@src/be/dydx/actions/catchError'
import { stopMarketOrder } from '@src/be/dydx/orders/stopMarket'

type Output = Record<string, any> | undefined

export const dydxTestMarket = async ({
  ticker,
  side,
  num,
}: {
  ticker: string
  side: 'SHORT' | 'LONG'
  num: number
}) => {
  const data = {} as Record<string, any>
  try {
    /*
     * Inputs
     */
    if (!ticker || !side || !num || isNaN(Number(num))) {
      data.error = 'bad input: !ticker | !side | !num'
      throw new Error(data.error)
    }
    if (!/[A-Z]-USD/.test(ticker)) {
      data.error = 'malformed input: ticker="' + ticker + '"'
      throw new Error(data.error)
    }
    if (side !== 'SHORT' && side !== 'LONG') {
      data.error = 'malformed input: side="' + side + '"'
      throw new Error(data.error)
    }
    const size = side === 'LONG' ? num : -num // ignore sign, use side LONG or SHORT
    data.size_add = size
    data.size_intended = data.size_before + data.size_add

    /*
     * Connection
     */
    const NETWORK = Network.mainnet()
    const wallet = await LocalWallet.fromMnemonic(
      process.env.DYDX_MNEMONIC || '',
      BECH32_PREFIX
    )
    const subaccount = new SubaccountClient(wallet, 0)
    const composite = {
      client: await CompositeClient.connect(NETWORK),
      subaccount,
    }
    const indexer = {
      client: new IndexerClient(NETWORK.indexerConfig),
      address: wallet.address || '',
      subaccountNumber: subaccount.subaccountNumber,
    }

    /*
     * Indexer
     */
    const block = await indexer.client.utility.getHeight()
    const blockHeight = Number(block.height)
    if (!blockHeight || isNaN(blockHeight)) {
      throw new Error('blockHeight is NaN')
    }
    const candles =
      (
        await indexer.client.markets.getPerpetualMarketCandles(
          ticker,
          '1DAY',
          undefined,
          undefined,
          2
        )
      )?.candles || []
    data.price = candles?.[0]?.close
    data.daily = Array.from([
      ...new Set(
        candles.map(
          (c: any) =>
            (Number(c?.close || 0) +
              Number(c?.open || 0) +
              Number(c?.high || 0) +
              Number(c?.low || 0)) /
            4
        )
      ),
    ])
    data.direction = data.daily?.[0] < data.daily?.[1] ? -1 : 1 // remember: prices array is reversed
    data.subaccount = (
      await indexer.client.account.getSubaccount(
        indexer.address,
        indexer.subaccountNumber
      )
    )?.subaccount
    data.position = data.subaccount?.openPerpetualPositions[ticker]
    data.size_before = Number(data.position?.size || 0)
    data.margin_available = (data.subaccount?.freeCollateral || 0) * 9 //(90% of 10x)

    /*
     * Check before placing order
     */
    data.margin_needed = data.price * Math.abs(size)
    data.enough_margin = data.margin_available > data.price * Math.abs(size)
    if (!data.enough_margin) {
      data.error = `Not enough margin: ${data.margin_needed} > ${data.margin_available}`
      throw new Error(data.error)
    }

    /*
     * Place order
     */
    const orderId = marketOrder({
      compositeClient: composite.client,
      subaccount,
      ticker,
      side,
      size,
    })
    const stopOrderId = stopMarketOrder({
      compositeClient: composite.client,
      subaccount,
      ticker,
      side: side === 'LONG' ? 'SHORT' : 'LONG',
      size: size * -1,
      triggerPrice: data.price * 0.99,
    })

    // /*
    //  * check1
    //  */
    // await new Promise((resolve) =>
    //   setTimeout(async () => {
    //     // check new positions
    //     data.size_5000 = (await getPositionRaw({ ...indexer, ticker })).size
    //     // is balanced upated?
    //     data.size_remaining = data.size_intended - data.size_5000
    //     // continue
    //     resolve(undefined)
    //   }, 5000)
    // )
    // if (data.size_remaining === 0) {
    //   return data
    // }

    // /*
    //  * check2
    //  */
    // await new Promise((resolve) =>
    //   setTimeout(async () => {
    //     // check new positions
    //     data.size_15000 = (await getPositionRaw({ ...indexer, ticker })).size
    //     // is balanced upated?
    //     data.size_remaining = data.size_intended - data.size_15000
    //     // continue
    //     resolve(undefined)
    //   }, 15000)
    // )
    // if (data.size_remaining === 0) {
    //   return data
    // }

    // /*
    //  * Order unfilled
    //  */
    // const message = `${ticker} ${side} ${size} order remains unfilled: ${data.size_remaining}`
    // sendToMyselfSMS(message)
    // await addLog('trade-error', message, {
    //   name: 'order-unfilled',
    //   message: message,
    //   stack: data,
    // })
    // // cancel attempted
    // composite.client.cancelOrder(
    //   subaccount,
    //   orderId,
    //   0,
    //   ticker,
    //   blockHeight + 15
    // )

    // @ts-ignore
  } catch (err: Error) {
    catchError(err)
  }
  return data
}
