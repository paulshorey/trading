import { DydxInterface } from '@src/be/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'

export async function getAccount(this: DydxInterface): Promise<Data> {
  const indexer = await this.getIndexerClient()
  return (
    await indexer.account.getSubaccount(this.address, this.subaccountNumber)
  )?.subaccount
}
