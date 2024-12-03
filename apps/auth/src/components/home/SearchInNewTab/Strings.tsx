'use client'

import * as React from 'react'
import { Button, Flex, Select, TextInput } from '@my/fe/src/components/mantine'
import { fromByteArray } from 'base64-js'
import classes from './index.module.scss'

export default function HomeYoutube() {
  const [input, setInput] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [operation, setOperation] = React.useState('encode URL')
  // const [previousKey, setPreviousKey] = React.useState('');
  const handleSubmit = () => {
    if (!operation) {
      setOutput(input || '')
    }
    try {
      switch (operation) {
        case 'timestamp':
          setOutput(Date.now().toString())
          break
        case 'decode URL':
          setOutput(decodeURIComponent(input))
          break
        case 'encode URL':
          setOutput(encodeURIComponent(input))
          break
        case 'decode base64': {
          const uint8 = new TextEncoder().encode(decodeURIComponent(input))
          setOutput(fromByteArray(uint8))
          break
        }
        default:
          setOutput('')
          break
      }
    } catch (err: any) {
      setOutput(err?.message || err?.toString() || '')
    }
  }
  return (
    <div className={`${classes.container} mb-6`}>
      <Flex className={`${classes.inputGroup}`}>
        <TextInput
          name="input"
          className={classes.textarea}
          placeholder="..."
          value={input}
          onChange={(e) => {
            console.log('e.target.value', e.target.value)
            setOutput('')
            setInput(e.target.value)
          }}
          onBlur={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <Select
          className={classes.textarea}
          name="operation"
          data={['encode URL', 'decode URL', 'decode base64', 'timestamp']}
          value={operation}
          onBlur={handleSubmit}
          onChange={function (val) {
            const value = val || ''
            setOutput('')
            setOperation(value)
            setTimeout(() => {
              handleSubmit()
            }, 300)
          }}
          rightSection={<b>v</b>}
        />
      </Flex>
      {!!output && <code className="block px-3 py-2 text-sm">{output}</code>}
      <div className={`${classes.buttonContainer}`}>
        <Button
          className={`${classes.button} text-green-500`}
          onClick={() => {
            handleSubmit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        >
          {!!output && <span className="text-xs">copy&ensp;</span>}
          <b>cp</b>
        </Button>
      </div>
    </div>
  )
}
