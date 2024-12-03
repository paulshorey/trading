'use client';

import { createContext } from 'react';
import type { SessionData } from '@src/app/auth/actions/types';

export const SessionContext = createContext<SessionData>({ ui: {}, user: {}, session: {} });

export default function SessionProvider({
  session,
  children,
}: {
  session: SessionData;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
