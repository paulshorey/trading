import { ListData } from '@/components/list/data/ListData'
import { ThemeWrapper } from '@/components/ThemeWrapper'

export const revalidate = 0

type PageProps = {
  searchParams: { [key: string]: string | string[] | undefined }
}

export default async function Page({ searchParams }: PageProps) {
  const table = 'strength'
  const filters = ['ticker', 'app_name', 'server_name', 'node_env', 'time']
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
