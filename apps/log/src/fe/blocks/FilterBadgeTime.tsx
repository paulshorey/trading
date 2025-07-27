'use client'

import { Badge } from '@my/fe/src/components/inline/Badge'
import Link from 'next/link'
import { getDayRange } from '@my/fe/src/lib/time'
import { LocalShortTime } from '@my/fe/src/components/inline/LocalShortTime'

export function FilterBadgeTime({ time }: { time: number }) {
  if (!time) {
    return null
  }

  const { startOfDay, endOfDay } = getDayRange(time)
  const [localTime, localDate] = LocalShortTime({ epoch: time })

  return (
    <Badge className="font-bold pr-2">
      <span className="mr-1">{localTime}</span>
      <Link key="edit" href={`/?time_start=${startOfDay}&time_end=${endOfDay}`}>
        {localDate}
      </Link>
    </Badge>
  )
}
