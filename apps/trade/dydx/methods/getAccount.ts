import { DydxInterface } from '@/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'

export async function getAccount(this: DydxInterface): Promise<Data> {
  const indexer = await this.getIndexerClient()
  const accountData = (await indexer.account.getSubaccount(this.address, this.subaccountNumber))?.subaccount || {}
  if (accountData.openPerpetualPositions) {
    for (let ticker in accountData.openPerpetualPositions) {
      accountData.openPerpetualPositions[ticker].ticker = ticker
    }
  }
  return accountData
}
