import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

type OverviewCollapseToggleProps = {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  controls: string
}

export const OverviewCollapseToggle = ({
  collapsed,
  onCollapsedChange,
  controls,
}: OverviewCollapseToggleProps) => {
  const [dismissed, setDismissed] = useState(false)
  const Icon = collapsed ? ChevronDown : ChevronUp

  const toggle = () => {
    setDismissed(true)
    onCollapsedChange(!collapsed)
  }

  return (
    <div
      onPointerLeave={() => setDismissed(false)}
      className={cn(
        'group relative -my-1 h-0 shrink-0 transition-[height] delay-100 duration-200 ease-out has-focus-visible:h-4 has-focus-visible:delay-0 motion-reduce:transition-none pointer-coarse:h-4',
        !dismissed && 'hover:h-4 hover:delay-150',
      )}
    >
      <span aria-hidden="true" className="absolute inset-x-0 -inset-y-1.5" />
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 top-1/2 h-px bg-transparent transition-colors delay-100 duration-200 group-has-focus-visible:bg-border group-has-focus-visible:delay-0 pointer-coarse:bg-border',
          !dismissed && 'group-hover:bg-border group-hover:delay-150',
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-95 opacity-0 transition-[opacity,scale] delay-100 duration-200 ease-out group-has-focus-visible:pointer-events-auto group-has-focus-visible:scale-100 group-has-focus-visible:opacity-100 group-has-focus-visible:delay-0 motion-reduce:scale-100 pointer-coarse:pointer-events-auto pointer-coarse:scale-100 pointer-coarse:opacity-100',
          !dismissed &&
            'group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 group-hover:delay-150',
        )}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={controls}
          onClick={toggle}
          className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-full border bg-card px-2.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {collapsed ? 'Vis årsgennemgang' : 'Skjul årsgennemgang'}
        </button>
      </span>
    </div>
  )
}
