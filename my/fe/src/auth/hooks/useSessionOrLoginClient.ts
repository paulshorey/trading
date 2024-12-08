import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useEffect } from 'react'
import { SessionContext } from '../../../src/auth/context/SessionProvider'

export default function useSessionOrLogin() {
  const session = React.useContext(SessionContext)
  const router = useRouter()
  const path = usePathname()
  const searchParams = useSearchParams()
  const url = `${path}${searchParams.toString() ? '?' : ''}${searchParams.toString()}`

  useEffect(() => {
    if (!session?.user?.auth) {
      router.push(`/auth?redirect=${encodeURIComponent(url)}`)
    }
  }, [])

  return session
}
