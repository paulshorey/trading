'use client'

import { Badge } from '@my/fe/src/components/inline/Badge'
import Link from 'next/link'

export function FilterBadge({
  field,
  value,
}: {
  field: string
  value: string | boolean
}) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const displayValue =
    typeof value === 'boolean' ? (value ? 'dev' : 'pro') : value
  return (
    <Badge className="font-bold pr-2">
      <Link key="edit" href={`/?${field}=${value}`}>
        {' '}
        {displayValue}{' '}
      </Link>
    </Badge>
  )
}
