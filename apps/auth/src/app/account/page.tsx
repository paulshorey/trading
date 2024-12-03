import * as React from 'react';
import { redirect } from 'next/navigation';
import UserCard from '@src/components/account/UserCard';
import { sessionGet } from '@src/app/auth/actions/session';

export default async function Home() {
  const session = await sessionGet();
  if (!session?.user?.auth) {
    redirect('/auth/signin');
  }

  return <UserCard user={session.user} />;
}
