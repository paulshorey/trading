import dynamic from 'next/dynamic'
import { ThemeWrapper } from '@/components/ThemeWrapper'

const ListData = dynamic(() =>
  import('@/components/list/data/ListData').then((mod) => mod.ListData)
)

export const revalidate = 0

type PageProps = {
  searchParams: { [key: string]: string | string[] | undefined }
}

export default async function Page({ searchParams }: PageProps) {
  const table = 'log'
  const filters = [
    'category',
    'tag',
    'name',
    'app_name',
    'server_name',
    'created_at',
  ]
  const where: Record<string, string> = {}
  for (const [key, value] of Object.entries(searchParams)) {
    if (filters.includes(key)) {
      where[key] = value as string
    }
  }
  return (
    <ThemeWrapper colorScheme="dark">
      <ListData filters={filters} where={where} table={table} />
    </ThemeWrapper>
  )
}
