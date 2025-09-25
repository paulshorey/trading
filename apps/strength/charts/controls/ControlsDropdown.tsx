import { Popover } from '@mantine/core'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import StrengthControl from './StrengthControl'
import PriceControl from './PriceControl'
import IntervalControl from './IntervalControl'
import TimeControl from './TimeControl'

export function ControlsDropdown() {
  return (
    <Popover position="bottom-end" offset={0} shadow="md">
      {/* @ts-ignore */}
      <Popover.Target className="text-gray-700 cursor-pointer">
        <IconAdjustmentsHorizontal size={28} className="pt-1 mr-[-5px]" />
      </Popover.Target>
      <Popover.Dropdown style={{ zIndex: 10000000 }}>
        {/* Tickers */}
        <div className="pb-2">
          <StrengthControl />
        </div>

        {/* Price */}
        <div className="pb-2">
          <PriceControl />
        </div>

        {/* Time range selector */}
        <div className="pb-2">
          <TimeControl />
        </div>

        {/* Interval selector */}
        <div className="pb-2">
          <IntervalControl />
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
