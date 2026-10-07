import { ArrowLeft } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import {
  useFieldYearValues,
  useFieldYearValuesProgress,
  useSimulationResults,
  type FieldsBySimulationId,
} from '@/api/hooks'
import { combineProgress, type RequestProgress } from '@/api/request-progress'
import type { FieldRecord, FieldYearValues, Simulation } from '@/api/types'
import { CatchmentQuotaTable } from '@/components/farm/CatchmentQuotaTable'
import { useCatchmentLabel } from '@/components/farm/catchment-options'
import { ComparisonCharts } from '@/components/farm/ComparisonCharts'
import { ComparisonEconomics } from '@/components/farm/ComparisonEconomics'
import { ComparisonLoading } from '@/components/farm/ComparisonLoading'
import { ComparisonRanking } from '@/components/farm/ComparisonRanking'
import type { ComparedColumn } from '@/components/farm/comparison-column'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { TEXT_LINK_CLASS } from '@/components/farm/economics-ui'
import { SimulationComparisonPicker } from '@/components/farm/SimulationComparisonPicker'
import { LoadError } from '@/components/ui/load-error'
import { STANDARD_PROFILE, STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import {
  changedFieldIds,
  computeFieldTotals,
  summarizeCatchmentYearTotals,
  summarizeCropDistribution,
  totalsPerHa,
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
  describeEconomicsVerdict,
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
  yearValues?: FieldYearValues
}

type ColumnYearFigures = Pick<
  ComparedColumn,
  'catchments' | 'partialQuotas' | 'cropShares' | 'retrying' | 'onRetry'
> & {
  failed: boolean
  progress: RequestProgress
}

const useColumnYearFigures = (
  farmId: string,
  column: ComparisonColumn | undefined,
): ColumnYearFigures => {
  const simulationId = column?.simulationId
  const history = simulationId === undefined
  const fields = column?.fields ?? NO_FIELDS
  const enabled = fields.length > 0 && column?.yearValues === undefined
  const yearValues = useFieldYearValues(farmId, simulationId, fields, enabled)
  const fetchedProgress = useFieldYearValuesProgress(
    farmId,
    simulationId,
    fields,
    enabled,
  )
  const values = column?.yearValues ?? yearValues.data
  const yearValuesProgress =
    column?.yearValues === undefined
      ? fetchedProgress
      : { done: fields.length, total: fields.length }
  const incomplete =
    values !== undefined && hasMissingYearValues(fields, values, history)
  const catchments = useMemo(() => {
    if (fields.length === 0) return EMPTY_CATCHMENTS
    if (values === undefined || incomplete) return undefined
    return alignCatchmentYears(
      summarizeCatchmentYearTotals(fields, values, history),
      history,
    )
  }, [fields, history, incomplete, values])
  const partialQuotas = useMemo(
    () => partialCatchmentQuotas(fields, !history),
    [fields, history],
  )
  const cropShares = useMemo(
    () =>
      values === undefined || incomplete
        ? undefined
        : summarizeCropDistribution(fields, values, null, 'group'),
    [fields, incomplete, values],
  )
  const failed =
    incomplete || (Boolean(yearValues.error) && values === undefined)
  return {
    catchments,
    partialQuotas,
    cropShares,
    failed,
    retrying: yearValues.isValidating,
    onRetry: () => void yearValues.mutate(),
    progress:
      catchments === undefined && !failed
        ? yearValuesProgress
        : { done: yearValuesProgress.total, total: yearValuesProgress.total },
  }
}

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
  const economics = useEconomicsProfiles()
  const economicsRef = useRef<HTMLElement>(null)
  const simulationsFields = useSimulationResults(farmId, simulations)
  const fieldsBySimulationId = useMemo(
    () =>
      simulations.length === 0
        ? NO_SIMULATION_FIELDS
        : simulationsFields.data === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(simulationsFields.data).map(([id, result]) => [
                id,
                result.response?.fields ?? [],
              ]),
            ),
    [simulations, simulationsFields.data],
  )
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
          subtitle: `${formatCreatedAt(simulation.createdAt)}${simulation.result.status === 'completed' ? '' : simulation.result.status === 'outdated' ? ' · Forældet resultat' : ' · Seneste gemte resultat'}`,
          simulationId: id,
          fields: simulationFields,
          yearValues: Object.fromEntries(
            Object.entries(
              simulationsFields.data?.[id]?.selectedCandidates ?? {},
            ).map(([fieldId, candidate]) => [fieldId, candidate.years]),
          ),
          totals: computeFieldTotals(simulationFields, true),
          requirement: describeFeedUnitRequirement(simulation.constraints),
          changedCount: changedFieldIds(simulationFields, fields).size,
        },
      ]
    })
    return [history, ...chosen]
  }, [fields, fieldsBySimulationId, ids, simulations, simulationsFields.data])

  const catchmentLabel = useCatchmentLabel(farmId, fields)
  const quotaByCatchment = useMemo(() => catchmentQuotas(fields), [fields])
  const yearFigures = [
    useColumnYearFigures(farmId, columns[0]),
    useColumnYearFigures(farmId, columns[1]),
    useColumnYearFigures(farmId, columns[2]),
    useColumnYearFigures(farmId, columns[3]),
  ]
  const yearValuesLoading = yearFigures.some(
    (slot) => slot.catchments === undefined && !slot.failed,
  )
  const yearValuesProgress = combineProgress(
    yearFigures.map((slot) => slot.progress),
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
    yearFigures.slice(0, columns.length),
    catchmentLabel,
  )
  const catchmentIds = catchments.map(({ catchmentId }) => catchmentId)
  const compared = columns.map((column, index): ComparedColumn => {
    const slot = yearFigures[index]
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
      cropShares: slot.cropShares,
      retrying: slot.retrying,
      onRetry: slot.onRetry,
      yearsOver: quota?.yearsOver ?? null,
      catchmentsOver: quota?.catchmentsOver ?? null,
    }
  })
  const [history, ...simulationColumns] = compared
  const candidates = simulationColumns.map((column) => ({
    column,
    db2PerHa: totalsPerHa(column.totals, 'db2'),
    nLoadPerHa: totalsPerHa(column.totals, 'nLoad'),
    yearsOver: column.yearsOver,
  }))
  const bestBalance = rankByBalance(candidates).at(0)?.column
  const verdict =
    bestBalance === undefined
      ? null
      : describeComparisonVerdict({
          best: {
            title: bestBalance.title,
            db2PerHa: totalsPerHa(bestBalance.totals, 'db2'),
            yearsOver: bestBalance.yearsOver,
          },
          compliantCount: simulationColumns.filter(
            (column) => column.yearsOver === 0,
          ).length,
          simulationCount: simulationColumns.length,
          historyDb2PerHa: totalsPerHa(history.totals, 'db2'),
        })
  const ordered = [
    history,
    ...sortComparison(candidates, sort).map(({ column }) => column),
  ]
  const profiles = ordered.map((column) =>
    column.history
      ? STANDARD_PROFILE
      : economics.profileForSimulation(column.key),
  )
  const economicsVerdict = describeEconomicsVerdict(
    ordered
      .map((column, index) => ({
        title: column.title,
        ownProfileName:
          profiles[index].id === STANDARD_PROFILE_ID
            ? null
            : profiles[index].name,
        fields: column.fields,
      }))
      .slice(1),
  )
  const requirements = placeFeedUnitRequirements(
    ordered.map((column) => column.requirement),
  )
  const showFeedUnits =
    requirements.label !== null ||
    requirements.cells.some((cell) => cell !== null) ||
    ordered.some((column) => column.totals.feedUnits !== 0)

  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[96rem] flex-col gap-6 px-6 pt-8 pb-16 sm:px-10">
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
          <ComparisonLoading
            label={
              availability === undefined
                ? 'Henter simuleringerne'
                : 'Henter tal pr. år'
            }
            progress={
              availability === undefined ? undefined : yearValuesProgress
            }
          />
        ) : (
          <>
            {noneSelectable ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Ingen simuleringer er beregnet endnu. Kør Optimér på en
                simulering, så kan den sammenlignes her.
              </p>
            ) : null}
            {verdict || economicsVerdict ? (
              <div className="flex max-w-[860px] flex-col gap-1.5 text-[15px] leading-[1.45] text-pretty">
                {verdict ? <p>{verdict}</p> : null}
                {economicsVerdict ? (
                  <p>
                    {economicsVerdict}{' '}
                    <button
                      type="button"
                      className={TEXT_LINK_CLASS}
                      onClick={() =>
                        economicsRef.current?.scrollIntoView({ block: 'start' })
                      }
                    >
                      Se økonomien
                    </button>
                  </p>
                ) : null}
              </div>
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
            <ComparisonCharts
              columns={ordered}
              bestBalanceKey={bestBalance?.key ?? null}
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
                bestBalanceKey={bestBalance?.key ?? null}
              />
            </section>
            {economicsVerdict ? (
              <section ref={economicsRef} className="scroll-mt-4 space-y-2.5">
                <h2 className="pt-1 font-display text-[22px] leading-tight">
                  Økonomi i simuleringerne
                </h2>
                <ComparisonEconomics
                  columns={ordered}
                  profiles={profiles}
                  highlightedKey={highlightedKey}
                  onHighlight={setHighlightedKey}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
