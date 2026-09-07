import { Sprout } from 'lucide-react'

import { cn } from '@/lib/utils'

type BrandMarkProps = {
  variant?: 'default' | 'onDark'
  compact?: boolean
  className?: string
}

export const BrandMark = ({
  variant = 'default',
  compact = false,
  className,
}: BrandMarkProps) => (
  <span
    className={cn('flex items-center gap-2.5', className)}
    role={compact ? 'img' : undefined}
    aria-label={compact ? 'PlantPerform' : undefined}
  >
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        compact ? 'size-8' : 'size-9',
        variant === 'onDark'
          ? 'bg-primary-foreground/10 ring-1 ring-primary-foreground/25'
          : 'bg-primary text-primary-foreground',
      )}
    >
      <Sprout className={compact ? 'size-4' : 'size-5'} aria-hidden="true" />
    </span>
    {compact ? null : (
      <span className="truncate text-lg font-semibold tracking-tight">
        PlantPerform
      </span>
    )}
  </span>
)
