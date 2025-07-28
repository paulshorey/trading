'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { OrderRowGet } from '@apps/common/sql/order/types'
import { Where } from '@apps/common/sql/types'
import { Json } from '@apps/common/src/components/blocks/Json'
import { Copy } from '@apps/common/src/components/buttons/Copy'
import { AccordionItem } from '@src/list/components/accordion/AccordionItem'
import { Header } from '../nav/Header'
import { FilterBadge } from '../accordion/FilterBadge'
import { FilterBadgeTime } from '../accordion/FilterBadgeTime'

export function OrdersWrapper({
  orders: initialOrders,
  where: initialWhere,
}: {
  orders: OrderRowGet[]
  where: Where
}) {
  const [orders, setOrders] = useState(initialOrders)
  const [where, setWhere] = useState(initialWhere)
  const whereString = useMemo(() => JSON.stringify(where), [where])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    const hasFilters = Object.keys(JSON.parse(whereString)).length > 0
    setOpenIndex(hasFilters ? null : 0)
  }, [whereString])

  useEffect(() => {
    setOrders(initialOrders)
    setWhere(initialWhere)
  }, [initialOrders, initialWhere])

  const sections = orders.map((order: OrderRowGet, i: number) => {
    const message = `${order.side} ${order.amount} ${order.ticker} @ ${order.price}`
    return (
      <AccordionItem
        classNames={{
          content: 'rounded-md bg-gray-800 mt-3 p-4',
        }}
        key={order.client_id || i}
        title={message}
        buttonsRight={[
          <Copy
            key="copy"
            text={message}
            className="align-middle self-center"
          />,
          <FilterBadge key="type" field="type" value={order.type} />,
          <FilterBadge key="ticker" field="ticker" value={order.ticker} />,
          <FilterBadge key="side" field="side" value={order.side} />,
          <FilterBadge
            key="app_name"
            field="app_name"
            value={order.app_name || ''}
          />,
          <FilterBadge
            key="server_name"
            field="server_name"
            value={order.server_name || ''}
          />,
          <FilterBadgeTime key="time" time={order.time || 0} />,
        ]}
        open={openIndex === i}
        onToggle={() => setOpenIndex(openIndex === i ? null : i)}
        className="relative pl-3 pr-1 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={order} />
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
