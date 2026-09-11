import type * as React from 'react'

import { cn } from '@/lib/utils'

const Skeleton = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    aria-hidden="true"
    className={cn('rounded bg-muted motion-safe:animate-pulse', className)}
    {...props}
  />
)

export { Skeleton }
