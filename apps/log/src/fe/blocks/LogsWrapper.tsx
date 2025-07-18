'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Logs } from './Logs'
import { Log } from '@src/types'

export function LogsWrapper({
  logs: initialLogs,
  where: initialWhere,
}: {
  logs: Log[]
  where: any
}) {
  const [logs, setLogs] = useState(initialLogs)
  const [where, setWhere] = useState(initialWhere)
  const whereString = useMemo(() => JSON.stringify(where), [where])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    const hasFilters = Object.keys(JSON.parse(whereString)).length > 0
    setOpenIndex(hasFilters ? null : 0)
  }, [whereString])

  // This effect will re-fetch logs when the filters change on the client-side,
  // though currently all filtering is done on the server before the first render.
  // This is a placeholder for potential future client-side fetching/filtering.
  useEffect(() => {
    // In a real-world scenario with client-side filtering,
    // you might fetch logs here based on `where`.
    // For now, we just update the state if initialLogs change.
    setLogs(initialLogs)
    setWhere(initialWhere)
  }, [initialLogs, initialWhere])

  return (
    <Logs
      logs={logs}
      where={where}
      openIndex={openIndex}
      setOpenIndex={setOpenIndex}
    />
  )
}
