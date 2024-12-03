'use client'

import Link from 'next/link'
import * as React from 'react'
import { useState } from 'react'
import { Group } from '@my/fe/src/components/mantine'
import classes from './index.module.scss'
import useOutsideClickOrEscape from '@src/hooks/useOutsideClickOrEscape'
import DrawerWithTrigger from '../DrawerWithTrigger/DrawerWithHoverTrigger'
import AvatarIcon from '@src/components/icons/AvatarIcon'
import { SessionContext } from '@src/context/SessionProvider'
import stytchRevokeSession from '@src/app/auth/actions/stytchRevokeSession'

export default function NavRight() {
  const session = React.useContext(SessionContext)
  const [open, setOpen] = useState(false)
  const ref = useOutsideClickOrEscape(open, () => {
    setOpen(false)
  })
  return (
    <DrawerWithTrigger
      right
      open={open}
      setOpen={setOpen}
      trigger={
        <div
          role="presentation"
          onClick={() => {
            setOpen(!open)
          }}
          className={classes.trigger}
        >
          <div className={classes.triggerContent}>
            {session.user?.auth ? (
              <>
                <b>✅</b>
                <AvatarIcon size="xl" />
              </>
            ) : (
              <AvatarIcon size="xl" />
            )}
          </div>
        </div>
      }
    >
      <nav className={classes.navbar} ref={ref}>
        <div className={classes.navbarContent}>
          <Group className={classes.header} justify="space-between">
            <Link
              href="/auth/signin"
              onClick={() => {
                stytchRevokeSession()
              }}
            >
              Sign in
            </Link>
            {session.user?.auth && (
              <button
                type="button"
                onClick={() => {
                  stytchRevokeSession()
                }}
              >
                Sign out
              </button>
            )}
            <hr />
            <pre className="text-left text-sm">
              <code>{JSON.stringify(session, null, 2)}</code>
            </pre>
          </Group>
        </div>
      </nav>
    </DrawerWithTrigger>
  )
}
