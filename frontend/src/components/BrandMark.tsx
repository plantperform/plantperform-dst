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
    <img
      src="/plantperform-mark.svg"
      alt=""
      className={cn(
        'shrink-0 rounded-sm',
        compact ? 'size-8' : 'size-9',
        variant === 'onDark' && 'ring-1 ring-primary-foreground/25',
      )}
    />
    {compact ? null : (
      <span className="truncate text-lg font-semibold tracking-tight">
        PlantPerform
      </span>
    )}
  </span>
)
