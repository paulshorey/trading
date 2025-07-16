'use client'

import classes from './Data.module.scss'
import { Json } from '@my/fe/src/components/blocks/Json'
import { Collapsed } from '@my/fe/src/components/blocks/Collapsed'

export function Data({ data, expandUntil }: { data: Record<string, unknown>; expandUntil: number }) {
  const sections = Object.entries(data).map(([key, obj], i: number) => {
    let heading = key
    let dataParsed = obj
    if (!expandUntil) expandUntil || (key === 'orders' ? 1 : 2)

    return (
      <Collapsed
        classNames={{
          content: 'rounded-md bg-gray-800',
        }}
        key={i}
        title={heading}
        openDefault={i === 0}
        isClickToToggle
        className="relative px-4 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={dataParsed as Record<string, unknown>} expandUntil={expandUntil} />
      </Collapsed>
    )
  })

  return <main className={classes.container}>{sections}</main>
}
