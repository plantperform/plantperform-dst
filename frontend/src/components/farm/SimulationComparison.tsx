import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import {
  useFieldYearValues,
  useFieldYearValuesProgress,
  useSimulationsFields,
  type FieldsBySimulationId,
} from '@/api/hooks'
import { combineProgress, type RequestProgress } from '@/api/request-progress'
import type { FieldRecord, Simulation } from '@/api/types'
import { CatchmentQuotaTable } from '@/components/farm/CatchmentQuotaTable'
import { useCatchmentLabel } from '@/components/farm/catchment-options'
import { ComparisonRanking } from '@/components/farm/ComparisonRanking'
import {
  columnFigure,
  type ComparedColumn,
} from '@/components/farm/comparison-column'
import { SimulationComparisonPicker } from '@/components/farm/SimulationComparisonPicker'
import { LoadError } from '@/components/ui/load-error'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  changedFieldIds,
  computeFieldTotals,
  summarizeCatchmentYearTotals,
  type CatchmentTotalsByYear,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  alignCatchmentYears,
  catchmentQuotas,
  COMPARISON_PERIOD,
  comparisonAvailability,
  defaultComparisonIds,
  describeComparisonVerdict,
  describeFeedUnitRequirement,
  hasMissingYearValues,
  listComparedCatchments,
  parseComparisonIds,
  placeFeedUnitRequirements,
  rankByBalance,
  resolveComparisonIds,
  sortComparison,
  summarizeColumnQuota,
  type ComparisonSort,
} from '@/lib/simulation-comparison'
import {
  formatCreatedAt,
  partialCatchmentQuotas,
} from '@/lib/simulation-overview'

const HISTORY_COLUMN_KEY = 'history'
const NO_SIMULATION_FIELDS: FieldsBySimulationId = {}
const NO_FIELDS: FieldRecord[] = []
const EMPTY_CATCHMENTS: CatchmentTotalsByYear = new Map()

type ComparisonColumn = {
  key: string
  title: string
  subtitle: string
  simulationId: string | undefined
  fields: FieldRecord[]
  totals: FieldTotals
  requirement: string | null
  changedCount: number | null
}

type ColumnCatchments = Pick<
  ComparedColumn,
  'catchments' | 'partialQuotas' | 'retrying' | 'onRetry'
> & {
  failed: boolean
  progress: RequestProgress
}

const useColumnCatchments = (
  farmId: string,
  column: ComparisonColumn | undefined,
): ColumnCatchments => {
  const simulationId = column?.simulationId
  const history = simulationId === undefined
  const fields = column?.fields ?? NO_FIELDS
  const enabled = fields.length > 0
  const yearValues = useFieldYearValues(farmId, simulationId, fields, enabled)
  const yearValuesProgress = useFieldYearValuesProgress(
    farmId,
    simulationId,
    fields,
    enabled,
  )
  const incomplete =
    yearValues.data !== undefined &&
    hasMissingYearValues(fields, yearValues.data, history)
  const catchments = useMemo(() => {
    if (fields.length === 0) return EMPTY_CATCHMENTS
    if (yearValues.data === undefined || incomplete) return undefined
    return alignCatchmentYears(
      summarizeCatchmentYearTotals(fields, yearValues.data, history),
      history,
    )
  }, [fields, history, incomplete, yearValues.data])
  const partialQuotas = useMemo(
    () => partialCatchmentQuotas(fields, !history),
    [fields, history],
  )
  const failed =
    incomplete || (Boolean(yearValues.error) && yearValues.data === undefined)
  return {
    catchments,
    partialQuotas,
    failed,
    retrying: yearValues.isValidating,
    onRetry: () => void yearValues.mutate(),
    progress:
      catchments === undefined && !failed
        ? yearValuesProgress
        : { done: yearValuesProgress.total, total: yearValuesProgress.total },
  }
}

type LoadProgressProps = {
  label: string
  progress?: RequestProgress
}

const LoadProgress = ({ label, progress }: LoadProgressProps) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={progress ? 0 : undefined}
    aria-valuemax={progress?.total}
    aria-valuenow={progress?.done}
    className="max-w-md space-y-1.5"
  >
    <p className="text-xs text-muted-foreground tabular-nums">
      {progress
        ? `${label}: ${progress.done} af ${progress.total} marker`
        : label}
    </p>
    <ProgressBar
      valuePct={progress && (progress.done * 100) / Math.max(progress.total, 1)}
    />
  </div>
)

type SimulationComparisonProps = {
  farmId: string
  fields: FieldRecord[]
  simulations: Simulation[]
}

export const SimulationComparison = ({
  farmId,
  fields,
  simulations,
}: SimulationComparisonProps) => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [sort, setSort] = useState<ComparisonSort>('balance')
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const simulationsFields = useSimulationsFields(farmId, simulations)
  const fieldsBySimulationId =
    simulations.length === 0 ? NO_SIMULATION_FIELDS : simulationsFields.data
  const availability = useMemo(
    () =>
      fieldsBySimulationId === undefined
        ? undefined
        : Object.fromEntries(
            simulations.map((simulation) => [
              simulation.id,
              comparisonAvailability(fieldsBySimulationId[simulation.id] ?? []),
            ]),
          ),
    [fieldsBySimulationId, simulations],
  )
  const requested = searchParams.get('ids')
  const ids = useMemo(() => {
    if (availability === undefined) return []
    const selectable = new Set(
      simulations
        .filter((simulation) => availability[simulation.id]?.kind === 'ready')
        .map((simulation) => simulation.id),
    )
    return requested === null
      ? defaultComparisonIds(simulations, selectable)
      : resolveComparisonIds(parseComparisonIds(requested), selectable)
  }, [availability, requested, simulations])
  const columns = useMemo(() => {
    const history: ComparisonColumn = {
      key: HISTORY_COLUMN_KEY,
      title: 'Afgrødehistorik',
      subtitle: `Fremskrevet til ${COMPARISON_PERIOD}`,
      simulationId: undefined,
      fields,
      totals: computeFieldTotals(fields, false),
      requirement: null,
      changedCount: null,
    }
    const chosen = ids.flatMap((id): ComparisonColumn[] => {
      const simulation = simulations.find((candidate) => candidate.id === id)
      const simulationFields = fieldsBySimulationId?.[id]
      if (!simulation || !simulationFields) return []
      return [
        {
          key: id,
          title: simulation.name,
          subtitle: formatCreatedAt(simulation.createdAt),
          simulationId: id,
          fields: simulationFields,
          totals: computeFieldTotals(simulationFields, true),
          requirement: describeFeedUnitRequirement(simulation.constraints),
          changedCount: changedFieldIds(simulationFields, fields).size,
        },
      ]
    })
    return [history, ...chosen]
  }, [fields, fieldsBySimulationId, ids, simulations])

  const catchmentLabel = useCatchmentLabel(farmId, fields)
  const quotaByCatchment = useMemo(() => catchmentQuotas(fields), [fields])
  const catchmentSlots = [
    useColumnCatchments(farmId, columns[0]),
    useColumnCatchments(farmId, columns[1]),
    useColumnCatchments(farmId, columns[2]),
    useColumnCatchments(farmId, columns[3]),
  ]
  const yearValuesLoading = catchmentSlots.some(
    (slot) => slot.catchments === undefined && !slot.failed,
  )
  const yearValuesProgress = combineProgress(
    catchmentSlots.map((slot) => slot.progress),
  )

  const canonical = ids.join(',')
  if (availability !== undefined && requested !== canonical) {
    return <Navigate replace to={{ search: `?ids=${canonical}` }} />
  }

  const noneSelectable =
    availability !== undefined &&
    !Object.values(availability).some((entry) => entry.kind === 'ready')
  const selectIds = (next: string[]) =>
    navigate({ search: `?ids=${next.join(',')}` }, { replace: true })

  const catchments = listComparedCatchments(
    catchmentSlots.slice(0, columns.length),
    catchmentLabel,
  )
  const catchmentIds = catchments.map(({ catchmentId }) => catchmentId)
  const compared = columns.map((column, index): ComparedColumn => {
    const slot = catchmentSlots[index]
    const quota =
      slot.catchments === undefined
        ? null
        : summarizeColumnQuota(
            catchmentIds,
            slot.catchments,
            slot.partialQuotas,
          )
    return {
      key: column.key,
      title: column.title,
      subtitle: column.subtitle,
      history: column.simulationId === undefined,
      fields: column.fields,
      totals: column.totals,
      requirement: column.requirement,
      changedCount: column.changedCount,
      catchments: slot.catchments,
      partialQuotas: slot.partialQuotas,
      retrying: slot.retrying,
      onRetry: slot.onRetry,
      yearsOver: quota?.yearsOver ?? null,
      catchmentsOver: quota?.catchmentsOver ?? null,
    }
  })
  const [history, ...simulationColumns] = compared
  const candidates = simulationColumns.map((column) => ({
    column,
    db2: columnFigure(column, column.totals.db2),
    nLoad: columnFigure(column, column.totals.nLoad),
    yearsOver: column.yearsOver,
  }))
  const bestBalance = rankByBalance(candidates).at(0)?.column
  const verdict =
    bestBalance === undefined
      ? null
      : describeComparisonVerdict({
          best: {
            title: bestBalance.title,
            db2: columnFigure(bestBalance, bestBalance.totals.db2),
            yearsOver: bestBalance.yearsOver,
          },
          compliantCount: simulationColumns.filter(
            (column) => column.yearsOver === 0,
          ).length,
          simulationCount: simulationColumns.length,
          historyDb2: columnFigure(history, history.totals.db2),
        })
  const ordered = [
    history,
    ...sortComparison(candidates, sort).map(({ column }) => column),
  ]
  const requirements = placeFeedUnitRequirements(
    ordered.map((column) => column.requirement),
  )
  const showFeedUnits =
    requirements.label !== null ||
    requirements.cells.some((cell) => cell !== null) ||
    ordered.some((column) => column.totals.feedUnits !== 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-6 px-6 pt-8 pb-16 sm:px-10">
        <Link
          to={`/farms/${farmId}/simulations`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Simuleringer
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl tracking-tight">Sammenlign</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Gennemsnit pr. år for {COMPARISON_PERIOD}. Forskelle er i forhold
              til afgrødehistorikken.
            </p>
          </div>
          <SimulationComparisonPicker
            simulations={simulations}
            availability={availability}
            selectedIds={ids}
            onChange={selectIds}
          />
        </header>
        {availability === undefined && simulationsFields.error ? (
          <LoadError
            message="Kunne ikke hente simuleringerne."
            onRetry={() => void simulationsFields.mutate()}
            retrying={simulationsFields.isValidating}
          />
        ) : availability === undefined || yearValuesLoading ? (
          <div
            className="space-y-5 rounded-lg border bg-card p-6"
            aria-busy="true"
          >
            {availability === undefined ? (
              <LoadProgress label="Henter simuleringerne" />
            ) : (
              <LoadProgress
                label="Henter tal pr. år"
                progress={yearValuesProgress}
              />
            )}
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        ) : (
          <>
            {noneSelectable ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Ingen simuleringer er beregnet endnu. Kør Optimér på en
                simulering, så kan den sammenlignes her.
              </p>
            ) : null}
            {verdict ? (
              <p className="max-w-[860px] text-[15px] leading-[1.45] text-pretty">
                {verdict}
              </p>
            ) : null}
            <ComparisonRanking
              columns={ordered}
              bestBalanceKey={bestBalance?.key ?? null}
              catchmentCount={catchments.length}
              sort={sort}
              onSortChange={setSort}
              highlightedKey={highlightedKey}
              onHighlight={setHighlightedKey}
            />
            <section className="space-y-2.5">
              <h2 className="pt-1 font-display text-[22px] leading-tight">
                År over kvoten pr. opland
              </h2>
              <CatchmentQuotaTable
                columns={ordered}
                catchments={catchments}
                quotaByCatchment={quotaByCatchment}
                showFeedUnits={showFeedUnits}
                feedUnitRequirements={requirements}
                highlightedKey={highlightedKey}
                onHighlight={setHighlightedKey}
              />
            </section>
          </>
        )}
      </div>
    </div>
  )
}
