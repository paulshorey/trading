import { LocalWallet, SubaccountInfo, CompositeClient, Network, IndexerClient } from '@dydxprotocol/v4-client-js'
import { getOrders } from '@/dydx/methods/getOrders'
import { getPositions } from '@/dydx/methods/getPositions'
import { orderStop } from '@/dydx/methods/orderStop'
import { orderMarket } from '@/dydx/methods/orderMarket'
import { orderCancel } from '@/dydx/methods/orderCancel'
import { getCandles } from '@/dydx/methods/getCandles'
import { getAccount } from '@/dydx/methods/getAccount'

export interface DydxInterface {
  network: Network
  indexerClient?: IndexerClient
  compositeClient?: CompositeClient
  wallet: LocalWallet
  address: string
  subaccount: SubaccountInfo
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
  side: 'LONG' | 'SHORT'
  size_intended: number
  size_unfilled: number
  size_original: number
  size_current: number
  /**
   * order completion
   */
  order_is_filled: boolean
  order_client_id: number
}

export type MarketOrderInput = {
  ticker: string
  /**
   * In dollars, signed (can be negative).
   * Can be zero (0) to exit the position.
   */
  position: number
  /**
   * Fraction of 1% (as a decimal ofcourse).
   */
  sl?: number
}

export type orderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET' | 'TRAILING_STOP' | 'TAKE_PROFIT' | 'TAKE_PROFIT_MARKET'

export type orderStatus = 'OPEN' | 'FILLED' | 'CANCELED' | 'BEST_EFFORT_CANCELED' | 'UNTRIGGERED'
