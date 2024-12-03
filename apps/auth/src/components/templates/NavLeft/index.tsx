'use client'

import { Group } from '@my/fe/src/components/mantine'
import Link from 'next/link'
import * as React from 'react'
import { usePathname } from 'next/navigation'
import { ColorSchemeSwitcher } from '@src/components/atoms/ColorSchemeSwitcher'
import { useState } from 'react'
import classes from './index.module.scss'
import { nav } from './constants'
import useOutsideClickOrEscape from '@src/hooks/useOutsideClickOrEscape'
import DrawerWithTrigger from '../DrawerWithTrigger/DrawerWithHoverTrigger'

export default function NavLeft() {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClickOrEscape(open, () => {
    setOpen(false)
  })
  const pathname = usePathname()
  // const session = React.useContext(SessionContext);
  // console.log('SideNav session', session);

  const links = nav.map((item, i) => (
    <Link
      className={`${classes.link} py-3 mb-2`}
      data-active={pathname === item.link ? true : null}
      href={item.link}
      key={item.label + i}
    >
      {/* {item.Icon}&ensp;&thinsp; */}
      <span className="pt-[2px]">{item.label}</span>
    </Link>
  ))

  return (
    <DrawerWithTrigger
      open={open}
      setOpen={setOpen}
      trigger={
        <div className={classes.trigger}>
          <div className={classes.triggerContent}>
            <b
              role="presentation"
              onClick={() => setOpen(!open)}
              className={classes.triggerContent}
            >
              |||
            </b>
          </div>
        </div>
      }
    >
      <nav className={classes.navbar} ref={ref}>
        <div className={classes.navbarContent}>
          <Group className={classes.header} justify="space-between">
            <b role="presentation" onClick={() => setOpen(!open)}>
              o
            </b>
            <Link href="/" className={classes.triggerLogo}>
              <b className="shadow-md shadow-stone-800">
                <span className="text-green-500">Techy</span>.Tools
              </b>
            </Link>
          </Group>
          <div className={classes.navbarLinks}>{links}</div>
          <ColorSchemeSwitcher />
        </div>

        {/* {session.user?.auth ? (
        <div className={classes.footer}>
          <Link
            href="/account"
            className={classes.link}
            data-active={pathname.substring(0, 7) === '/account' ? true : null}
          >
            <IconBellRinging className={classes.linkIcon} stroke={1.5} />
            <span>Your account</span>
          </Link>
          <Link
            href="/auth"
            className={classes.link}
            data-active={pathname.substring(0, 5) === '/auth' ? true : null}
          >
            <IconKey className={classes.linkIcon} stroke={1.5} />
            <span>Logout</span>
          </Link>
        </div>
      ) : (
        <div className={classes.footer}>
          <Link
            href="/auth"
            className={classes.link}
            data-active={pathname.substring(0, 5) === '/auth' ? true : null}
          >
            <AvatarIcon size="md" />
            <span>Sign-up or sign-in</span>
          </Link>
        </div>
      )} */}
      </nav>
    </DrawerWithTrigger>
  )
}
