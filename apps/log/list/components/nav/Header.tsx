'use client'

import { Where } from '@apps/data/sql/types'
import { colors } from '@/constants/ui'
import Link from 'next/link'
import React from 'react'
import { usePathname } from 'next/navigation'

export const Header = ({ where }: { where: Where }) => {
  const pathname = usePathname()
  return (
    <div className="flex justify-between pt-2 px-3">
      <div>
        {Object.keys(where).length > 0 && (
          <Link
            href={pathname}
            style={{
              color: colors.red,
            }}
            className="pl-1"
          >
            ◀ clear
          </Link>
        )}
      </div>
      <nav className="flex gap-2">
        <Link
          href="/"
          style={{
            color: colors.gray, //pathname === '/' ? colors.gray : colors.green,
            // textDecoration: pathname === '/' ? 'none' : 'underline',
          }}
        >
          Logs
        </Link>
        <Link
          href="/orders"
          style={{
            color: colors.gray, //pathname === '/orders' ? colors.gray : colors.green,
            // textDecoration: pathname === '/orders' ? 'none' : 'underline',
          }}
        >
          Orders
        </Link>
      </nav>
    </div>
  )
}
