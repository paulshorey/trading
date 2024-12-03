import * as React from 'react';
import PageContentHeader from '@src/components/templates/PageContentHeader';
import PageContent from '@src/components/templates/PageContent';
import DateAndTime from '@src/components/account/DateAndTime';

export default function PagePublicServer() {
  return (
    <div>
      <PageContentHeader title='This page built with NextJS "use server"' />
      <PageContent>
        <DateAndTime />
      </PageContent>
    </div>
  );
}
