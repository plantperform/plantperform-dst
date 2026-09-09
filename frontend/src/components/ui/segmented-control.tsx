import type { LucideIcon } from 'lucide-react'

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
  labelClassName?: string
  disabled?: boolean
}

export const SegmentedControl = <T extends string>({
  value,
  options,
  onValueChange,
  className,
  labelClassName = 'hidden sm:inline',
  disabled = false,
  ...props
}: SegmentedControlProps<T>) => (
  <div
    role="group"
    aria-label={props['aria-label']}
    className={cn(
      'flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5',
      className,
    )}
  >
    {options.map((option) => {
      const active = option.value === value
      const optionDisabled = disabled || Boolean(option.disabled)
      const Icon = option.icon
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={active}
          aria-label={option.label}
          title={option.title}
          disabled={optionDisabled}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            active
              ? cn('bg-card text-foreground shadow-sm', option.activeClassName)
              : cn(
                  'text-muted-foreground',
                  !optionDisabled &&
                    'hover:bg-background/80 hover:text-foreground',
                ),
          )}
          onClick={() => onValueChange(option.value)}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className={labelClassName}>{option.label}</span>
        </button>
      )
    })}
  </div>
)
