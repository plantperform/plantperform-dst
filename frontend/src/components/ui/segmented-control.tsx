import type { LucideIcon } from 'lucide-react'

import { AppTooltip } from '@/components/ui/app-tooltip'
import { cn } from '@/lib/utils'

export type SegmentedControlOption<T extends string> = {
  value: T
  label: string
  icon: LucideIcon
  title?: string
  disabled?: boolean
  activeClassName?: string
}

type SegmentedControlProps<T extends string> = {
  value: T
  options: SegmentedControlOption<T>[]
  onValueChange: (value: T) => void
  'aria-label': string
  className?: string
  optionClassName?: string
  labelClassName?: string
  disabled?: boolean
}

export const SegmentedControl = <T extends string>({
  value,
  options,
  onValueChange,
  className,
  optionClassName,
  labelClassName = 'hidden sm:inline',
  disabled = false,
  ...props
}: SegmentedControlProps<T>) => (
  <div
    role="group"
    aria-label={props['aria-label']}
    className={cn(
      'flex h-8 shrink-0 items-center gap-0.5 rounded-md border bg-muted p-0.5',
      className,
    )}
  >
    {options.map((option) => {
      const active = option.value === value
      const optionDisabled = disabled || Boolean(option.disabled)
      const Icon = option.icon
      return (
        <AppTooltip key={option.value} content={option.title}>
          <button
            type="button"
            aria-pressed={active}
            aria-label={option.label}
            disabled={optionDisabled}
            className={cn(
              'inline-flex h-6.5 items-center gap-1.5 rounded-sm px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              optionClassName,
              active
                ? cn(
                    'bg-card font-semibold text-primary shadow-xs',
                    option.activeClassName,
                  )
                : cn(
                    'text-muted-foreground',
                    !optionDisabled &&
                      'hover:bg-background/80 hover:text-foreground',
                  ),
            )}
            onClick={() => onValueChange(option.value)}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className={labelClassName}>{option.label}</span>
          </button>
        </AppTooltip>
      )
    })}
  </div>
)
