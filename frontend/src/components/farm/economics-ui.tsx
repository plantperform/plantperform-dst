import { Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { formatSignedDkk } from '@/lib/economics'

export const TEXT_LINK_CLASS =
  'rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export const GRID_HEAD_CLASS =
  'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground'

const NOT_IN_CALCULATION = 'Indgår ikke i beregningen endnu'

const DOT_CLASS = 'inline-block size-1.5 shrink-0 rounded-full bg-warning'

export const CustomisedDot = () => (
  <span className={DOT_CLASS}>
    <span className="sr-only">(tilpasset)</span>
  </span>
)

export const NotInCalculationDot = () => (
  <AppTooltip content={NOT_IN_CALCULATION}>
    <span className={DOT_CLASS}>
      <span className="sr-only">{NOT_IN_CALCULATION}</span>
    </span>
  </AppTooltip>
)

export const NotInCalculationNote = () => (
  <span className="text-warning-strong">
    {' '}
    · indgår ikke i beregningen endnu
  </span>
)

export const CustomisedChip = () => (
  <span className="rounded bg-changed/40 px-1.5 text-[11px] font-medium text-foreground">
    tilpasset
  </span>
)

export const ChangedValue = ({ children }: { children: ReactNode }) => (
  <span className="rounded-md bg-changed/40 px-1.5 py-0.5 font-semibold">
    {children}
    <span className="sr-only"> (tilpasset)</span>
  </span>
)

export const DbDelta = ({ change }: { change: number }) =>
  change === 0 ? null : (
    <span className={change > 0 ? 'text-success-strong' : 'text-destructive'}>
      {formatSignedDkk(change)}
    </span>
  )

type RestoreButtonProps = {
  label: string
  onRestore: () => void
}

export const RestoreButton = ({ label, onRestore }: RestoreButtonProps) => (
  <AppTooltip content="Gendan standard">
    <button
      type="button"
      aria-label={`Gendan standard for ${label}`}
      className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={onRestore}
    >
      <Undo2 className="size-3.5" aria-hidden="true" />
    </button>
  </AppTooltip>
)
