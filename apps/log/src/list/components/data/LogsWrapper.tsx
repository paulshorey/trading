'use client'

import { useState, useEffect, useMemo } from 'react'
import { LogRowGet } from '@my/be/sql/log/types'
import { Where } from '@my/be/sql/types'
import { Json } from '@my/fe/src/components/blocks/Json'
import { Copy } from '@my/fe/src/components/buttons/Copy'
import { AccordionItem } from '@src/list/components/accordion/AccordionItem'
import { Header } from '../nav/Header'
import { FilterBadge } from '../accordion/FilterBadge'
import { FilterBadgeTime } from '../accordion/FilterBadgeTime'

export function LogsWrapper({
  logs: initialLogs,
  where: initialWhere,
}: {
  logs: LogRowGet[]
  where: Where
}) {
  const [logs, setLogs] = useState(initialLogs)
  const [where, setWhere] = useState(initialWhere)
  const whereString = useMemo(() => JSON.stringify(where), [where])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    const hasFilters = Object.keys(JSON.parse(whereString)).length > 0
    setOpenIndex(hasFilters ? null : 0)
  }, [whereString])

  useEffect(() => {
    setLogs(initialLogs)
    setWhere(initialWhere)
  }, [initialLogs, initialWhere])

  const sections = logs.map((log: LogRowGet, i: number) => {
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
        className="relative pl-3 pr-0 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={dataParsed} />
      </AccordionItem>
    )
  })

  return (
    <div>
      <Header where={where} />
      <main>{sections}</main>
    </div>
  )
}
