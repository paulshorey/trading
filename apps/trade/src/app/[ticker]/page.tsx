import { PageTickerOrderbook } from '@src/fe/orders/PageTickerOrderbook'

export const revalidate = 0

type Params = {
  ticker: string
}

export default async function Page({ params }: { params: Params }) {
  return <PageTickerOrderbook params={params} />
}
