import { Sprout } from 'lucide-react'

import { cn } from '@/lib/utils'

type BrandMarkProps = {
  variant?: 'default' | 'onDark'
  className?: string
}

export const BrandMark = ({
  variant = 'default',
  className,
}: BrandMarkProps) => (
  <span className={cn('flex items-center gap-2.5', className)}>
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg',
        variant === 'onDark'
          ? 'bg-primary-foreground/10 ring-1 ring-primary-foreground/25'
          : 'bg-primary text-primary-foreground',
      )}
    >
      <Sprout className="h-5 w-5" aria-hidden="true" />
    </span>
    <span className="text-lg font-semibold tracking-tight">PlantPerform</span>
  </span>
)
