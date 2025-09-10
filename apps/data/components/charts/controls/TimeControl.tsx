'use client'

import React from 'react'
import { useChartControlsStore } from '../state/useChartControlsStore'
import { Select } from '@mantine/core'

interface Props {
  showLabel?: boolean
}

export default function TimeControl({ showLabel = true }: Props) {
  const { hoursBack, setHoursBack } = useChartControlsStore()

  return (
    <Select
      style={{ width: '80px', zIndex: 10000000 }}
      label={showLabel ? 'Range' : null}
      value={hoursBack.toString()}
      data={['240h', '120h', '60h', '48h', '36h', '24h', '12h']}
      onChange={(value) => (value ? setHoursBack(value) : undefined)}
    />
  )
}
