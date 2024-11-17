'use client'

import classes from './Data.module.scss'
import { Json } from '@my/fe/src/components/blocks/Json'
import { Collapsed } from '@my/fe/src/components/blocks/Collapsed'
// import LocalShortTime from '@my/fe/src/components/inline/LocalShortTime'
// import Badge from '@my/fe/src/components/inline/Badge'
// import Link from 'next/link'

export function Data({
  data,
  expandUntil,
}: {
  data: Record<string, any>
  expandUntil: number
}) {
  const sections = Object.entries(data).map(([key, obj]: any, i: number) => {
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
        // buttonsRight={[
        //   <Badge className="font-bold pr-2">
        //     <Link key="edit" href={`/?name=${log.name}`}>
        //       {' '}
        //       {log.name}{' '}
        //     </Link>
        //   </Badge>,
        //   <Badge className="font-bold pr-2">
        //     <Link key="edit" href={`/?app_name=${log.app_name}`}>
        //       {' '}
        //       {log.app_name}{' '}
        //     </Link>
        //   </Badge>,
        //   <Badge className="font-bold pr-2">
        //     <Link key="edit" href={`/?server_name=${log.server_name}`}>
        //       {' '}
        //       {log.server_name}{' '}
        //     </Link>
        //   </Badge>,
        //   <Badge className="font-bold pr-2">
        //     <Link key="edit" href={`/?dev=${log.dev}`}>
        //       {' '}
        //       {log.dev ? 'dev' : 'pro'}{' '}
        //     </Link>
        //   </Badge>,
        //   <Badge key="time">
        //     <LocalShortTime epoch={log.time} />
        //   </Badge>,
        // ]}
        openDefault={i === 0}
        isClickToToggle
        className="relative px-4 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={dataParsed} expandUntil={expandUntil} />
      </Collapsed>
    )
  })

  return <main className={classes.container}>{sections}</main>
}
