import { Columns2, List, Map as MapIcon } from 'lucide-react'

import type { FarmView } from '@/components/farm/types'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'

const SPLIT_UNAVAILABLE_TITLE = 'Skærmen er for smal til delt visning'

const VIEW_OPTIONS: SegmentedControlOption<FarmView>[] = [
  { value: 'list', label: 'Liste', icon: List },
  { value: 'split', label: 'Delt', icon: Columns2 },
  { value: 'map', label: 'Kort', icon: MapIcon },
]

type ViewModeSwitchProps = {
  view: FarmView
  splitAvailable: boolean
  onViewChange: (view: FarmView) => void
}

export const ViewModeSwitch = ({
  view,
  splitAvailable,
  onViewChange,
}: ViewModeSwitchProps) => (
  <SegmentedControl
    aria-label="Liste, delt eller kort"
    value={view}
    options={VIEW_OPTIONS.map((option) =>
      option.value === 'split' && !splitAvailable
        ? { ...option, disabled: true, title: SPLIT_UNAVAILABLE_TITLE }
        : option,
    )}
    onValueChange={(next) => {
      if (next !== view) onViewChange(next)
    }}
    className="grid h-auto w-full grid-cols-3 gap-0.5 rounded-[10px] border-0 bg-sidebar-accent p-[3px]"
    optionClassName="h-[30px] justify-center rounded-lg px-0 text-[13px]"
    labelClassName="inline"
  />
)
