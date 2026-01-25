import { DydxInterface } from '@/dydx'
import { Data } from '@dydxprotocol/v4-client-js'

export async function getCandles(this: DydxInterface, ticker: string, timeframe = '1DAY', limit = 2): Promise<Data> {
  const indexer = await this.getIndexerClient()
  return (await indexer.markets.getPerpetualMarketCandles(ticker, timeframe, undefined, undefined, limit))?.candles || []
}
