import { Combobox, InputBase, Input, useCombobox } from '@mantine/core'
import {
  useChartControlsStore,
  intervalsOptions,
} from '../../state/useChartControlsStore'
import React from 'react'

interface Props {
  showLabel?: boolean
}

export default function IntervalControl({ showLabel = true }: Props) {
  // Get state and actions from Zustand store
  const { interval, setInterval } = useChartControlsStore()

  // ComboBox for interval selector
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  // Convert array to string for value comparison
  const currentInterval = JSON.stringify(interval)

  // Find the selected option label
  const selectedOption = intervalsOptions.find(
    (item) => JSON.stringify(item.value) === currentInterval
  )

  return (
    <Combobox
      offset={0}
      store={combobox}
      withinPortal={false}
      onOptionSubmit={(val) => {
        setInterval(JSON.parse(val) as string[])
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target>
        <InputBase
          styles={{
            input: {
              minWidth: '70px',
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
          label={showLabel ? 'Interval' : null}
        >
          {selectedOption ? (
            selectedOption.label
          ) : (
            <Input.Placeholder>Pick interval</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown style={{ zIndex: 10000000, minWidth: '70px' }}>
        <Combobox.Options>
          {intervalsOptions.map((option) => (
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
