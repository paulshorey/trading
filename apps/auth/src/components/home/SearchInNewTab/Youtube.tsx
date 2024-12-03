'use client'

import * as React from 'react'
import { Button, NativeSelect, TextInput } from '@my/fe/src/components/mantine'
import classes from './index.module.scss'

export default function HomeYoutube() {
  const [value, setValue] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  return (
    <div className={`${classes.container} pb-6 ml-0`}>
      <form
        ref={formRef}
        method="GET"
        action="https://youtube.com/results"
        target="_blank"
        onSubmit={(e) => {
          if (!value) {
            e.preventDefault()
          }
        }}
      >
        <div className={classes.inputGroup}>
          <div>
            <TextInput
              name="search_query"
              className={classes.textarea}
              placeholder="..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (value) {
                    formRef.current?.submit()
                  }
                }
              }}
              onChange={(e) => {
                setValue(e.currentTarget.value)
              }}
              rightSection={
                <Button
                  type="submit"
                  className={`${classes.button} text-green-500`}
                >
                  <b>ok</b>
                </Button>
              }
            />
            <NativeSelect
              leftSection={<b>v</b>}
              name="sp"
              data={[
                { label: 'long videos (>20 min)', value: 'EgIYAg%253D%253D' },
                { label: 'medium (4-20 min)', value: 'EgIYAw%253D%253D' },
                { label: 'short (<4 min)', value: 'EgIYAQ%253D%253D' },
                { label: 'Today', value: 'EgIIAg%253D%253D' },
                { label: 'This week', value: 'EgQIAxAB' },
                { label: 'This month', value: 'EgQIBBAB' },
                { label: 'Today 4-20 min', value: 'EgYIAhABGAM%253D' },
                { label: 'This week 4-20 min', value: 'EgYIAxABGAM%253D' },
                { label: 'This month 4-20 min', value: 'EgYIBBABGAM%253D' },
              ]}
              value=">20"
              onChange={(e) => {
                if (value) {
                  formRef.current?.submit()
                }
              }}
            />
          </div>
        </div>
      </form>
    </div>
  )
}
