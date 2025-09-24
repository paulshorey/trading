'use client'

import React from 'react'

interface RealtimeIndicatorProps {
  isRealtime: boolean
  lastUpdateTime: Date | null
}

export function RealtimeIndicator({
  isRealtime,
  lastUpdateTime,
}: RealtimeIndicatorProps) {
  if (!isRealtime || !lastUpdateTime) return null

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  return (
    <div className="fixed bottom-1 right-1 z-[10001]">
      <span className="text-xs text-gray-600">
        {formatTime(lastUpdateTime)}
      </span>
    </div>
  )
}
