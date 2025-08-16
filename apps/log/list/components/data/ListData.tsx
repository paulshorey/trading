'use client'

import { useState, useEffect } from 'react'
import { orderGets } from '@apps/data/sql/order/gets'
import { Json } from '@apps/data/src/components/blocks/Json'
import { AccordionItem } from '@/list/components/accordion/AccordionItem'
import { Header } from '../nav/Header'
import { FilterBadge } from '../accordion/FilterBadge'
import { FilterBadgeTime } from '../accordion/FilterBadgeTime'
import { logGets } from '@apps/data/sql/log/gets'

type RowGet = Record<string, any>

export function ListData({
  filters,
  where,
  table,
}: {
  filters: string[]
  where: Record<string, any>
  table: string
}) {
  //////////////////////////////////////////////////////////////
  // Fetch data
  const [logs, setLogs] = useState<RowGet[]>([])
  useEffect(() => {
    ;(table === 'logs' ? logGets : orderGets)({ where }).then(({ rows }) => {
      setLogs(rows || [])
    })
  }, [where])

  //////////////////////////////////////////////////////////////
  // Render data
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const sections = logs.map((log: RowGet, i: number) => {
    let message =
      table === 'logs'
        ? log.message
        : `${log.side} ${log.amount} ${log.ticker} @ ${log.price}`
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
        buttonsRight={filters.map((key) => {
          if (key === 'time') {
            return <FilterBadgeTime key={key} time={log[key]} />
          } else {
            return (
              <FilterBadge
                key={key}
                field={key}
                value={log[key as keyof RowGet]}
              />
            )
          }
        })}
        open={openIndex === i}
        onToggle={() => setOpenIndex(openIndex === i ? null : i)}
        className="relative pl-3 pr-0 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={table === 'logs' ? dataParsed : log} />
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
