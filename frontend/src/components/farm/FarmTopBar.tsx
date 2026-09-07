import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Farm } from '@/api/types'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

type FarmTopBarProps = {
  farm: Farm
  viewLabel: string
  viewIcon: LucideIcon
  actions?: ReactNode
}

export const FarmTopBar = ({
  farm,
  viewLabel,
  viewIcon: ViewIcon,
  actions,
}: FarmTopBarProps) => (
  <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-1 @container">
    <SidebarTrigger
      className="size-8 shrink-0 md:hidden"
      aria-label="Vis eller skjul sidepanelet"
    />
    <Separator orientation="vertical" className="h-5 md:hidden" />

    <div className="flex min-w-0 flex-1 items-center gap-2">
      <h1 className="truncate font-display text-lg tracking-tight">
        {farm.name}
      </h1>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/60"
        aria-hidden="true"
      />
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        <ViewIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{viewLabel}</span>
      </span>
    </div>

    {actions ? (
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    ) : null}
  </header>
)
