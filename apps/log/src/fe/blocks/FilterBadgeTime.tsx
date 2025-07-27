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

  return (
    <Badge className="font-bold pr-2">
      <Link key="edit" href={`/?time_start=${startOfDay}&time_end=${endOfDay}`}>
        <LocalShortTime epoch={time} />
      </Link>
    </Badge>
  )
}
