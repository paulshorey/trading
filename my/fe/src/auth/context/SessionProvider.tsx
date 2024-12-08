'use client'

import { createContext } from 'react'
import type { SessionData } from '@my/be/auth/actions/types'

export const SessionContext = createContext<SessionData>({
  ui: {},
  user: {},
  session: {},
}) as any

export default function SessionProvider({
  session,
  children,
}: {
  session: SessionData
  children: any
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  )
}
