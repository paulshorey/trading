import {
  OrderExecution,
  OrderSide,
  OrderType,
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  OrderTimeInForce,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { addLog } from '@my/be/sql/log/add'

type Output = Record<string, any>
const log_type = 'test-order'

export const dydxTest = async ({
  ticker,
  side,
  size,
}: {
  ticker: string
  side: 'SHORT' | 'LONG'
  size: number
}): Promise<Output | undefined> => {
  const data = {} as Record<string, any>
  try {
    /*
     * Inputs
     */
    if (!ticker || !side || !size || isNaN(Number(size)) || size <= 0) {
      data.error = 'bad input: !ticker | !side | !size'
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

    /*
     * Connection
     */
    const NETWORK = Network.mainnet()
    const client = new IndexerClient(NETWORK.indexerConfig)
    const mnemonic = process.env.DYDX_MNEMONIC || ''
    const wallet = await LocalWallet.fromMnemonic(mnemonic, BECH32_PREFIX)
    const address = wallet.address || ''
    const subaccount = new SubaccountClient(wallet, 0)
    const subaccountNumber = subaccount.subaccountNumber
    // https://docs.dydx.exchange/api_integration-clients/composite_client#placing-orders
    const sideEnum = side === 'SHORT' ? OrderSide.SELL : OrderSide.BUY
    const compositeClient = await CompositeClient.connect(NETWORK)
    const clientId = Math.ceil(Math.random() * 1000000) // set to a number, can be used by the client to identify the order

    /*
     * GET DATA
     */
    const block = await client.utility.getHeight()
    const blockHeight = Number(block.height)
    if (!blockHeight || isNaN(blockHeight)) {
      throw new Error('blockHeight is NaN')
    }
    async function getOrders() {
      return (
        (await client.account.getSubaccountOrders(address, subaccountNumber)) ||
        []
      ).filter(
        (p: any) =>
          p.ticker === ticker &&
          p.status !== 'CLOSED' &&
          p.status !== 'FILLED' &&
          p.status !== 'CANCELED'
      )
    }
    data.orders_before = await getOrders()
    async function getPosition() {
      let pos = (
        (
          await client.account.getSubaccountPerpetualPositions(
            address,
            subaccountNumber
          )
        )?.positions || []
      ).filter((p: any) => p.market === ticker && p.status !== 'CLOSED')?.[0]
      return pos?.size ? Number(pos.size) : 0
    }
    data.size_before = await getPosition()

    /*
     * DUPLICATE ORDER
     */
    // if (position?.side === side) {
    //   // position already exists
    //   data.message = 'order ignored: duplicate'
    //   await addLog('trade-log', data.message, {
    //     position,
    //   })
    //   return data
    // }

    /*
     * PLACE ORDER
     */
    const type = OrderType.MARKET // order type
    const timeInForce = OrderTimeInForce.GTT // UX TimeInForce
    const goodTilTimeInSeconds = Date.now() / 1000 + 60 * 5 // epoch seconds
    const execution = OrderExecution.DEFAULT
    const price = side === 'LONG' ? 10000000 : 0.01 //= 30_000; // price of 30,000;
    const postOnly = false // If true, order is post only
    const reduceOnly = false // if true, the order will only reduce the position size
    const triggerPrice = undefined // = null; // required for conditional orders
    compositeClient.placeOrder(
      subaccount,
      ticker,
      type,
      sideEnum,
      price,
      size,
      clientId,
      timeInForce,
      goodTilTimeInSeconds,
      execution,
      postOnly,
      reduceOnly,
      triggerPrice
    )
    data.size_add = side === 'LONG' ? size : -size
    data.size_intended = data.size_before + data.size_add

    /*
     * CHECK ORDER HAS FILLED
     */
    await new Promise((resolve) =>
      setTimeout(async () => {
        // check new positions
        data.size_5000 = await getPosition()
        // is balanced upated?
        data.size_remaining = data.size_intended - data.size_5000
        // continue
        resolve(undefined)
      }, 5000)
    )
    if (data.size_remaining === 0) {
      return data
    }

    /*
     * CHECK POSITION HAS UPDATED
     */
    await new Promise((resolve) =>
      setTimeout(async () => {
        // check new positions
        data.size_15000 = await getPosition()
        // is balanced upated?
        data.size_remaining = data.size_intended - data.size_15000
        // continue
        resolve(undefined)
      }, 15000)
    )
    if (data.size_remaining === 0) {
      return data
    }

    /*
     * ORDER UNFILLED
     */
    const message = `${ticker} ${side} ${size} order remains unfilled: ${data.size_remaining}`
    sendToMyselfSMS(message)
    await addLog('trade-error', message, {
      name: 'order-unfilled',
      message: message,
      stack: data,
    })

    /*
     * CANCEL ORDER
     */
    await compositeClient.cancelOrder(
      subaccount,
      clientId,
      0,
      ticker,
      blockHeight + 15
      // Date.now() / 1000 + 1000
    )

    // @ts-ignore
  } catch (err: Error) {
    console.error('catch', err)
    // Error
    const message =
      `${log_type} catch: ` +
      (typeof err?.message === 'string' ? err?.message : 'unknown')
    // notify sms
    sendToMyselfSMS(message)
    // notify log
    await addLog('trade-error', message, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }
  return data
}

// function closeEnough(
//   original: number,
//   compareto: number,
//   allowedDifferenceFraction: number
// ) {
//   const diff = compareto / original
//   return (
//     diff < 1 + allowedDifferenceFraction && diff > 1 - allowedDifferenceFraction
//   )
// }
