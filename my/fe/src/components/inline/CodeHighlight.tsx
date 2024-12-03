'use client'
import { CodeHighlight as MantineCodeHighlight } from '@mantine/code-highlight'
import React from 'react'

type Props = { code: string; language?: string } & React.ComponentProps<'span'>

export function CodeHighlight({ className, code, ref, ...props }: Props) {
  return (
    <MantineCodeHighlight className={`${className}`} {...props} code={code} />
  )
}
