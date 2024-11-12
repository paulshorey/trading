'use client'

import Json from '@my/fe/src/components/blocks/Json'
import Collapsed from '@my/fe/src/components/blocks/Collapsed'
import LocalShortTime from '@my/fe/src/components/inline/LocalShortTime'
import Badge from '@my/fe/src/components/inline/Badge'
import Link from 'next/link'
import Copy from '../../../../../my/fe/src/components/buttons/Copy'
// import { cc } from '@my/be/cc';
// import { useEffect } from 'react';

export default function Logs({ logs, where }: any) {
  // cc.info('Logs client rendered', ['client', 'Logs.tsx', `logs.length=${logs.length}`]);
  // useEffect(() => {
  //   cc.info('Logs client useEffect', ['client', 'Logs.tsx', `logs.length=${logs.length}`]);
  // },[]);
  let tempReset = false
  if (Object.keys(where).length > 0) {
    tempReset = true
  }

  const sections = logs.map((log: any, i: number) => {
    let message = log.message
    let dataParsed
    try {
      dataParsed = log.stack ? JSON.parse(log.stack) : null
    } catch (e) {
      dataParsed = `Could not serialize log.stack=${log.stack}`
    }

    return (
      <Collapsed
        classNames={{
          content: 'rou🔻nded-md bg-gray-800',
        }}
        key={i}
        title={message}
        buttonsRight={[
          <span>
            <Copy text={message} className="align-middle self-center" />
          </span>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?category=${log.category}`}>
              {' '}
              {log.category}{' '}
            </Link>
          </Badge>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?tag=${log.tag}`}>
              {' '}
              {log.tag}{' '}
            </Link>
          </Badge>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?name=${log.name}`}>
              {' '}
              {log.name}{' '}
            </Link>
          </Badge>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?app_name=${log.app_name}`}>
              {' '}
              {log.app_name}{' '}
            </Link>
          </Badge>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?server_name=${log.server_name}`}>
              {' '}
              {log.server_name}{' '}
            </Link>
          </Badge>,
          <Badge className="font-bold pr-2">
            <Link key="edit" href={`/?dev=${log.dev}`}>
              {' '}
              {log.dev ? 'dev' : 'pro'}{' '}
            </Link>
          </Badge>,
          <Badge key="time">
            <LocalShortTime epoch={log.time} />
          </Badge>,
        ]}
        openDefault={i === 0}
        isClickToToggle
        className="relative px-4 pt-3 pb-3 border-b border-gray-600 "
      >
        <Json data={dataParsed} />
      </Collapsed>
    )
  })

  return (
    <div>
      {tempReset && (
        <div>
          <Link href="/">◀ clear</Link>
        </div>
      )}
      <main>{sections}</main>
    </div>
  )
}
