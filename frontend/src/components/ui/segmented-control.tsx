import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type SegmentedControlOption<T extends string> = {
  value: T
  label: string
  icon: LucideIcon
  title?: string
  activeClassName?: string
}

type SegmentedControlProps<T extends string> = {
  value: T
  options: SegmentedControlOption<T>[]
  onValueChange: (value: T) => void
  'aria-label': string
  className?: string
  labelClassName?: string
}

export const SegmentedControl = <T extends string>({
  value,
  options,
  onValueChange,
  className,
  labelClassName = 'hidden sm:inline',
  ...props
}: SegmentedControlProps<T>) => (
  <div
    role="group"
    aria-label={props['aria-label']}
    className={cn(
      'flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5',
      className,
    )}
  >
    {options.map((option) => {
      const active = option.value === value
      const Icon = option.icon
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={active}
          aria-label={option.label}
          title={option.title}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? cn(
                  'bg-primary text-primary-foreground shadow-sm',
                  option.activeClassName,
                )
              : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
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
