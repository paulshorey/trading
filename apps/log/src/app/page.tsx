import { ErrorTemplate } from '@my/fe/components/mains/ErrorTemplate';
import { get } from '@my/be/sql/log/get';
import Json from '@my/fe/components/blocks/Json';
// import Logs from '@src/components/ui/Logs';
import dynamic from 'next/dynamic'
const Logs = dynamic(() => import('@src/components/ui/Logs'), {
  ssr: false
})


export default async function () {
  try {
    const { error, result } = await get();
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw error;
    }
    // return <code>{JSON.stringify(result?.rows, null, 2)}</code>;
    if (result?.rows) {
      return <Logs logs={result?.rows} />;
    } else {
      return <Json data={result} />;
    } 
    // @ts-ignore
  } catch (error: Error) {
    return (
      <ErrorTemplate
        filePath="app/page.tsx"
        error={{
          name: error.name,
          message: error.message,
          stack: error.stack,
        }}
      />
    );
  }
}
