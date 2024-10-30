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
  price_direction: 'up' | 'down'
  daily: number[]
  direction: string
  size_original: number
  margin_available: number
  size_absolute: number
  size_add: number
  size_intended: number
  margin_needed: number
  enough_margin: boolean
  size_unfilled: number
  size_filled: number
  size_is_filled: boolean
  seconds_passed: number
  seconds_passed_stoploss: number
  seconds_passed_cancelled: number
}

export type MarketOrderProps = {
  ticker: string
  side: 'SHORT' | 'LONG'
  /**
   * Size in dollars. Absolute amount to buy or sell. Sign will be ignored.
   */
  dollar: number
  /**
   * 1= 0.01%
   */
  sl?: number
}
