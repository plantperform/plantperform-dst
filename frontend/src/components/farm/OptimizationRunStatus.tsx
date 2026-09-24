import {
  useOptimizationStale,
  useStartDefaultOptimization,
  type OptimizationRun,
} from '@/api/optimization-runs'
import type { FieldRecord } from '@/api/types'
import { useOptimizationRunRetry } from '@/components/farm/optimization-run-retry'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/ui/load-error'
import { Spinner } from '@/components/ui/spinner'
import { useElapsed } from '@/hooks/use-elapsed'
import { formatFieldCount, isFieldCalculated } from '@/lib/field-domain'
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

type OptimizationBannerProps = {
  farmId: string
  simulationId: string
  run: OptimizationRun | undefined
  fields: FieldRecord[] | undefined
  className?: string
}

// Tells the reader that the figures below are about to change, that the run
// that should have changed them failed, or that a run is still missing.
export const OptimizationBanner = ({
  farmId,
  simulationId,
  run,
  fields,
  className,
}: OptimizationBannerProps) => {
  const { retry, dismiss } = useOptimizationRunRetry(run, fields)
  const startDefaultRun = useStartDefaultOptimization()
  const stale = useOptimizationStale(simulationId)
  const uncalculatedCount =
    fields?.filter((field) => !isFieldCalculated(field, true)).length ?? 0

  if (run?.status === 'running') {
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
            {fields && uncalculatedCount === fields.length
              ? 'kører. Tallene kommer, når kørslen er færdig.'
              : 'kører. Tallene er fra før kørslen.'}
          </span>
        </p>
      </div>
    )
  }

  if (run?.status === 'failed') {
    return (
      <LoadError
        className={cn('w-full whitespace-pre-wrap', className)}
        message={`${OPTIMIZATION_KIND_LABELS[run.kind]} fejlede: ${run.error}`}
        onRetry={retry}
        onDismiss={dismiss}
      />
    )
  }

  if (!fields || (uncalculatedCount === 0 && !stale)) return null

  return (
    <div
      role="status"
      className={cn(
        'flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm',
        className,
      )}
    >
      <p className="min-w-0 flex-1">
        {uncalculatedCount > 0
          ? `${formatFieldCount(uncalculatedCount)} er ikke beregnet.`
          : 'Reglerne er ændret siden sidste kørsel.'}
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={() => startDefaultRun(farmId, simulationId, fields)}
      >
        Kør Optimér
      </Button>
    </div>
  )
}
