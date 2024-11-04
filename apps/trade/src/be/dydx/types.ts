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
  inputs: MarketOrderInput
  error?: string
  message?: string
  price: number
  precision: number
  hourly: number[]
  daily: number[]
  margin_available: number
  margin_needed: number
  enough_margin: boolean
  seconds_passed: number
  seconds_passed_stoploss: number
  seconds_passed_cancelled: number
  /*
   * size_ is signed
   */
  size_add: number
  size_original: number
  size_current: number
  size_current_floor: number
  size_intended: number
  size_unfilled: number
  /*
   * coins_ is absolute
   */
  size_max: number
  coins_add: number
  coins_filled: number
  coins_stop_order: number
  /**
   * order completion
   */
  order_is_filled: boolean
  order_client_id: number
}

export type MarketOrderInput = {
  ticker: string
  side: 'SHORT' | 'LONG'
  /**
   * Size in dollars. Absolute amount to buy or sell. Sign will be ignored.
   */
  dollars: number
  dollarsMax: number
  /**
   * 1= 0.01%
   */
  sl?: number
}
