'use client'

import * as React from 'react'
import { Tabs } from '@my/fe/src/components/mantine'
import classes from './index.module.scss'
import Phind from './Phind'
import Perplexity from './Perplexity'
import YouTube from './Youtube'
import Strings from './Strings'

export default function SearchInNewTab({}) {
  return (
    <Tabs defaultValue="phind" className={classes.container}>
      <Tabs.List className={classes.tabsList}>
        <div className={classes.tabsListOverflow}>
          <Tabs.Tab
            value="phind"
            leftSection={<b>s</b>}
            className={classes.tab}
          >
            Phind
          </Tabs.Tab>
          <Tabs.Tab
            value="perplexity"
            leftSection={<b>s</b>}
            className={classes.tab}
          >
            Perplexity
          </Tabs.Tab>
          <Tabs.Tab
            value="youtube"
            leftSection={<b>s</b>}
            className={classes.tab}
          >
            YouTube
          </Tabs.Tab>
          <Tabs.Tab
            value="strings"
            leftSection={<span className="mr-[-0.25rem]">Format</span>}
            className={classes.tab}
          >
            strings
          </Tabs.Tab>
        </div>
      </Tabs.List>

      <Tabs.Panel value="phind">
        <Phind />
      </Tabs.Panel>

      <Tabs.Panel value="perplexity">
        <Perplexity />
      </Tabs.Panel>

      <Tabs.Panel value="youtube">
        <YouTube />
      </Tabs.Panel>
      <Tabs.Panel value="strings">
        <Strings />
      </Tabs.Panel>
    </Tabs>
  )
}
