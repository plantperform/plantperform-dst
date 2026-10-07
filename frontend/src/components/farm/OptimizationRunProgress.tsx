import { type OptimizationRun } from '@/api/optimization-runs'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Spinner } from '@/components/ui/spinner'
import { useElapsed } from '@/hooks/use-elapsed'
import {
  fieldTitle,
  formatCompactDkk,
  formatPerHa,
  formatSigned,
  formatWholeNumber,
  perHaFigure,
  totalsPerHa,
} from '@/lib/field-domain'
import {
  formatElapsed,
  formatFieldNameList,
  optimizationRunName,
  RUN_STATUS_LABELS,
  type OptimizationChanges,
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

const RunningDetails = ({
  run,
}: {
  run: Extract<OptimizationRun, { status: 'running' }>
}) => {
  const elapsed = useElapsed(run.startedAt, run.status === 'running')

  return (
    <>
      <p className="text-base font-semibold">
        {run.phase === 'submitting'
          ? 'Starter optimeringen...'
          : run.phase === 'queued'
            ? 'Venter i kø...'
            : `Kører ${optimizationRunName(run.kind).toLowerCase()}...`}
      </p>
      <p className="text-sm tabular-nums text-muted-foreground">
        {formatElapsed(elapsed)}
      </p>
      <ProgressBar className="mx-auto w-48" />
      <p className="pt-1 text-xs text-muted-foreground">
        Du kan lukke vinduet. Du får besked her, når optimeringen er færdig.
      </p>
    </>
  )
}

type ChangeRowProps = {
  label: string
  metric: 'db2' | 'nLoad'
  changes: OptimizationChanges
  formatTotal: (value: number) => string
}

const ChangeRow = ({ label, metric, changes, formatTotal }: ChangeRowProps) => {
  const { totalsBefore, totalsAfter } = changes
  const before = totalsPerHa(totalsBefore, metric)
  const after = totalsPerHa(totalsAfter, metric)
  if (
    before === null ||
    after === null ||
    totalsBefore.calculatedCount !== totalsAfter.calculatedCount
  ) {
    const { value, total } = perHaFigure(
      after,
      metric,
      formatTotal(totalsAfter[metric]),
    )
    return (
      <>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="col-span-2">
          {value}
          {total ? (
            <span className="block text-xs text-muted-foreground">{total}</span>
          ) : null}
        </dd>
      </>
    )
  }
  const totals = `${formatTotal(totalsBefore[metric])} → ${formatTotal(totalsAfter[metric])}`
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {formatPerHa(before, metric)} → {formatPerHa(after, metric)}
        <span className="block text-xs text-muted-foreground">
          {totals} i alt
        </span>
      </dd>
      <dd className="text-muted-foreground">
        {formatSigned(after - before, (value) => formatPerHa(value, metric))}
      </dd>
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
        {optimizationRunName(run.kind)} færdig
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
            <ChangeRow
              label="DB2"
              metric="db2"
              changes={changes}
              formatTotal={formatCompactDkk}
            />
            <ChangeRow
              label="Udledning"
              metric="nLoad"
              changes={changes}
              formatTotal={(value) => `${formatWholeNumber(value)} kg N`}
            />
          </dl>
        </>
      )}
    </>
  )
}

// The circle stays mounted from running to succeeded, so the spinner can turn
// into the checkmark instead of the view jumping.
export const OptimizationRunProgress = ({
  run,
}: OptimizationRunProgressProps) => {
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
        ) : run.status === 'running' ? (
          <RunningDetails run={run} />
        ) : (
          <p>
            Optimeringen er {run.status === 'outdated' ? 'forældet' : 'fejlet'}.
          </p>
        )}
      </div>
    </div>
  )
}
