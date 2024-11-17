import { DydxInterface } from '@src/be/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'

export async function getSparklines(this: DydxInterface): Promise<Data> {
  const indexer = await this.getIndexerClient()
  const data = await indexer.markets.getPerpetualMarketSparklines()
  return data
}
