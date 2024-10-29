import { DydxInterface } from '@src/be/dydx'
import { Data } from '@dydxprotocol/v4-client-js/build/src/clients/types'
import { numberOrZero } from '../../../lib/numbers'

export async function getPositions(
  this: DydxInterface,
  ticker?: string,
  status = 'OPEN'
): Promise<Data> {
  const indexer = await this.getIndexerClient()
  return (
    (
      await indexer.account.getSubaccountPerpetualPositions(
        this.address,
        this.subaccountNumber
      )
    )?.positions || []
  )
    .filter((p: any) => {
      let keep = true
      if (ticker && p.ticker !== ticker) keep = false
      if (status && p.status !== status) keep = false
      return keep
    })
    .map((p: any) => {
      p.size = numberOrZero(p?.size)
    })
}
