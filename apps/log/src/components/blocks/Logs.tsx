'use client'

import { Json } from '@my/fe/src/ui/components/blocks/Json'
import { Collapsed } from '@my/fe/src/ui/components/blocks/Collapsed'
import { LocalShortTime } from '@my/fe/src/ui/components/inline/LocalShortTime'
import { Copy } from '@my/fe/src/ui/components/inline/Copy'
import { HoverTooltip } from '@my/fe/src/ui/components/inline/HoverTooltip'
import React, { useEffect, useState } from 'react'
import classes from './Logs.module.scss'
import { LogsControls } from './LogsControls'
import {
  ControlsAndResultsProvider,
  useControlsAndResults,
} from '@src/state/ControlsAndResults'
import { Log } from '@src/state/types'

export function Logs() {
  const [href, setHref] = useState('/')
  const { controls, results, addControls } = useControlsAndResults()
  useEffect(() => {
    setHref(window.location.href)
  }, [])

  if (!results) {
    return <div>Loading...</div>
  }
  let previousMessage = ''
  const sections = results.map((log: Log, i: number) => {
    let dataParsed
    try {
      dataParsed = log.stack ? JSON.parse(log.stack) : null
    } catch (e) {
      dataParsed = `Could not serialize log.stack=${log.stack}`
    }
    const duplicate = log.message === previousMessage
    previousMessage = log.message
    return (
      <Collapsed
        classNames={{
          content: 'rounded-md bg-gray-800',
        }}
        key={i}
        title={log.message}
        buttonsRight={[
          <span key="message" className={classes.badge}>
            <HoverTooltip label="copy message">
              <Copy text={log.message} className="align-middle self-center" />
            </HoverTooltip>
          </span>,
          <span key="category" className={classes.badge}>
            <HoverTooltip label="category">
              <span
                onClick={() =>
                  addControls({ where: { category: log.category } })
                }
              >
                {log.category || '-'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="tag" className={classes.badge}>
            <HoverTooltip label="tag">
              <span onClick={() => addControls({ where: { tag: log.tag } })}>
                {' '}
                {log.tag || '-'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="name" className={classes.badge}>
            <HoverTooltip label="name">
              <span onClick={() => addControls({ where: { name: log.name } })}>
                {' '}
                {log.name || '-'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="app_name" className={classes.badge}>
            <HoverTooltip label="app_name">
              <span
                onClick={() =>
                  addControls({ where: { app_name: log.app_name } })
                }
              >
                {log.app_name || '-'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="server_name" className={classes.badge}>
            <HoverTooltip label="server_name">
              <span
                onClick={() =>
                  addControls({ where: { server_name: log.server_name } })
                }
              >
                {log.server_name || '-'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="dev" className={classes.badge}>
            <HoverTooltip label="dev (boolean)">
              <span onClick={() => addControls({ where: { dev: log.dev } })}>
                {log.dev ? 'dev' : 'pro'}
              </span>
            </HoverTooltip>
          </span>,
          <span key="time" className={classes.badge}>
            <HoverTooltip label={log.time.toString()}>
              <span
                onClick={() => addControls({ where: { time: '<' + log.time } })}
              >
                <LocalShortTime epoch={log.time} />
              </span>
            </HoverTooltip>
          </span>,
        ]}
        openDefault={
          i === 0 && (results[0] as Log)?.time > Date.now() - 1000 * 60 * 60
        }
        isClickToToggle
        className="relative px-4 pt-3 pb-3 border-b border-gray-600 "
        suppressHydrationWarning
        style={{
          margin: duplicate ? '-1rem 0 0 4rem' : undefined,
        }}
      >
        <Json data={dataParsed} />
      </Collapsed>
    )
  })

  // let tags = []
  // for (let key in where) {
  //   tags.push(`${key}='${where[key]}'`)
  // }
  return (
    <div>
      <LogsControls />
      {/* <TagsInput
        defaultValue={tags}
        clearable
        styles={{
          input: {
            zoom: '1.25',
            borderRadius: 0,
            padding: '0.25rem 0.3rem 0.15rem',
          },
          pill: { zoom: '1.25', padding: '0 0 0.15rem 0.45rem' },
        }}
        onChange={(newTags) => {
          let obj = {} as Record<string, string>
          for (let str of newTags) {
            let arr = str.split('=')
            let key = arr[0]?.trim()
            let val = arr[1]?.replace(/'/g, '').trim() || ''
            if (key) {
              if (key[key.length - 1] === '!') {
                if (!val) continue
                val = '!' + val
                key = key.substring(0, key.length - 1)
              }
              obj[key] = val
            }
          }
          let qs = qsObjectToString(obj)
          window.location.href = window.location.pathname + '?' + qs
        }}
      /> */}
      <main>{sections}</main>
    </div>
  )
}
