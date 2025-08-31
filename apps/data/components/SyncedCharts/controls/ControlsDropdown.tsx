import {
  Popover,
  Select,
  Combobox,
  InputBase,
  Input,
  useCombobox,
} from '@mantine/core'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import {
  useChartControlsStore,
  intervalsOptions,
} from '../state/useChartControlsStore'

export function ControlsDropdown() {
  // Get state and actions from Zustand store
  const { hoursBack, controlInterval, setHoursBack, setControlInterval } =
    useChartControlsStore()

  // ComboBox for interval selector
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  // Convert array to string for value comparison
  const currentInterval = JSON.stringify(controlInterval)

  // Find the selected option label
  const selectedOption = intervalsOptions.find(
    (item) => JSON.stringify(item.value) === currentInterval
  )

  return (
    <Popover position="bottom-end" offset={0} shadow="md">
      <Popover.Target>
        <IconAdjustmentsHorizontal size={28} className="pt-1" />
      </Popover.Target>
      <Popover.Dropdown>
        {/* Time range selector */}
        <div>
          <Select
            label="Time range"
            value={hoursBack.toString()}
            data={['12', '24', '36', '48', '60']}
            onChange={(value) =>
              value ? setHoursBack(parseInt(value)) : undefined
            }
          />
        </div>

        <div>
          {/* Interval selector */}
          <Combobox
            store={combobox}
            withinPortal={false}
            onOptionSubmit={(val) => {
              setControlInterval(JSON.parse(val) as string[])
              combobox.closeDropdown()
            }}
          >
            <Combobox.Target>
              <InputBase
                component="button"
                type="button"
                pointer
                rightSection={<Combobox.Chevron />}
                onClick={() => combobox.toggleDropdown()}
                rightSectionPointerEvents="none"
                label="Interval"
              >
                {selectedOption ? (
                  selectedOption.label
                ) : (
                  <Input.Placeholder>Pick interval</Input.Placeholder>
                )}
              </InputBase>
            </Combobox.Target>

            <Combobox.Dropdown>
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
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
