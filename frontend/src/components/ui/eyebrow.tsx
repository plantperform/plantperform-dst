import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

export const EYEBROW_CLASS =
  'text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase'

export const Eyebrow = ({ className, ...props }: ComponentProps<'p'>) => (
  <p className={cn(EYEBROW_CLASS, className)} {...props} />
)
