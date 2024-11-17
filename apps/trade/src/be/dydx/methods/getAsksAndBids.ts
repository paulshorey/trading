import { DydxInterface } from '@src/be/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'

export async function getAsksAndBids(
  this: DydxInterface,
  ticker: string
): Promise<Data> {
  const indexer = await this.getIndexerClient()
  const data = await indexer.markets.getPerpetualMarketOrderbook(ticker)
  return {
    asks: data.asks || {},
    bids: data.bids || {},
  }
}
