'use client'

import React from 'react'
import { useChartControlsStore } from '../state/useChartControlsStore'
import { Select } from '@mantine/core'

interface Props {
  showLabel?: boolean
}

export default function PriceControl({ showLabel = true }: Props) {
  // Get state and actions from Zustand store
  const { controlTickers, priceTicker, setPriceTicker } =
    useChartControlsStore()

  return (
    <Select
      style={{ zIndex: 10000000 }}
      label={showLabel ? 'Price:' : null}
      value={priceTicker}
      data={controlTickers}
      onChange={(value) => (value ? setPriceTicker(value) : undefined)}
    />
  )
}
