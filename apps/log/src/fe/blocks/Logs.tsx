'use client'

import { Json } from '@my/fe/src/components/blocks/Json'
import { LocalShortTime } from '@my/fe/src/components/inline/LocalShortTime'
import { Badge } from '@my/fe/src/components/inline/Badge'
import Link from 'next/link'
import { Copy } from '../../../../../my/fe/src/components/buttons/Copy'
import { FilterBadge } from './FilterBadge'
import { Log } from '@src/types'
import React from 'react'
import { AccordionItem } from '@src/fe/components/AccordionItem'
import { FilterBadgeTime } from './FilterBadgeTime'

export function Logs({
  logs,
  where,
  openIndex,
  setOpenIndex,
}: {
  logs: Log[]
  where: any
  openIndex: number | null
  setOpenIndex: (index: number | null) => void
}) {
  const sections = logs.map((log: Log, i: number) => {
    let message = log.message
    let dataParsed
    try {
      dataParsed = log.stack ? JSON.parse(log.stack) : null
    } catch (e) {
      dataParsed = `Could not serialize log.stack=${log.stack}`
    }

    return (
      <AccordionItem
        classNames={{
          content: 'rounded-md bg-gray-800 mt-3 p-4',
        }}
        key={log.id}
        title={message}
        buttonsRight={[
          <Copy
            key="copy"
            text={message}
            className="align-middle self-center"
          />,
          <FilterBadge key="category" field="category" value={log.category} />,
          <FilterBadge key="tag" field="tag" value={log.tag} />,
          <FilterBadge key="name" field="name" value={log.name} />,
          <FilterBadge key="app_name" field="app_name" value={log.app_name} />,
          <FilterBadge
            key="server_name"
            field="server_name"
            value={log.server_name}
          />,
          <FilterBadge key="dev" field="dev" value={log.dev} />,
          <FilterBadgeTime key="time" time={log.time} />,
        ]}
        open={openIndex === i}
        onToggle={() => setOpenIndex(openIndex === i ? null : i)}
        className="relative px-4 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={dataParsed} />
      </AccordionItem>
    )
  })

  return (
    <div>
      {Object.keys(where).length > 0 && (
        <div>
          <Link href="/">◀ clear</Link>
        </div>
      )}
      <main>{sections}</main>
    </div>
  )
}
