import { OrderRowGet } from '@my/be/sql/order/types'
import { orderGets } from '@my/be/sql/order/gets'
import { OrdersWrapper } from '@src/fe/blocks/OrdersWrapper'

export const revalidate = 0

export default async function Page({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const where: Record<string, any> = {}
  const validFilters = [
    'type',
    'ticker',
    'side',
    'app_name',
    'server_name',
    'dev',
  ]

  for (const key of validFilters) {
    if (searchParams[key] !== undefined) {
      if (key === 'dev') {
        where[key] = searchParams[key] === 'true'
      } else {
        where[key] = searchParams[key]
      }
    }
  }

  if (searchParams.time_start) {
    where.time_start = Number(searchParams.time_start)
  }

  if (searchParams.time_end) {
    where.time_end = Number(searchParams.time_end)
  }

  try {
    const { error, result } = await orderGets({ where })
    if (error) {
      throw error
    }
    const orders = (result?.rows as OrderRowGet[]) || []
    return <OrdersWrapper orders={orders} where={where} />
  } catch (error) {
    console.error(error)
    throw error
  }
}
