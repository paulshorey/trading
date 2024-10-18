import { ErrorTemplate } from '@src/components/mains/ErrorTemplate';
import { getLogs } from '@my/be/sql/getLogs';
import Json from '@src/components/blocks/Json';
import Logs from '@src/components/mains/Logs';

export default async function () {
  try {
    const { error, result } = await getLogs();
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw error;
    }
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
