import importDynamic from 'next/dynamic';
import { ErrorTemplate } from '@src/components/ErrorTemplate';
import { getSql } from '@src/lib/sql/getSql';
import Json from '@src/components/ui/Json';
// import { cc } from '@src/lib/cc';

const Logs = importDynamic(() => import('@src/components/ui/Logs'), {
  ssr: false,
});

export default async function () {
  try {
    const result = await getSql('SELECT * FROM events.logs ORDER BY time DESC LIMIT 100');
    // cc.info(['ssr', 'page.tsx', 'rows.length', result?.rows?.length || 0]);
    if (result?.rows) {
      return <Logs logs={result?.rows} />;
    } else {
      return <Json data={result} />;
    }
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
    );
  }
}
