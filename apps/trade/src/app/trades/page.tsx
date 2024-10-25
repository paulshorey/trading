import Data from '@src/fe/blocks/Data'
import { dydxScout } from '@src/be/dydx/scout'

export const revalidate = 0

export default async function Page({}: {}) {
  const data = await dydxScout()
  if (!data) {
    throw new Error('No data from DYDX')
  }
  return <Data data={data} />
}
