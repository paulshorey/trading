'use client'

import * as React from 'react'
import { Button, Group, Textarea } from '@my/fe/src/components/mantine'
import classes from './index.module.scss'

export default function HomePhind() {
  const [previousKey, setPreviousKey] = React.useState('')
  const [value, setValue] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  const placeholder = `Ask anything. Be detailed and specific... 
\`\`\`
// include your code as markdown
\`\`\``
  return (
    <div className={`${classes.container}`}>
      <form
        ref={formRef}
        method="GET"
        action="https://phind.com/search"
        target="_blank"
        onSubmit={(e) => {
          if (!value) {
            e.preventDefault()
          }
        }}
      >
        <Group className={classes.inputGroup}>
          <Textarea
            name="q"
            className={`${classes.textarea}`}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (
                (previousKey === 'Shift' || previousKey === 'Meta') &&
                (e.key === 'Shift' || e.key === 'Meta')
              ) {
                setPreviousKey(previousKey + e.key)
              } else {
                setPreviousKey(e.key)
              }
              console.log(previousKey, e.key)
              if (
                (previousKey === 'ShiftMeta' || previousKey === 'MetaShift') &&
                e.key === 'Enter'
              ) {
                e.preventDefault()
                if (e.currentTarget.value) {
                  formRef.current?.submit()
                }
              }
            }}
            onChange={(e) => {
              setValue(e.currentTarget.value)
            }}
          />
          <div className={classes.buttonContainer}>
            <Button type="submit" className={`${classes.button}`}>
              <b>send</b>
            </Button>
          </div>
        </Group>
      </form>
      <div className="flex flex-row justify-between">
        <span> </span>
        {/* <h2 className={`${classes.title}`}>Phind.com</h2> */}
        <span className={classes.titleTip}>
          <b>Shift</b> + <b>Cmd</b> + <b>Enter</b> to submit
        </span>
      </div>
    </div>
  )
}
