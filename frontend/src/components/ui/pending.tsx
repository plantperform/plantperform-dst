import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type PendingProps = {
  failed: boolean
  failure: string
  loading: string
  retrying?: boolean
  onRetry: () => void
  className?: string
}

const Pending = ({
  failed,
  failure,
  loading,
  retrying,
  onRetry,
  className,
}: PendingProps) =>
  failed ? (
    <div className={className}>
      <LoadError message={failure} retrying={retrying} onRetry={onRetry} />
    </div>
  ) : (
    <p
      className={cn(
        'flex items-center gap-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <Spinner />
      {loading}
    </p>
  )

export { Pending }
