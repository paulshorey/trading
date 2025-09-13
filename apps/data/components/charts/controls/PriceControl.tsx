'use client'

import React, { useMemo } from 'react'
import { useChartControlsStore } from '../state/useChartControlsStore'
import { Select } from '@mantine/core'

interface Props {
  showLabel?: boolean
}

export default function PriceControl({ showLabel = true }: Props) {
  // Get state and actions from Zustand store
  const { controlTickers, priceTicker, setPriceTicker } =
    useChartControlsStore()

  // Create select options with "average" option when multiple tickers are selected
  const selectOptions = useMemo(() => {
    const options = [...controlTickers]

    // Add "average" option only when there are multiple tickers
    if (controlTickers.length > 1) {
      options.unshift('average')
    }

    return options
  }, [controlTickers])

  return (
    <Select
      style={{ width: '95px', zIndex: 10000000 }}
      label={showLabel ? 'Price:' : null}
      value={priceTicker}
      data={selectOptions}
      onChange={(value) => {
        console.log('PriceControl onChange', value)
        if (value) {
          setPriceTicker(value)
        }
      }}
    />
  )
}
