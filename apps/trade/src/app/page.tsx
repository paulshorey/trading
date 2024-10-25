import { ErrorTemplate } from '@my/fe/src/components/mains/ErrorTemplate'
import Json from '@my/fe/src/components/blocks/Json'
import { get } from '@my/be/sql/log/get'

export const revalidate = 0

export default async function () {
  try {
    const where = { name: 'trade-scout' }
    const { error, result } = await get({ where }) //
    console.log('output', { error, result })
    return <Json data={result?.rows || { error }} />
    // @ts-ignore
  } catch (error: Error) {
    // addLog('Error accessing logs page (in app/page.tsx SSR)', error);
    return (
      <ErrorTemplate
        filePath="app/page.tsx"
        error={{
          name: error.name,
          message: error.message,
          stack: error.stack,
        }}
      />
    )
  }
}
