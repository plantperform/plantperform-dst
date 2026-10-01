import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const RULES_CARD_CLASS = 'min-w-0 rounded-lg border bg-card shadow-sm'

export const RULES_CARD_HEAD_CLASS =
  'flex items-start justify-between gap-4 px-5 pt-3.5 pb-3'

type CollapseButtonProps = {
  expanded: boolean
  controls: string
  onExpandedChange: (expanded: boolean) => void
}

export const CollapseButton = ({
  expanded,
  controls,
  onExpandedChange,
}: CollapseButtonProps) => {
  const Icon = expanded ? ChevronUp : ChevronDown
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 gap-1 px-2.5 text-muted-foreground"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={() => onExpandedChange(!expanded)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {expanded ? 'Skjul' : 'Vis'}
    </Button>
  )
}

export const UnsavedDot = ({ label }: { label?: string }) => (
  <span className="size-1.5 shrink-0 rounded-full bg-rules">
    {label ? <span className="sr-only">{label}</span> : null}
  </span>
)

type LimitsColumnProps = {
  title: string
  term?: GlossaryTerm
  children: ReactNode
}

export const LimitsColumn = ({ title, term, children }: LimitsColumnProps) => (
  <section className="min-w-0 px-5 pt-4 pb-3">
    <h4 className="flex min-h-5 items-center gap-1 text-xs font-semibold text-muted-foreground">
      {title}
      {term ? <GlossaryInfo term={term} /> : null}
    </h4>
    {children}
  </section>
)

export const SummaryList = ({ children }: { children: ReactNode }) => (
  <div className="mt-1.5 divide-y">{children}</div>
)

type LimitValueProps = {
  prefix?: string | null
  amount: string | null
  unit: string
}

export const LimitValue = ({ prefix, amount, unit }: LimitValueProps) =>
  amount === null ? (
    <span className="text-[13px] text-muted-foreground">Ingen grænse</span>
  ) : (
    <span className="whitespace-nowrap">
      {prefix ? (
        <span className="text-xs text-muted-foreground">{prefix} </span>
      ) : null}
      <span className="text-[15px] font-semibold tabular-nums">{amount}</span>
      <span className="text-xs text-muted-foreground"> {unit}</span>
    </span>
  )

type SummaryRowProps = {
  label: ReactNode
  note?: string | null
  value: ReactNode
  changed: boolean
  children?: ReactNode
}

export const SummaryRow = ({
  label,
  note,
  value,
  changed,
  children,
}: SummaryRowProps) => (
  <div className="py-2.5">
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-[13px]">{label}</div>
        {note ? (
          <div className="mt-px text-xs text-muted-foreground">{note}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {value}
        {changed ? <UnsavedDot label="Ikke gemt" /> : null}
      </div>
    </div>
    {children}
  </div>
)

type FieldLabelProps = {
  htmlFor: string
  label: ReactNode
  hint?: ReactNode
}

export const FieldLabel = ({ htmlFor, label, hint }: FieldLabelProps) => (
  <div className="mb-1.5 flex items-baseline justify-between gap-2">
    <Label htmlFor={htmlFor} className="text-xs font-semibold">
      {label}
    </Label>
    {hint ? (
      <span className="text-xs text-muted-foreground">{hint}</span>
    ) : null}
  </div>
)

type UnitInputProps = ComponentProps<'input'> & { unit: string }

export const UnitInput = ({ unit, className, ...props }: UnitInputProps) => (
  <div className="relative">
    <Input className={cn('h-9 pr-12', className)} {...props} />
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
    >
      {unit}
    </span>
  </div>
)

type RulesNoticeProps = {
  tone: 'warning' | 'error'
  children: ReactNode
}

export const RulesNotice = ({ tone, children }: RulesNoticeProps) => (
  <p
    className={cn(
      'flex items-start gap-1.5 text-xs',
      tone === 'warning' ? 'text-warning-strong' : 'text-destructive',
    )}
  >
    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </p>
)

export const RulesHint = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
)
