'use server'

import { Client } from 'stytch'
import { SessionData } from '@src/app/auth/actions/types'
import { sessionStart, sessionGet } from '@src/app/auth/actions/session'
import { sessionEnd } from '@src/app/auth/actions/session'

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || '',
  secret: process.env.STYTCH_SECRET || '',
})

type responseType = {
  status_code: number
  message?: string
  session: SessionData // unlike other actions, this always returns a session, even if errored
}

export default async function stytchRevokeSession(): Promise<responseType> {
  console.error('\n\n\n', ['stytchRevokeSession'], '\n\n\n')
  try {
    /*
     * Revoke auth session if exists
     */
    const sessionOld = await sessionGet()
    if (sessionOld?.session?.jwt) {
      await stytchClient.sessions.revoke({
        session_jwt: sessionOld.session.jwt || '',
      })
    } else if (sessionOld?.session?.token) {
      await stytchClient.sessions.revoke({
        session_token: sessionOld.session.token || '',
      })
    }
    sessionEnd()
    /*
     * Start new empty session
     */
    const session = await sessionStart({})
    return { session, status_code: 200 }
  } catch (error: any) {
    const session = await sessionStart({})
    console.error(error)
    return {
      session,
      message: error.error_message || error.message,
      status_code: 500,
    }
  }
}
