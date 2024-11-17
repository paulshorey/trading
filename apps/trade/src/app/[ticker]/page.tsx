import { PageTicker } from '@src/fe/pages/PageTicker'

export const revalidate = 0

type Params = {
  ticker: string
}

export default async function Page({ params }: { params: Params }) {
  return <PageTicker params={params} />
}
