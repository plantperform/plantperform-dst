import { Columns2, List, Map as MapIcon } from 'lucide-react'

import type { FarmView } from '@/components/farm/types'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import { useSidebar } from '@/components/ui/sidebar'

const SPLIT_UNAVAILABLE_TITLE = 'Skærmen er for smal til delt visning'

const VIEW_OPTIONS: SegmentedControlOption<FarmView>[] = [
  { value: 'list', label: 'Liste', icon: List },
  { value: 'split', label: 'Delt', icon: Columns2 },
  { value: 'map', label: 'Kort', icon: MapIcon },
]

const buildViewOptions = (
  splitAvailable: boolean,
  iconRail: boolean,
): SegmentedControlOption<FarmView>[] =>
  VIEW_OPTIONS.map((option) => {
    const splitUnavailable = option.value === 'split' && !splitAvailable
    return {
      ...option,
      disabled: splitUnavailable,
      title: splitUnavailable
        ? SPLIT_UNAVAILABLE_TITLE
        : iconRail
          ? option.label
          : undefined,
    }
  })

type ViewModeSwitchProps = {
  view: FarmView
  splitAvailable: boolean
  onViewChange: (view: FarmView) => void
}

export const ViewModeSwitch = ({
  view,
  splitAvailable,
  onViewChange,
}: ViewModeSwitchProps) => {
  const iconRail = useSidebar().state === 'collapsed'

  return (
    <SegmentedControl
      aria-label="Liste, delt eller kort"
      value={view}
      options={buildViewOptions(splitAvailable, iconRail)}
      onValueChange={(next) => {
        if (next !== view) onViewChange(next)
      }}
      className={
        iconRail
          ? 'h-auto w-8 flex-col border-sidebar-border bg-sidebar-accent'
          : 'grid h-8 w-full grid-cols-3 border-sidebar-border bg-sidebar-accent'
      }
      optionClassName={
        iconRail ? 'size-7 justify-center px-0' : 'justify-center px-0'
      }
      labelClassName={iconRail ? 'sr-only' : 'inline'}
    />
  )
}
