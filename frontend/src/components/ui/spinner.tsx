import type * as React from 'react'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

// Decorative: pair it with visible or sr-only text that says what is loading.
const Spinner = ({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircle>) => (
  <LoaderCircle
    aria-hidden="true"
    className={cn('size-4 shrink-0 motion-safe:animate-spin', className)}
    {...props}
  />
)

export { Spinner }
