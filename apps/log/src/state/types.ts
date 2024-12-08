import React from 'react'
import { createContext } from 'react'

export type Log = {
  time: number
  message: string
  category: string
  tag: string
  name: string
  app_name: string
  server_name: string
  dev: boolean
  stack: string
}

export type ProviderProps = {
  children: React.ReactNode
}
export type SearchParams = Record<string, string>
export type Controls = {
  groupBy: string
  where: Record<string, string | number | boolean>
}
export type Results = Log[]
export type ContextValue = {
  controls: Controls
  results: Results
  addControls: (newControls: Partial<Controls>) => void
}

export const Context = createContext<ContextValue | undefined>(undefined)
