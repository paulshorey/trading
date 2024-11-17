'use server'

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
import { sendToMyselfSMS } from '@my/be/twillio/sendToMyselfSMS'
import { logAdd } from '@my/be/sql/log/add'
import { Order } from '@src/be/dydx/methods/getOrders'
import Dydx from '@src/be/dydx'
import { numberOrZero } from '@src/lib/numbers'
import { getCandles } from '@src/be/dydx/methods/getCandles'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Output = Record<string, any>

/**
 * Throws error if something went wrong!
 */
export const infoTicker = async (
  tickerString: string
): Promise<Output | undefined> => {
  const ticker = (tickerString.toUpperCase() + '-USD').replace(
    '-USD-USD',
    '-USD'
  )
  const output = {} as Output
  try {
    /*
     * Connection
     */
    const dydx = new Dydx()
    await sleep(300)
    /*
     * Data
     */
    output.market = await dydx.getPerpetualMarket(ticker)
    output.asksAndBids = await dydx.getAsksAndBids(ticker)

    // @ts-ignore
  } catch (err: Error) {
    // Error
    const message =
      'DYDX Error! in scout ' +
      (typeof err?.message === 'string' ? err?.message : 'unknown')
    // notify sms
    sendToMyselfSMS(message)
    // notify log
    await logAdd('error', message, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }
  return output
}
