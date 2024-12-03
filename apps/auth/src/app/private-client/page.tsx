'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import UserCard from '@src/components/account/UserCard';
import useSessionOrLogin from '@src/hooks/useSessionOrLoginClient';
import PageContentHeader from '@src/components/templates/PageContentHeader';
import PageContent from '@src/components/templates/PageContent';

const DateAndTime = dynamic(
  async () => (await import('@src/components/account/DateAndTime')).default,
  { ssr: false, loading: () => <p>Loading...</p> }
);

export default function PrivatePage() {
  const session = useSessionOrLogin();

  return (
    <div>
      <PageContentHeader title='This page built with NextJS "use server"' />
      <PageContent>
        {/* @ts-ignore */}
        <DateAndTime />
        <UserCard user={session?.user} />
      </PageContent>
    </div>
  );
}
