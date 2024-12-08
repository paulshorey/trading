import React, { useEffect, useState } from 'react'
import { logGets } from '@my/be/sql/log/get'
import { useSearchParams } from 'next/navigation'
import { Context, ProviderProps, Controls, Results } from '@src/state/types'
import {
  makeControlsFromSearchParams,
  pushRouterFromControls,
} from '@src/state/helpers'

const defaultControls: Controls = {
  groupBy: '',
  where: {},
}

export const ControlsAndResultsProvider = ({ children }: ProviderProps) => {
  const nextSearchParams = useSearchParams()
  const searchParams = Object.fromEntries(nextSearchParams?.entries())
  console.log('ControlsAndResultsProvider() searchParams=', searchParams)

  /*
   * User updates controls (form fields and selectors)
   */
  const [controls, setControls] = useState<Controls>(defaultControls)
  const addControls = (addedControls: Partial<Controls>) => {
    const newControls = {
      ...controls,
      ...addedControls,
    }
    console.warn('addControls() newControls=', addedControls)
    setControls(newControls)
    pushRouterFromControls(newControls)
    fetchResults(newControls)
  }
  // initial page load, create controls from querysting
  useEffect(() => {
    addControls(makeControlsFromSearchParams(searchParams))
  }, [])

  /*
   * App fetches new data based on user filters
   */
  const [results, setResults] = useState<Results>([])
  const fetchResults = async (newControls: Controls) => {
    console.log('fetchResults() called')
    const { error, result } = await logGets({
      where: newControls.where,
      groupBy: newControls.groupBy,
      limit: 200,
    })
    if (error) {
      throw error
    }
    setResults(result)
  }

  return (
    <Context.Provider value={{ controls, results, addControls }}>
      {children}
    </Context.Provider>
  )
}

export const useControlsAndResults = () => {
  const context = React.useContext(Context)
  if (!context)
    throw new Error(
      'useControlsAndResults must be used within a ControlsAndResultsProvider'
    )
  return context
}
