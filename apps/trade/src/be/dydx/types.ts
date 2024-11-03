import {
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { getOrders } from '@src/be/dydx/methods/getOrders'
import { getPositions } from '@src/be/dydx/methods/getPositions'
import { orderStop } from '@src/be/dydx/methods/orderStop'
import { orderMarket } from '@src/be/dydx/methods/orderMarket'
import { orderCancel } from '@src/be/dydx/methods/orderCancel'
import { getCandles } from '@src/be/dydx/methods/getCandles'
import { getAccount } from '@src/be/dydx/methods/getAccount'

export interface DydxInterface {
  network: Network
  indexerClient?: IndexerClient
  compositeClient?: CompositeClient
  wallet: LocalWallet
  address: string
  subaccount: SubaccountClient
  subaccountNumber: number
  init: () => Promise<void>
  getIndexerClient: () => Promise<IndexerClient>
  getCompositeClient: () => Promise<CompositeClient>
  getAccount: typeof getAccount
  getCandles: typeof getCandles
  getOrders: typeof getOrders
  getPositions: typeof getPositions
  placeOrderStop: typeof orderStop
  placeOrderMarket: typeof orderMarket
  placeOrderCancel: typeof orderCancel
}

export type MarketOrderOutput = {
  inputs: MarketOrderProps
  error: string
  price: number
  // price_direction: 'up' | 'down'
  hourly: number[]
  daily: number[]
  direction: string
  margin_available: number
  margin_needed: number
  enough_margin: boolean
  seconds_passed: number
  seconds_passed_stoploss: number
  seconds_passed_cancelled: number
  coins_original: number
  coins_current: number
  coins_add: number
  coins_intended: number
  coins_unfilled: number
  coins_filled: number
  coins_is_filled: boolean
  order_client_id: number
}

export type MarketOrderProps = {
  ticker: string
  side: 'SHORT' | 'LONG'
  /**
   * Size in dollars. Absolute amount to buy or sell. Sign will be ignored.
   */
  dollars: number
  /**
   * 1= 0.01%
   */
  sl?: number
}
