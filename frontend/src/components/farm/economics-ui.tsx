import { Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { useFarmBudgets } from '@/api/economics'
import type { FarmingSystem } from '@/api/types'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { LoadError } from '@/components/ui/load-error'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import {
  dbDeltaBar,
  formatSignedDkk,
  type DbDeltaScale,
  type EconomicsAssumptions,
} from '@/lib/economics'
import { cn } from '@/lib/utils'

type BudgetsGateProps = {
  budgets: ReturnType<typeof useFarmBudgets>
  className?: string
  children: (assumptions: EconomicsAssumptions) => ReactNode
}

export const BudgetsGate = ({
  budgets,
  className,
  children,
}: BudgetsGateProps) => {
  if (budgets.data) return children(budgets.data)
  if (budgets.error) {
    return (
      <LoadError
        className={className}
        message="Bedriftens økonomital kunne ikke hentes."
        retrying={budgets.isValidating}
        onRetry={() => void budgets.mutate()}
      />
    )
  }
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <Spinner />
      Henter bedriftens økonomital
    </p>
  )
}

const FARMING_SYSTEMS: { value: FarmingSystem; label: string }[] = [
  { value: 'Konventionel', label: 'Konventionel' },
  { value: 'Økologisk', label: 'Økologisk' },
]

export const FarmingSystemSwitch = () => {
  const economics = useEconomicsProfiles()
  return (
    <SegmentedControl
      aria-label="Driftsform for tallene"
      value={economics.farmingSystem}
      options={FARMING_SYSTEMS}
      labelClassName=""
      onValueChange={economics.setFarmingSystem}
    />
  )
}

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

type DbDeltaBarProps = {
  delta: number
  scale: DbDeltaScale
}

export const DbDeltaBar = ({ delta, scale }: DbDeltaBarProps) => {
  const bar = dbDeltaBar(delta, scale)
  const rises = delta > 0
  return (
    <span aria-hidden="true" className="relative h-full">
      {delta === 0 ? null : (
        <span
          className={cn(
            'absolute top-2.5 h-2 min-w-0.5',
            rises
              ? 'rounded-r-[2px] bg-success/75'
              : 'rounded-l-[2px] bg-destructive/75',
          )}
          style={{
            width: `${bar.width * 100}%`,
            ...(rises
              ? { left: `${bar.axis * 100}%` }
              : { right: `${(1 - bar.axis) * 100}%` }),
          }}
        />
      )}
      <span
        className="absolute inset-y-0 w-px bg-foreground/20"
        style={{ left: `${bar.axis * 100}%` }}
      />
    </span>
  )
}

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
