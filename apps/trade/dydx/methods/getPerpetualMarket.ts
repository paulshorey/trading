import { DydxInterface } from '@/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'

export async function getPerpetualMarket(this: DydxInterface, ticker: string): Promise<Data> {
  const indexer = await this.getIndexerClient()
  const data = (await indexer.markets.getPerpetualMarkets(ticker))?.markets?.[ticker]
  return data
}
