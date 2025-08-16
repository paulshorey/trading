import { DydxInterface } from '@/dydx'

/**
 * Numbers are returned as strings. Status may be misspelled (CANCELED).
 * Side (BUY/SELL) is not consistent with other APIs (LONG/SHORT).
 */
type OrderRaw = {
  id: string //'35044b5e-528b-57c6-a195-8197d3dd4b2c'
  subaccountId: string // '0a14c52f-2b2a-531f-93b5-c3ed21f9acc0'
  clientId: string // '53923'
  clobPairId: string //'31'
  side: 'SELL' | 'BUY'
  size: string // '220'
  totalFilled: string // '0'
  price: string // '0.01'
  type: 'STOP_LIMIT' | 'LIMIT' | 'MARKET' | 'STOP_MARKET'
  status: string // 'UNTRIGGERED'
  timeInForce: 'IOC' | 'GTT' | 'FOK'
  reduceOnly: boolean // true
  orderFlags: '0' | '32' | '64'
  goodTilBlockTime: string // '2024-11-10T22:10:26.000Z'
  createdAtHeight: string // '29340301'
  clientMetadata: string // '1'
  triggerPrice: string // '1.9304'
  updatedAt: string // '2024-11-03T22:10:27.987Z'
  updatedAtHeight: string // '29340301'
  postOnly: boolean
  ticker: string // 'SUI-USD'
  subaccountNumber: number // 0
}
export type Order = {
  id: string //'35044b5e-528b-57c6-a195-8197d3dd4b2c'
  subaccountId: string // '0a14c52f-2b2a-531f-93b5-c3ed21f9acc0'
  clientId: number // '53923'
  clobPairId: number //'31'
  side: 'SHORT' | 'LONG'
  size: number // '220'
  totalFilled: number // '0'
  price: number // '0.01'
  type: 'STOP_LIMIT' | 'LIMIT' | 'MARKET' | 'STOP_MARKET'
  status: string // 'UNTRIGGERED'
  timeInForce: 'IOC' | 'GTT' | 'FOK'
  reduceOnly: boolean // true
  orderFlags: '0' | '32' | '64'
  goodTilBlockTime: string // '2024-11-10T22:10:26.000Z'
  createdAtHeight: number // '29340301'
  clientMetadata: number // '1'
  triggerPrice: number // '1.9304'
  updatedAt: string // '2024-11-03T22:10:27.987Z'
  updatedAtHeight: number // '29340301'
  postOnly: boolean
  ticker: string // 'SUI-USD'
  subaccountNumber: number // 0
}

/**
 * Returns filtered and fixed array of orders.
 */
export async function getOrders(this: DydxInterface, ticker?: string, activeOnly?: boolean, filterFunction?: (order: Order) => boolean): Promise<Order[]> {
  const indexer = await this.getIndexerClient()
  return ((await indexer.account.getSubaccountOrders(this.address, this.subaccountNumber)) || [])
    .map(
      (p: OrderRaw): Order => ({
        ...p,
        clientId: parseInt(p.clientId),
        clobPairId: parseInt(p.clobPairId),
        size: parseFloat(p.size),
        totalFilled: parseFloat(p.totalFilled),
        price: parseFloat(p.price),
        createdAtHeight: parseInt(p.createdAtHeight),
        clientMetadata: parseInt(p.clientMetadata),
        triggerPrice: parseFloat(p.triggerPrice),
        updatedAtHeight: parseInt(p.updatedAtHeight),
        status: p.status === 'CANCELED' ? 'CANCELLED' : p.status === 'CANCELING' ? 'CANCELLING' : p.status,
        // @ts-ignore see check in .filter
        side: p.side === 'SELL' ? 'SHORT' : p.side === 'BUY' ? 'LONG' : '',
      })
    )
    .filter((p: Order) => {
      // @ts-ignore see comparison in .map
      if (p.side === '') return false
      // immediately filter out if wrong ticker
      if (ticker && p.ticker !== ticker) return false
      // status, or custom filter by any property
      let keep = true
      if (activeOnly && !(p.status === 'UNTRIGGERED' || p.status === 'CANCELLING' || p.status === 'CANCELING' || p.status === 'BEST_EFFORT_CANCELED' || p.status === 'OPEN' || p.status === 'UNFILLED')) {
        keep = false
      }
      if (filterFunction && !filterFunction(p)) {
        keep = false
      }
      return keep
    })
}
