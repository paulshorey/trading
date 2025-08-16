import dynamic from 'next/dynamic'
import { ListData } from '@/list/components/data/ListData'

export const revalidate = 0

type PageProps = {
  searchParams: { [key: string]: string | string[] | undefined }
}

export default async function Page({ searchParams }: PageProps) {
  const table = 'orders'
  const filters = ['type', 'ticker', 'side', 'app_name', 'server_name', 'time']
  const where: Record<string, string> = {}
  for (const [key, value] of Object.entries(searchParams)) {
    if (filters.includes(key)) {
      where[key] = value as string
    }
  }
  return <ListData filters={filters} where={where} table={table} />
}
