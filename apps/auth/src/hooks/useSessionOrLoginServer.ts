'use server';

import { redirect } from 'next/navigation';
import { sessionGet } from '@src/app/auth/actions/session';

export default async function useSessionOrLoginServer(redirectUrl: string) {
  const session = await sessionGet();
  if (!session?.user?.auth) {
    redirect(`/auth?redirect=${encodeURIComponent(redirectUrl)}`);
  }
  return session;
}
