import type * as React from 'react'
import { CircleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LoadErrorProps = {
  message: React.ReactNode
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

// Failed data fetch, kept visually distinct from loading and from empty data.
const LoadError = ({ message, onRetry, retrying = false, className }: LoadErrorProps) => (
  <div
    role="alert"
    className={cn(
      'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700',
      className,
    )}
  >
    <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1">{message}</p>
    {onRetry ? (
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="border-red-200 bg-white text-red-700 hover:bg-red-100"
        loading={retrying}
        onClick={onRetry}
      >
        Prøv igen
      </Button>
    ) : null}
  </div>
)

export { LoadError }
