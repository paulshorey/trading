'use client'

import React from 'react'
import { Combobox, InputBase, Input, useCombobox } from '@mantine/core'
import {
  useChartControlsStore,
  tickersOptions,
} from '../state/useChartControlsStore'
import { IconChevronDown } from '@tabler/icons-react'

interface Props {
  showLabel?: boolean
}

export default function StrengthControl({ showLabel = true }: Props) {
  // Get state and actions from Zustand store
  const { controlTickers, updateControlTickersAndPrice } =
    useChartControlsStore()

  // ComboBox for ticker selector
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  // Find the selected option label
  const selectedOption = tickersOptions.find(
    (item) => JSON.stringify(item.value) === JSON.stringify(controlTickers)
  )

  return (
    <Combobox
      offset={2}
      store={combobox}
      withinPortal={true}
      position="bottom-start"
      onOptionSubmit={(val) => {
        updateControlTickersAndPrice(JSON.parse(val) as string[])
        combobox.closeDropdown()
      }}
      styles={{
        dropdown: {
          boxShadow: '1px 1px 4px 0 rgba(0, 0, 0, 0.1)',
          marginTop: '-22.5vh',
          maxHeight: '45vh',
          overflowY: 'auto',
        },
      }}
    >
      <Combobox.Target>
        <InputBase
          styles={{
            input: {
              minWidth: '95px',
              // border: 'solid 1px rgba(0, 0, 0, 0.2)',
              // boxShadow: '1px 1px 2px 0 rgba(0, 0, 0, 0.1)',
              // borderRadius: '5px',
              pointerEvents: 'all',
              userSelect: 'all',
            },
          }}
          component="button"
          type="button"
          pointer
          rightSection={<IconChevronDown size={14} />}
          onClick={() => combobox.toggleDropdown()}
          rightSectionPointerEvents="none"
          label={showLabel ? 'True Strength:' : null}
        >
          {selectedOption ? (
            selectedOption.label
          ) : (
            <Input.Placeholder>Pick ticker</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown style={{ zIndex: 1000000000, minWidth: '125px' }}>
        <Combobox.Options>
          {tickersOptions.map((option) => (
            <Combobox.Option
              value={JSON.stringify(option.value)}
              key={JSON.stringify(option.value)}
            >
              {option.label}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
