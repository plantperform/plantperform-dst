import type { OptimizationRun } from '@/api/optimization-runs'
import type { FieldRecord } from '@/api/types'
import { useOptimizationRunRetry } from '@/components/farm/optimization-run-retry'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { useElapsed } from '@/hooks/use-elapsed'
import {
  formatElapsed,
  OPTIMIZATION_KIND_LABELS,
} from '@/lib/optimization-run'
import { cn } from '@/lib/utils'

type RunProps = {
  run: OptimizationRun
}

// "Års-optimering · 0:12 / maks. 0:20", ticking while the run is going.
export const OptimizationRunElapsed = ({ run }: RunProps) => {
  const elapsed = useElapsed(run.startedAt, run.status === 'running')
  return (
    <>
      {OPTIMIZATION_KIND_LABELS[run.kind]} · {formatElapsed(elapsed)} / maks.{' '}
      {formatElapsed(run.timeLimitSeconds * 1000)}
    </>
  )
}

type OptimizationRunBannerProps = RunProps & {
  fields: FieldRecord[] | undefined
  className?: string
}

// Tells the reader that the figures below are about to change, or that the
// run that should have changed them failed.
export const OptimizationRunBanner = ({
  run,
  fields,
  className,
}: OptimizationRunBannerProps) => {
  const { retry, dismiss } = useOptimizationRunRetry(run, fields)

  if (run.status === 'running') {
    return (
      <div
        role="status"
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm',
          className,
        )}
      >
        <Spinner className="text-primary" />
        <p className="min-w-0 flex-1">
          <span className="font-medium tabular-nums">
            <OptimizationRunElapsed run={run} />
          </span>
          <span className="text-muted-foreground">
            {' '}
            kører. Tallene herunder er fra før kørslen.
          </span>
        </p>
      </div>
    )
  }

  if (run.status !== 'failed') return null

  return (
    <LoadError
      className={cn('w-full whitespace-pre-wrap', className)}
      message={`${OPTIMIZATION_KIND_LABELS[run.kind]} fejlede: ${run.error}`}
      onRetry={retry}
      onDismiss={dismiss}
    />
  )
}
