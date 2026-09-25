import type { OptimizationRun } from '@/api/optimization-runs'
import { Spinner } from '@/components/ui/spinner'
import { useElapsed } from '@/hooks/use-elapsed'
import {
  fieldTitle,
  formatCompactDkk,
  formatSigned,
  formatWholeNumber,
} from '@/lib/field-domain'
import {
  formatElapsed,
  formatFieldNameList,
  OPTIMIZATION_KIND_LABELS,
  RUN_STATUS_LABELS,
} from '@/lib/optimization-run'
import { cn } from '@/lib/utils'

type OptimizationRunProgressProps = {
  run: OptimizationRun
}

const SuccessCheck = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="absolute size-8"
    aria-hidden="true"
  >
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      pathLength={1}
      strokeDasharray={1}
      className="motion-safe:animate-check-draw"
    />
  </svg>
)

const RunningDetails = ({ run }: OptimizationRunProgressProps) => {
  const elapsed = useElapsed(run.startedAt, run.status === 'running')
  const limitMs = run.timeLimitSeconds * 1000
  const overLimit = elapsed >= limitMs

  return (
    <>
      <p className="text-base font-semibold">
        {overLimit
          ? 'Gemmer resultatet...'
          : `Kører ${OPTIMIZATION_KIND_LABELS[run.kind]}...`}
      </p>
      <p className="text-sm tabular-nums text-muted-foreground">
        {formatElapsed(elapsed)}
      </p>
      <div
        className="mx-auto h-1 w-48 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, (elapsed / limitMs) * 100)}%` }}
        />
      </div>
      <p className="pt-1 text-xs text-muted-foreground">
        Du kan lukke vinduet. Optimeringen kører videre.
      </p>
    </>
  )
}

const SucceededDetails = ({
  run,
}: {
  run: Extract<OptimizationRun, { status: 'succeeded' }>
}) => {
  const { changes } = run
  const changedCount = changes.changedFields.length

  return (
    <>
      <p className="text-base font-semibold">
        {OPTIMIZATION_KIND_LABELS[run.kind]} færdig
      </p>
      <p className="text-sm text-muted-foreground first-letter:uppercase">
        {RUN_STATUS_LABELS[run.response.status]} ·{' '}
        {formatElapsed(run.finishedAt - run.startedAt)}
      </p>
      {changedCount === 0 ? (
        <p className="mx-auto max-w-sm pt-2 text-sm">
          Ingen ændringer. Markerne havde allerede det bedste sædskifte inden
          for reglerne.
        </p>
      ) : (
        <>
          <p className="mx-auto max-w-sm pt-2 text-sm">
            {changedCount} {changedCount === 1 ? 'mark' : 'marker'} fik ændret
            sædskifte:{' '}
            {formatFieldNameList(changes.changedFields.map(fieldTitle))}.
          </p>
          <dl className="mx-auto grid w-fit grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 pt-2 text-left text-sm tabular-nums">
            <dt className="text-muted-foreground">DB2</dt>
            <dd>
              {formatCompactDkk(changes.db2Before)} →{' '}
              {formatCompactDkk(changes.db2After)}
            </dd>
            <dd className="text-muted-foreground">
              {formatSigned(
                changes.db2After - changes.db2Before,
                formatCompactDkk,
              )}
            </dd>
            <dt className="text-muted-foreground">Udledning</dt>
            <dd>
              {formatWholeNumber(changes.nLoadBefore)} →{' '}
              {formatWholeNumber(changes.nLoadAfter)} kg N
            </dd>
            <dd className="text-muted-foreground">
              {formatSigned(
                changes.nLoadAfter - changes.nLoadBefore,
                (value) => `${formatWholeNumber(value)} kg N`,
              )}
            </dd>
          </dl>
        </>
      )}
    </>
  )
}

// The circle stays mounted from running to succeeded, so the spinner can turn
// into the checkmark instead of the view jumping.
export const OptimizationRunProgress = ({ run }: OptimizationRunProgressProps) => {
  const succeeded = run.status === 'succeeded'

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div
        className={cn(
          'relative grid size-16 place-items-center rounded-full transition-colors duration-500',
          succeeded
            ? 'bg-primary text-primary-foreground motion-safe:animate-success-pop'
            : 'bg-primary/10 text-primary',
        )}
      >
        <Spinner
          className={cn(
            'size-8 transition-[opacity,scale] duration-300',
            succeeded && 'scale-50 opacity-0',
          )}
        />
        {succeeded ? <SuccessCheck /> : null}
      </div>
      <div
        key={run.status}
        role="status"
        aria-live="polite"
        className="space-y-1 motion-safe:animate-rise-in"
      >
        {run.status === 'succeeded' ? (
          <SucceededDetails run={run} />
        ) : (
          <RunningDetails run={run} />
        )}
      </div>
    </div>
  )
}
