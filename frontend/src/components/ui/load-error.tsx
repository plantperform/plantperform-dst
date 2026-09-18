import type * as React from 'react'
import { CircleAlert, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LoadErrorProps = {
  message: React.ReactNode
  onRetry?: () => void
  retrying?: boolean
  onDismiss?: () => void
  className?: string
}

// Failed data fetch, kept visually distinct from loading and from empty data.
const LoadError = ({
  message,
  onRetry,
  retrying = false,
  onDismiss,
  className,
}: LoadErrorProps) => (
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
    {onDismiss ? (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="px-2 text-red-700 hover:bg-red-100 hover:text-red-700"
        aria-label="Luk fejlbeskeden"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    ) : null}
  </div>
)

export { LoadError }
