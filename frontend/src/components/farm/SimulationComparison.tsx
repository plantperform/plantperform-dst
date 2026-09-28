import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import {
  useFieldYearValues,
  useFieldYearValuesProgress,
  useSimulationsFields,
  type FieldsBySimulationId,
} from '@/api/hooks'
import { combineProgress, type RequestProgress } from '@/api/request-progress'
import type { FieldRecord, Simulation } from '@/api/types'
import { useCatchmentLabel } from '@/components/farm/catchment-options'
import {
  CatchmentComparisonRows,
  type CatchmentColumn,
} from '@/components/farm/CatchmentComparisonRows'
import {
  ComparisonCell,
  ComparisonRowHeader,
  ComparisonValue,
} from '@/components/farm/ComparisonTableParts'
import { SimulationComparisonPicker } from '@/components/farm/SimulationComparisonPicker'
import { GlossaryInfo, type GlossaryTerm } from '@/components/GlossaryInfo'
import { LoadError } from '@/components/ui/load-error'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  changedFieldIds,
  computeFieldTotals,
  formatCompactDkk,
  NUM_ROTATION_YEARS,
  ROTATION_START_CALENDAR_YEAR,
  summarizeCatchmentYearTotals,
  type CatchmentTotalsByYear,
  type FieldTotals,
} from '@/lib/field-domain'
import {
  alignCatchmentYears,
  bestColumnIndex,
  catchmentQuotas,
  comparisonAvailability,
  defaultComparisonIds,
  describeFeedUnitRequirement,
  formatFeedUnits,
  formatKgN,
  hasMissingYearValues,
  parseComparisonIds,
  placeFeedUnitRequirements,
  resolveComparisonIds,
  type BestDirection,
} from '@/lib/simulation-comparison'
import {
  formatCreatedAt,
  partialCatchmentQuotas,
} from '@/lib/simulation-overview'

const PERIOD = `${ROTATION_START_CALENDAR_YEAR}-${ROTATION_START_CALENDAR_YEAR + NUM_ROTATION_YEARS - 1}`
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

const useColumnCatchments = (
  farmId: string,
  column: ComparisonColumn | undefined,
): Omit<CatchmentColumn, 'key' | 'title'> & {
  failed: boolean
  progress: RequestProgress
} => {
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

type FigureRowProps = {
  label: string
  term?: GlossaryTerm
  note?: string | null
  columns: ComparisonColumn[]
  valueOf: (totals: FieldTotals) => number
  format: (value: number) => string
  direction: BestDirection
  cellNotes?: (string | null)[]
}

const FigureRow = ({
  label,
  term,
  note,
  columns,
  valueOf,
  format,
  direction,
  cellNotes,
}: FigureRowProps) => {
  const values = columns.map((column) =>
    column.totals.calculatedCount > 0 ? valueOf(column.totals) : null,
  )
  const best = bestColumnIndex(
    values.map((value, index) =>
      columns[index].totals.uncalculatedCount === 0 ? value : null,
    ),
    direction,
    format,
  )
  return (
    <TableRow className="hover:bg-transparent">
      <ComparisonRowHeader note={note}>
        {label}
        {term ? <GlossaryInfo term={term} /> : null}
      </ComparisonRowHeader>
      {columns.map((column, index) => {
        const value = values[index]
        const cellNote = cellNotes?.[index]
        return (
          <ComparisonCell key={column.key}>
            {value === null ? (
              <span className="text-sm text-muted-foreground">Ingen tal</span>
            ) : (
              <ComparisonValue text={format(value)} best={index === best} />
            )}
            {cellNote ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {cellNote}
              </span>
            ) : null}
          </ComparisonCell>
        )
      })}
    </TableRow>
  )
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
      subtitle: `Fremskrevet til ${PERIOD}`,
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

  const requirements = placeFeedUnitRequirements(
    columns.map((column) => column.requirement),
  )
  const showFeedUnits =
    requirements.label !== null ||
    requirements.cells.some((cell) => cell !== null) ||
    columns.some((column) => column.totals.feedUnits !== 0)
  const noneSelectable =
    availability !== undefined &&
    !Object.values(availability).some((entry) => entry.kind === 'ready')
  const selectIds = (next: string[]) =>
    navigate({ search: `?ids=${next.join(',')}` }, { replace: true })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-8 pb-16 sm:px-10">
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
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              Afgrødehistorikken og op til tre simuleringer side om side.
              Tallene er gennemsnit pr. år for {PERIOD}, og det bedste tal i
              hver række er grønt.
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
            <Table
              containerClassName="rounded-lg border bg-card"
              className="min-w-max"
            >
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-10 h-auto bg-card px-4 py-3 align-bottom text-xs text-muted-foreground">
                    Nøgletal
                  </TableHead>
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      scope="col"
                      className="h-auto min-w-44 px-4 py-3 align-top whitespace-normal"
                    >
                      <span className="block font-display text-base leading-6">
                        {column.title}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {column.subtitle}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <FigureRow
                  label="Dækningsbidrag pr. år"
                  note="DB2"
                  columns={columns}
                  valueOf={(totals) => totals.db2}
                  format={formatCompactDkk}
                  direction="highest"
                />
                <FigureRow
                  label="Udledning pr. år"
                  term="nLoad"
                  note="kg N til vandmiljøet, alle oplande"
                  columns={columns}
                  valueOf={(totals) => totals.nLoad}
                  format={formatKgN}
                  direction="lowest"
                />
                <CatchmentComparisonRows
                  columns={columns.map((column, index) => ({
                    key: column.key,
                    title: column.title,
                    ...catchmentSlots[index],
                  }))}
                  catchmentLabel={catchmentLabel}
                  quotaByCatchment={quotaByCatchment}
                />
                {showFeedUnits ? (
                  <FigureRow
                    label="Foderenheder pr. år"
                    term="feedUnits"
                    note={requirements.label}
                    columns={columns}
                    valueOf={(totals) => totals.feedUnits}
                    format={formatFeedUnits}
                    direction="highest"
                    cellNotes={requirements.cells}
                  />
                ) : null}
                <TableRow className="hover:bg-transparent">
                  <ComparisonRowHeader note="i forhold til afgrødehistorikken">
                    Marker ændret
                  </ComparisonRowHeader>
                  {columns.map((column) => (
                    <ComparisonCell key={column.key}>
                      {column.changedCount === null ? null : (
                        <ComparisonValue
                          text={`${column.changedCount} af ${column.fields.length}`}
                          best={false}
                        />
                      )}
                    </ComparisonCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </div>
  )
}
