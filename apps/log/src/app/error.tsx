'use client';

import { ErrorTemplate } from '@my/fe/components/mains/ErrorTemplate';

type Props = Readonly<{
  error: Error;
}>;

export default function ServerErrorPage({ error }: Props) {
  console.error('app/error.tsx', error);
  return (
    <ErrorTemplate
      server
      filePath="app/error.tsx"
      error={{
        name: error.name,
        message: error.message,
        stack: error.stack,
      }}
    />
  );
}
