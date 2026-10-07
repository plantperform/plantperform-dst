import { Copy, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useFieldYearValues, useSimulationFields } from '@/api/hooks'
import { useOptimizationRun } from '@/api/optimization-runs'
import type { FieldRecord, Simulation } from '@/api/types'
import { useCatchmentLabel } from '@/components/farm/catchment-options'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { EconomicsChip } from '@/components/farm/EconomicsChip'
import { OptimizationRunElapsed } from '@/components/farm/OptimizationRunStatus'
import { KeyFigure, OverviewCard } from '@/components/farm/OverviewCard'
import { CatchmentYearStatusIndicator } from '@/components/farm/QuotaStatusIndicator'
import type { FarmInspectorMode } from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { STANDARD_PROFILE } from '@/lib/economics-profiles'
import {
  changedFieldIds,
  formatCompactDkk,
  formatFieldCount,
  formatWholeNumber,
  isFieldLocked,
  NUM_ROTATION_YEARS,
  perHaFigure,
  REAL_HISTORY_START_CALENDAR_YEAR,
  resolveFarmQuota,
  summarizeCatchmentYearTotals,
  totalsPerHa,
  type FarmQuota,
  type FieldTotals,
} from '@/lib/field-domain'
import { comparisonAvailability } from '@/lib/simulation-comparison'
import {
  describeDb2Delta,
  describeFieldChanges,
  describeNLoadDelta,
  formatCreatedAt,
  partialCatchmentQuotas,
  summarizeCatchmentYearStatuses,
  type KeyFigureDelta,
} from '@/lib/simulation-overview'

const HISTORY_PERIOD = `${REAL_HISTORY_START_CALENDAR_YEAR}-${REAL_HISTORY_START_CALENDAR_YEAR + NUM_ROTATION_YEARS - 1}`

const DELTA_TONE_CLASS: Record<KeyFigureDelta['tone'], string> = {
  better: 'text-success-strong',
  worse: 'text-destructive',
  same: 'text-muted-foreground',
}

type DeltaNoteProps = {
  delta: KeyFigureDelta
}

const DeltaNote = ({ delta }: DeltaNoteProps) => (
  <span className={DELTA_TONE_CLASS[delta.tone]}>{delta.text}</span>
)

type CatchmentStatusListProps = {
  farmId: string
  simulationId?: string
  fields: FieldRecord[]
}

const CatchmentStatusList = ({
  farmId,
  simulationId,
  fields,
}: CatchmentStatusListProps) => {
  const history = simulationId === undefined
  const hasValues = history
    ? fields.length > 0
    : fields.some((field) => field.rotationId !== null)
  const yearValues = useFieldYearValues(farmId, simulationId, fields, hasValues)
  const catchmentLabel = useCatchmentLabel(farmId, fields)
  const statuses = useMemo(
    () =>
      yearValues.data
        ? summarizeCatchmentYearStatuses(
            summarizeCatchmentYearTotals(fields, yearValues.data, history),
            history,
            partialCatchmentQuotas(fields, !history),
          )
            .map((status) => ({
              status,
              label: catchmentLabel(status.catchmentId),
            }))
            .sort((left, right) =>
              left.label.localeCompare(right.label, 'da-DK'),
            )
        : null,
    [catchmentLabel, fields, history, yearValues.data],
  )

  if (!hasValues) return null
  if (yearValues.error) {
    return (
      <p className="text-xs text-muted-foreground">
        Kunne ikke hente kvotestatus pr. opland.
      </p>
    )
  }
  if (!statuses) {
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">Henter kvotestatus pr. opland.</span>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    )
  }
  if (statuses.length === 0) return null

  return (
    <ul className="space-y-1.5">
      {statuses.map(({ status, label }) => (
        <li
          key={status.catchmentId}
          className="flex items-center justify-between gap-3 text-[13px]"
        >
          <span className="max-w-[45%] shrink-0 truncate" title={label}>
            {label}
          </span>
          <CatchmentYearStatusIndicator status={status} className="min-w-0" />
        </li>
      ))}
    </ul>
  )
}

type HistoryCardProps = {
  farmId: string
  fields: FieldRecord[]
  quota: FarmQuota
  active: boolean
  onOpen: () => void
  onCopy: () => void
}

export const HistoryCard = ({
  farmId,
  fields,
  quota,
  active,
  onOpen,
  onCopy,
}: HistoryCardProps) => (
  <OverviewCard
    title="Afgrødehistorik"
    subtitle={`Gennemsnit ${HISTORY_PERIOD}`}
    active={active}
    meta={formatFieldCount(quota.totals.fieldCount)}
    actions={
      <>
        <Button size="xs" aria-label="Åbn afgrødehistorikken" onClick={onOpen}>
          Åbn
        </Button>
        <Button
          size="xs"
          variant="outline"
          aria-label="Kopier afgrødehistorikken til en ny simulering"
          onClick={onCopy}
        >
          <Copy aria-hidden="true" />
          Kopier
        </Button>
      </>
    }
  >
    {quota.totals.calculatedCount > 0 ? (
      <div className="grid grid-cols-2 gap-4">
        <KeyFigure
          label="Dækningsbidrag pr. år"
          figure={perHaFigure(
            totalsPerHa(quota.totals, 'db2'),
            'db2',
            formatCompactDkk(quota.totals.db2),
          )}
        >
          <EconomicsChip
            profile={STANDARD_PROFILE}
            returnTo={{ kind: 'overview' }}
          />
        </KeyFigure>
        <KeyFigure
          label="Udledning pr. år"
          figure={perHaFigure(
            totalsPerHa(quota.totals, 'nLoad'),
            'nLoad',
            `${formatWholeNumber(quota.totals.nLoad)} kg N`,
          )}
          note={
            quota.quotaKgN !== null && quota.quotaKgN > 0 ? (
              <span className="text-muted-foreground">
                Kvote {formatWholeNumber(quota.quotaKgN)} kg N
              </span>
            ) : undefined
          }
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        Ingen marker er beregnet endnu.
      </p>
    )}
    <CatchmentStatusList farmId={farmId} fields={fields} />
  </OverviewCard>
)

type SimulationFiguresProps = {
  farmId: string
  simulationId: string
  fields: FieldRecord[]
  totals: FieldTotals
  history: FarmQuota
}

const SimulationFigures = ({
  farmId,
  simulationId,
  fields,
  totals,
  history,
}: SimulationFiguresProps) => {
  const comparable =
    totals.uncalculatedCount === 0 && history.totals.calculatedCount > 0
  const db2PerHa = totalsPerHa(totals, 'db2')
  const historyDb2PerHa = totalsPerHa(history.totals, 'db2')
  const nLoadPerHa = totalsPerHa(totals, 'nLoad')
  const historyNLoadPerHa = totalsPerHa(history.totals, 'nLoad')
  const profile = useEconomicsProfiles().profileForSimulation(simulationId)

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <KeyFigure
          label="Dækningsbidrag pr. år"
          figure={perHaFigure(db2PerHa, 'db2', formatCompactDkk(totals.db2))}
          note={
            comparable && db2PerHa !== null && historyDb2PerHa !== null ? (
              <DeltaNote delta={describeDb2Delta(db2PerHa, historyDb2PerHa)} />
            ) : undefined
          }
        >
          <EconomicsChip profile={profile} returnTo={{ kind: 'overview' }} />
        </KeyFigure>
        <KeyFigure
          label="Udledning pr. år"
          figure={perHaFigure(
            nLoadPerHa,
            'nLoad',
            `${formatWholeNumber(totals.nLoad)} kg N`,
          )}
          note={
            comparable && nLoadPerHa !== null && historyNLoadPerHa !== null ? (
              <DeltaNote
                delta={describeNLoadDelta(nLoadPerHa, historyNLoadPerHa)}
              />
            ) : undefined
          }
        />
      </div>
      <CatchmentStatusList
        farmId={farmId}
        simulationId={simulationId}
        fields={fields}
      />
    </>
  )
}

type NotCalculatedProps = {
  running: boolean
  onOpen: (mode: FarmInspectorMode) => void
}

const NotCalculated = ({ running, onOpen }: NotCalculatedProps) => (
  <div className="flex flex-1 flex-col gap-3 rounded-lg border border-dashed p-4">
    <p className="font-medium">
      {running ? 'Beregnes nu' : 'Ikke beregnet endnu'}
    </p>
    <p className="text-sm text-muted-foreground">
      {running
        ? 'Optimeringen kører, og tallene kommer, når den er færdig.'
        : 'Simuleringen har regler, men ingen tal endnu. Kør Optimér, eller sæt sædskifter selv på markerne, så regnes tallene med det samme.'}
    </p>
    {running ? null : (
      <div className="flex flex-wrap gap-2">
        <Button size="xs" onClick={() => onOpen('rules')}>
          Se regler og kør Optimér
        </Button>
        <Button size="xs" variant="outline" onClick={() => onOpen('values')}>
          Sæt sædskifter selv
        </Button>
      </div>
    )}
  </div>
)

type SimulationCardProps = {
  farmId: string
  simulation: Simulation
  liveFields: FieldRecord[]
  history: FarmQuota
  active: boolean
  copying: boolean
  deleting: boolean
  onOpen: (mode: FarmInspectorMode) => void
  onCopy: () => void
  onDelete: () => void
}

export const SimulationCard = ({
  farmId,
  simulation,
  liveFields,
  history,
  active,
  copying,
  deleting,
  onOpen,
  onCopy,
  onDelete,
}: SimulationCardProps) => {
  const {
    data: fields,
    error,
    isValidating,
    mutate: retry,
  } = useSimulationFields(farmId, simulation.id)
  const run = useOptimizationRun(simulation.id)
  const runningRun = run?.status === 'running' ? run : undefined
  const summary = useMemo(() => {
    if (!fields) return undefined
    const { totals } = resolveFarmQuota(fields, true)
    return {
      fields,
      totals,
      changes: describeFieldChanges({
        changed: changedFieldIds(fields, liveFields).size,
        locked: fields.filter(isFieldLocked).length,
        uncalculated: totals.uncalculatedCount,
      }),
    }
  }, [fields, liveFields])
  const calculated = summary !== undefined && summary.totals.calculatedCount > 0
  const canCompare =
    fields !== undefined && comparisonAvailability(fields).kind === 'ready'

  return (
    <OverviewCard
      title={simulation.name}
      subtitle={
        runningRun ? (
          <span className="inline-flex items-center gap-1.5 text-primary tabular-nums">
            <Spinner />
            <OptimizationRunElapsed run={runningRun} />
          </span>
        ) : (
          formatCreatedAt(simulation.createdAt)
        )
      }
      active={active}
      meta={calculated ? summary.changes : undefined}
      actions={
        <>
          <Button
            size="xs"
            aria-label={`Åbn ${simulation.name}`}
            onClick={() => onOpen('values')}
          >
            Åbn
          </Button>
          {canCompare ? (
            <Button size="xs" variant="outline" asChild>
              <Link
                to={`/farms/${farmId}/simulations/compare?ids=${encodeURIComponent(simulation.id)}`}
                aria-label={`Sammenlign ${simulation.name}`}
              >
                Sammenlign
              </Link>
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            aria-label={`Kopier ${simulation.name}`}
            loading={copying}
            disabled={deleting}
            onClick={onCopy}
          >
            {copying ? null : <Copy aria-hidden="true" />}
            Kopier
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="text-destructive hover:text-destructive"
            aria-label={`Slet ${simulation.name}`}
            loading={deleting}
            disabled={copying}
            onClick={onDelete}
          >
            {deleting ? null : <Trash2 aria-hidden="true" />}
            Slet
          </Button>
        </>
      }
    >
      {summary ? (
        calculated ? (
          <SimulationFigures
            farmId={farmId}
            simulationId={simulation.id}
            fields={summary.fields}
            totals={summary.totals}
            history={history}
          />
        ) : (
          <NotCalculated running={runningRun !== undefined} onOpen={onOpen} />
        )
      ) : error ? (
        <LoadError
          message="Kunne ikke hente tallene."
          onRetry={() => void retry()}
          retrying={isValidating}
        />
      ) : (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">Henter simuleringens tal.</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      )}
    </OverviewCard>
  )
}
