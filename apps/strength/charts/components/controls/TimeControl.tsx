'use client'

import { Combobox, InputBase, Input, useCombobox } from '@mantine/core'
import {
  useChartControlsStore,
  hoursBackOptions,
} from '../../state/useChartControlsStore'
import React from 'react'

interface Props {
  showLabel?: boolean
}

export default function TimeControl({ showLabel = true }: Props) {
  // Get state and actions from Zustand store
  const { hoursBack, setHoursBack } = useChartControlsStore()

  // ComboBox for time range selector
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  return (
    <Combobox
      offset={0}
      store={combobox}
      withinPortal={false}
      onOptionSubmit={(val) => {
        setHoursBack(val)
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target>
        <InputBase
          styles={{
            input: {
              minWidth: '80px',
              maxHeight: '30px',
              overflow: 'hidden',
            },
          }}
          component="button"
          type="button"
          pointer
          rightSection={<Combobox.Chevron />}
          onClick={() => combobox.toggleDropdown()}
          rightSectionPointerEvents="none"
          label={showLabel ? 'Range' : null}
        >
          {hoursBack ? (
            hoursBack
          ) : (
            <Input.Placeholder>Pick range</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown style={{ zIndex: 10000000, minWidth: '80px' }}>
        <Combobox.Options>
          {hoursBackOptions.map((option) => (
            <Combobox.Option value={option} key={option}>
              {option}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
