import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Info,
  List,
  Map as MapIcon,
  SlidersHorizontal,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationYearlySummaryKey,
  useSimulationFields,
  useSimulationYearlySummary,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
} from '@/api/mutations'
import type {
  Farm,
  FieldRecord,
  KystvandoplandYearlyNLoadCaps,
  OptimizeSimulationResponse,
  Simulation,
  YearlyOptimizationKategoriOption,
  YearlySummaryEntry,
} from '@/api/types'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import { FarmMetricsBar } from '@/components/farm/FarmMetricsBar'
import { FarmTopBar } from '@/components/farm/FarmTopBar'
import { SimulationRulesPanel } from '@/components/farm/SimulationRulesPanel'
import type {
  FarmInspectorMode,
  FarmViewSelection,
} from '@/components/farm/types'
import { YearlyOverviewTable } from '@/components/farm/YearlyOverviewTable'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  aggregateQuotaStatusLevel,
  computeFarmQuotaSummary,
  formatFieldCount,
  formatNumber,
  ROTATION_START_CALENDAR_YEAR,
  YEAR_BAR_FILL_COLOR,
  YEAR_BAR_OVER_COLOR,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

// Efter en Optimér-/Års-optimering-kørsel er simulationFieldsKey allerede
// opdateret direkte fra respons'en (ingen ny hentning nødvendig), men
// Årsoversigt-stripet henter fra en separat SWR-nøgle der ellers ville
// blive stående med data fra FØR kørslen — usynligt for brugeren, men ser
// ud som om nye begrænsninger/lofter blev ignoreret. Tving den til at
// hente igen.
//
// "Beregningsgennemgang pr. år"-panelet (candidate-detail) invalideres
// bevidst IKKE her længere — det blev tidligere gjort med en bredt
// matchende nøgle-revalidering, der genopfriskede ALLE candidate-detail-
// nøgler brugeren nogensinde havde åbnet i denne simulering, uanset om
// marken rent faktisk fik en ny tildeling. På et scenarie med u-optimerede
// marker gav det en byge af samtidige mislykkede kald (422 "ikke
// optimeret endnu") for hver tidligere-åbnet mark. SWR genindlæser
// candidate-detail automatisk, hver gang panelet næste gang åbnes
// (mount-tids-revalidering) — det er nok i praksis.
const invalidateOptimizationDisplays = async (farmId: string, simulationId: string) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
}

const NUM_ROTATION_YEARS = 8
const ROTATION_CALENDAR_YEARS = Array.from(
  { length: NUM_ROTATION_YEARS },
  (_, index) => ROTATION_START_CALENDAR_YEAR + index,
)

const YEARLY_OVERVIEW_YEAR_RANGE_LABEL = `${ROTATION_CALENDAR_YEARS[0]}-${
  ROTATION_CALENDAR_YEARS[ROTATION_CALENDAR_YEARS.length - 1]
}`

type EmissionStatusTone = 'ok' | 'over' | 'unknown'

const EMISSION_STATUS_TONE_CLASSES: Record<EmissionStatusTone, string> = {
  ok: 'border-green-200 bg-green-50 text-green-800',
  over: 'border-red-200 bg-red-50 text-red-800',
  unknown: 'border-amber-200 bg-amber-50 text-amber-800',
}

const EMISSION_TONE_BY_QUOTA_LEVEL: Record<QuotaStatusLevel, EmissionStatusTone> = {
  ok: 'ok',
  near: 'ok',
  over: 'over',
  uncalculated: 'unknown',
  noData: 'unknown',
  partial: 'unknown',
}

const EMISSION_ICON_BY_TONE: Record<EmissionStatusTone, LucideIcon> = {
  ok: CircleCheck,
  over: CircleAlert,
  unknown: CircleHelp,
}

const EmissionStatusBar = ({
  fields,
  isSimulationView,
}: {
  fields: FieldRecord[]
  isSimulationView: boolean
}) => {
  const { totalNLoad, quota, calculatedCount, uncalculatedCount } = useMemo(
    () => computeFarmQuotaSummary(fields, isSimulationView),
    [fields, isSimulationView],
  )
  const { quotaKgn, basis: quotaBasis } = quota

  const level = aggregateQuotaStatusLevel(
    totalNLoad,
    quotaKgn,
    calculatedCount,
    fields.length,
  )
  const tone = EMISSION_TONE_BY_QUOTA_LEVEL[level]
  const Icon = EMISSION_ICON_BY_TONE[tone]

  let message: string

  if (quotaKgn === 0) {
    message =
      'Udledningen kan ikke opgøres endnu - ingen udledningsgrænse på markerne'
  } else if (calculatedCount === 0) {
    message =
      'Udledningen kan ikke opgøres endnu - markerne er ikke beregnet endnu'
  } else {
    const over = totalNLoad > quotaKgn
    const diff = Math.abs(quotaKgn - totalNLoad)

    if (over) {
      const uncalculatedNote =
        uncalculatedCount > 0
          ? `, ${formatFieldCount(uncalculatedCount)} ikke beregnet`
          : ''
      message =
        `Udledning ${formatNumber(totalNLoad)} af ${formatNumber(quotaKgn)} kg N ` +
        `(${quotaBasis}${uncalculatedNote}) - ${formatNumber(diff)} kg N OVER grænsen`
    } else if (uncalculatedCount > 0) {
      message =
        `${formatNumber(totalNLoad)} af ${formatNumber(quotaKgn)} kg N (${quotaBasis}) brugt - ` +
        `${formatFieldCount(uncalculatedCount)} ikke beregnet endnu`
    } else {
      message =
        `Udledning ${formatNumber(totalNLoad)} af ${formatNumber(quotaKgn)} kg N ` +
        `(${quotaBasis}) - ${formatNumber(diff)} kg N under grænsen`
    }
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${EMISSION_STATUS_TONE_CLASSES[tone]}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

const YearlyOverviewMiniBars = ({
  entries,
  quotaKgn,
}: {
  entries: YearlySummaryEntry[]
  quotaKgn: number
}) => {
  const scale = Math.max(
    1,
    quotaKgn,
    ...entries.map((entry) => entry.totalNLoadKg),
  )

  return (
    <div className="flex h-6 items-end gap-0.5" aria-hidden="true">
      {entries.map((entry) => {
        const heightPct = Math.max(8, (entry.totalNLoadKg / scale) * 100)
        const isOver = quotaKgn > 0 && entry.totalNLoadKg > quotaKgn
        return (
          <div
            key={entry.year}
            className="w-[7px] rounded-t-sm"
            style={{
              height: `${heightPct}%`,
              backgroundColor: isOver ? YEAR_BAR_OVER_COLOR : YEAR_BAR_FILL_COLOR,
            }}
          />
        )
      })}
    </div>
  )
}

const YearlyOverviewSection = ({
  farm,
  fields,
  simulationId,
}: {
  farm: Farm
  fields: FieldRecord[]
  simulationId: string
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const { data: entries } = useSimulationYearlySummary(farm.id, simulationId)
  const quota = useMemo(
    () => computeFarmQuotaSummary(fields, true).quota,
    [fields],
  )

  if (!entries || entries.length === 0) return null

  const overYearCount =
    quota.quotaKgn > 0
      ? entries.filter((entry) => entry.totalNLoadKg > quota.quotaKgn).length
      : 0

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isOpen ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          />
          <div>
            <div className="text-sm font-semibold">Årsoversigt</div>
            <div className="text-xs text-muted-foreground">
              {YEARLY_OVERVIEW_YEAR_RANGE_LABEL} - DB2 og udledning år for år
              {overYearCount > 0 ? (
                <span className="ml-1 font-medium text-red-700">
                  · {overYearCount} af {entries.length} år over grænsen
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <YearlyOverviewMiniBars entries={entries} quotaKgn={quota.quotaKgn} />
      </button>
      {isOpen ? (
        <div className="border-t px-4 pb-4 pt-3">
          <YearlyOverviewTable entries={entries} quota={quota} />
        </div>
      ) : null}
    </div>
  )
}

type FarmInspectorProps = {
  farm: Farm
  fields: FieldRecord[]
  selection: FarmViewSelection
  selectedSimulation?: Simulation
  onError: (message: string | null) => void
}

export const FarmInspector = ({
  farm,
  fields,
  selection,
  selectedSimulation,
  onError,
}: FarmInspectorProps) => {
  const [view, setView] = useState<'list' | 'map'>('list')
  const [mode, setMode] = useState<FarmInspectorMode>('values')
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false)
  const [yearlyOptimizeDialogOpen, setYearlyOptimizeDialogOpen] = useState(false)
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizeSimulationResponse | null>(null)
  const [fieldsSort, setFieldsSort] =
    useState<FieldsSortState>(DEFAULT_FIELDS_SORT)
  const isSimulationView = selection.kind === 'simulation'

  const canSwitchMode = isSimulationView && Boolean(selectedSimulation)
  const effectiveMode: FarmInspectorMode = canSwitchMode ? mode : 'values'
  const isRules = effectiveMode === 'rules'

  const openRules = () => {
    setOptimizeDialogOpen(false)
    setMode('rules')
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <FarmTopBar
        farm={farm}
        visning={
          selectedSimulation
            ? `Simulering: ${selectedSimulation.name}`
            : 'Afgrødehistorik'
        }
        tone={isRules ? 'rules' : 'default'}
        onError={onError}
        details={
          isRules ? undefined : (
            <FarmMetricsBar farmId={farm.id} fields={fields} />
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canSwitchMode ? (
              <div className="flex items-center gap-0.5 rounded-lg bg-indigo-100 p-0.5">
                <ViewToggleButton
                  active={mode === 'values'}
                  onClick={() => setMode('values')}
                  label="Værdier"
                  icon={Table2}
                  title="Vis hvad optimeringen har beregnet for markerne"
                />
                <ViewToggleButton
                  active={mode === 'rules'}
                  onClick={() => setMode('rules')}
                  label="Regler"
                  icon={SlidersHorizontal}
                  title="Sæt hvad optimeringen må gøre"
                  className={
                    mode === 'rules'
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : undefined
                  }
                />
              </div>
            ) : null}
            {selectedSimulation ? (
              <Button size="sm" onClick={() => setOptimizeDialogOpen(true)}>
                Optimér
              </Button>
            ) : null}
            {selectedSimulation ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setYearlyOptimizeDialogOpen(true)}
              >
                Års-optimering
              </Button>
            ) : null}
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              <ViewToggleButton
                active={view === 'list'}
                onClick={() => setView('list')}
                label="Liste"
                icon={List}
              />
              <ViewToggleButton
                active={view === 'map'}
                onClick={() => setView('map')}
                label="Kort"
                icon={MapIcon}
              />
            </div>
          </div>
        }
      />

      {isRules ? (
        <div className="flex items-start gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
          <SlidersHorizontal
            className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
            aria-hidden="true"
          />
          <div>
            <span className="font-semibold">Optimeringsregler</span>
            <span className="ml-2 text-indigo-900/80">
              Her bestemmer du, hvad optimeringen må gøre. Intet her er tal,
              marken har - det er rammer for næste kørsel.
            </span>
          </div>
        </div>
      ) : null}

      {optimizationSummary && selectedSimulation && !isRules ? (
        <p className="border-b border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Optimering {optimizationSummary.status.toLowerCase()}: DB2{' '}
          {optimizationSummary.objectiveDb2.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
          , Udledning{' '}
          {optimizationSummary.totalNLoadKg.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{' '}
          kg N, udvaskning{' '}
          {optimizationSummary.totalLeachingKg.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{' '}
          kg N, foderenheder{' '}
          {optimizationSummary.totalFen.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{' '}
          FE.
        </p>
      ) : null}

      {selectedSimulation ? (
        <OptimizeDialog
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
          onOptimized={setOptimizationSummary}
          onOpenRules={openRules}
        />
      ) : null}

      {selectedSimulation ? (
        <YearlyOptimizeDialog
          key={`yearly-${selectedSimulation.id}`}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={yearlyOptimizeDialogOpen}
          onOpenChange={setYearlyOptimizeDialogOpen}
          onOptimized={setOptimizationSummary}
        />
      ) : null}

      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 p-4',
          view === 'list'
            ? 'space-y-4 overflow-y-auto'
            : 'flex flex-col gap-4',
          isRules && 'bg-indigo-50/40',
        )}
      >
        {isRules ? null : (
          <EmissionStatusBar
            fields={fields}
            isSimulationView={isSimulationView}
          />
        )}
        {isRules && selectedSimulation ? (
          <SimulationRulesPanel
            key={selectedSimulation.id}
            farmId={farm.id}
            simulation={selectedSimulation}
            fields={fields}
          />
        ) : null}
        {view === 'list' ? (
          <>
            {isSimulationView && selection.kind === 'simulation' && !isRules ? (
              <YearlyOverviewSection
                farm={farm}
                fields={fields}
                simulationId={selection.id}
              />
            ) : null}
            <FarmFieldsList
              farmId={farm.id}
              fields={fields}
              isSimulationView={isSimulationView}
              simulationId={
                selection.kind === 'simulation' ? selection.id : undefined
              }
              simulation={
                selection.kind === 'simulation' ? selectedSimulation : undefined
              }
              mode={effectiveMode}
              sort={fieldsSort}
              onSortChange={setFieldsSort}
              onSwitchToMap={() => setView('map')}
              onError={onError}
            />
          </>
        ) : (
          <FarmFieldsMap
            key={
              selection.kind === 'current'
                ? 'current'
                : `simulation-${selection.id}`
            }
            farm={farm}
            fields={fields}
            readOnly={isSimulationView}
            mode={effectiveMode}
            onError={onError}
          />
        )}
      </div>
    </section>
  )
}

type ViewToggleButtonProps = {
  active: boolean
  onClick: () => void
  label: string
  icon: LucideIcon
  title?: string
  className?: string
}

/** One half of the Liste/Kort segmented control: the track carries the frame. */
const ViewToggleButton = ({
  active,
  onClick,
  label,
  icon: Icon,
  title,
  className,
}: ViewToggleButtonProps) => (
  <Button
    size="sm"
    variant={active ? 'default' : 'ghost'}
    aria-pressed={active}
    aria-label={label}
    title={title}
    className={cn('h-8 px-3', className)}
    onClick={onClick}
  >
    <Icon className="h-4 w-4" aria-hidden="true" />
    <span className="hidden sm:inline">{label}</span>
  </Button>
)

type OptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
  onOpenRules: () => void
}

const formatLimit = (value: number | null, unit: string) =>
  value === null ? 'Ingen grænse' : `${value.toLocaleString('da-DK')} ${unit}`

type CatchmentYearlyInput = {
  sameForAllYears: boolean
  uniform: string
  perYear: Record<number, string>
}

const DEFAULT_CATCHMENT_YEARLY_INPUT: CatchmentYearlyInput = {
  sameForAllYears: true,
  uniform: '',
  perYear: {},
}

const OptimizeDialog = ({
  farmId,
  simulation,
  open,
  onOpenChange,
  onOptimized,
  onOpenRules,
}: OptimizeDialogProps) => {
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(15)

  const { data: fields = [] } = useSimulationFields(farmId, simulation.id)
  const catchments = useCatchmentOptions(farmId, fields)
  const catchmentLabelByKey = new Map(
    catchments.map((catchment) => [
      catchmentKey(catchment.kystvandId),
      catchment.label,
    ]),
  )
  const { constraints } = simulation

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRunError(null)
    onOpenChange(nextOpen)
  }

  const runOptimization = async () => {
    setIsRunning(true)
    try {
      const response = await runSimulationOptimization(farmId, simulation.id, {
        timeLimitSeconds,
      })
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre optimeringen.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Optimér {simulation.name}</DialogTitle>
          <DialogDescription>
            Kør optimeringen med de regler, der er gemt på scenariet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal
                className="h-4 w-4 text-indigo-600"
                aria-hidden="true"
              />
              Gældende grænser
            </div>
            <dl className="grid gap-2 text-xs sm:grid-cols-3">
              <div className="sm:col-span-3">
                <dt className="text-muted-foreground">Maks. udledning</dt>
                <dd>
                  {constraints.maxNLoadByKystvandopland.length === 0 ? (
                    'Ingen grænse'
                  ) : (
                    <ul className="space-y-0.5">
                      {constraints.maxNLoadByKystvandopland.map((cap) => {
                        const key = catchmentKey(cap.kystvandId)
                        const label =
                          catchmentLabelByKey.get(key) ??
                          (cap.kystvandId === null
                            ? 'Uden kystvandopland'
                            : `Kystvandopland ${cap.kystvandId}`)
                        return (
                          <li key={key}>
                            {label}: {formatLimit(cap.maxNLoadKg, 'kg N')}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Min. foderenheder</dt>
                <dd>{formatLimit(constraints.minFen, 'FE')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Maks. foderenheder</dt>
                <dd>{formatLimit(constraints.maxFen, 'FE')}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Ændres under <strong>Regler</strong> - ikke her.{' '}
              <button
                type="button"
                className="rounded-sm font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={onOpenRules}
              >
                Åbn Regler
              </button>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="optimize-time-limit">Tidsgrænse</Label>
            <Input
              id="optimize-time-limit"
              type="number"
              min="1"
              max="600"
              value={timeLimitSeconds}
              onChange={(event) => setTimeLimitSeconds(Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              sekunder — sæt højere hvis optimeringen ikke når at finde en
              løsning i tide på en stor bedrift
            </p>
          </div>
        </div>

        {runError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
            {runError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void runOptimization()}
            disabled={isRunning}
          >
            {isRunning ? 'Arbejder...' : 'Kør optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type YearlyOptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const YearlyOptimizeDialog = ({
  farmId,
  simulation,
  open,
  onOpenChange,
  onOptimized,
}: YearlyOptimizeDialogProps) => {
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(20)
  const [catchmentInputs, setCatchmentInputs] = useState<
    Record<string, CatchmentYearlyInput>
  >({})
  const [db2SwingPct, setDb2SwingPct] = useState('')
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set())
  const [expandedKategorier, setExpandedKategorier] = useState<Set<string>>(new Set())
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setRunError(null)
    onOpenChange(nextOpen)
  }

  const { data: fields = [] } = useSimulationFields(farmId, simulation.id)
  const { data: kategorier = [] } = useYearlyOptimizationCandidates(farmId, simulation.id)
  const catchments = useCatchmentOptions(farmId, fields)

  const catchmentInput = (key: string): CatchmentYearlyInput =>
    catchmentInputs[key] ?? DEFAULT_CATCHMENT_YEARLY_INPUT

  const updateCatchmentInput = (
    key: string,
    patch: Partial<CatchmentYearlyInput>,
  ) => {
    setCatchmentInputs((current) => ({
      ...current,
      [key]: { ...catchmentInput(key), ...patch },
    }))
  }

  const togglePair = (saedskiftevariant: string, variant: string) => {
    const key = `${saedskiftevariant}:${variant}`
    setSelectedPairs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpanded = (kategori: string) => {
    setExpandedKategorier((current) => {
      const next = new Set(current)
      if (next.has(kategori)) next.delete(kategori)
      else next.add(kategori)
      return next
    })
  }

  const toggleKategoriAll = (kategori: YearlyOptimizationKategoriOption) => {
    const keys = kategori.saedskifter.map(
      (s) => `${s.saedskiftevariant}:${s.variant}`,
    )
    const allSelected = keys.length > 0 && keys.every((k) => selectedPairs.has(k))
    setSelectedPairs((current) => {
      const next = new Set(current)
      if (allSelected) {
        for (const key of keys) next.delete(key)
      } else {
        for (const key of keys) next.add(key)
      }
      return next
    })
  }

  // Estimat, ikke en garanti — baseret på ~2ms pr. forskudt (mark × valgt
  // sædskifte × år-position), målt empirisk under denne funktions
  // performance-arbejde. Vokser med både antal marker og antal valgte
  // sædskifter, som brugeren selv styrer.
  const estimatedSeconds = useMemo(() => {
    const activeLenByPair = new Map<string, number>()
    for (const kategori of kategorier) {
      for (const option of kategori.saedskifter) {
        activeLenByPair.set(
          `${option.saedskiftevariant}:${option.variant}`,
          option.activeLen,
        )
      }
    }
    let totalShiftUnits = 0
    for (const pair of selectedPairs) {
      totalShiftUnits += activeLenByPair.get(pair) ?? 8
    }
    return fields.length * totalShiftUnits * 0.002
  }, [fields.length, kategorier, selectedPairs])

  const runYearlyOptimization = async () => {
    const maxNLoadByKystvandopland: KystvandoplandYearlyNLoadCaps[] = catchments.map(
      (catchment) => {
        const key = catchmentKey(catchment.kystvandId)
        const input = catchmentInput(key)
        const maxNLoadByYear: Record<number, number> = {}
        if (input.sameForAllYears) {
          const trimmed = input.uniform.trim()
          if (trimmed !== '') {
            for (const year of ROTATION_CALENDAR_YEARS) {
              maxNLoadByYear[year] = Number(trimmed)
            }
          }
        } else {
          for (const [year, value] of Object.entries(input.perYear)) {
            const trimmed = value.trim()
            if (trimmed !== '') {
              maxNLoadByYear[Number(year)] = Number(trimmed)
            }
          }
        }
        return { kystvandId: catchment.kystvandId, maxNLoadByYear }
      },
    )
    const trimmedSwing = db2SwingPct.trim()
    const selectedSaedskifter = Array.from(selectedPairs).map((pair) => {
      const [saedskiftevariant, variant] = pair.split(':')
      return { saedskiftevariant, variant }
    })

    setIsRunning(true)
    try {
      const response = await runYearlySimulationOptimization(farmId, simulation.id, {
        timeLimitSeconds,
        maxNLoadByKystvandopland,
        db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
        selectedSaedskifter,
      })
      await mutate(
        simulationFieldsKey(farmId, simulation.id),
        response.fields,
        { revalidate: false },
      )
      await invalidateOptimizationDisplays(farmId, simulation.id)
      onOptimized(response)
      handleOpenChange(false)
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : 'Kunne ikke køre års-optimeringen.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Års-optimering — {simulation.name}</DialogTitle>
          <DialogDescription>
            Optimér med udledningsloft pr. kalenderår og en grænse for hvor
            meget dækningsbidraget må svinge år til år. Vælg herunder hvilke
            sædskifter der må rykkes frem/tilbage i deres cyklus for at
            overholde grænserne — du styrer selv afvejningen mellem hvor
            mange muligheder optimeringen har, og hvor lang tid den tager.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            Indstillingerne herunder gælder <strong>kun denne kørsel</strong> og
            gemmes ikke på scenariet - de nulstilles, når dialogen lukkes, og
            vises derfor ikke under Regler. Noter dem, hvis du skal kunne
            gentage kørslen.
          </p>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="yearly-time-limit">Tidsgrænse</Label>
            <Input
              id="yearly-time-limit"
              type="number"
              min="1"
              max="600"
              value={timeLimitSeconds}
              onChange={(event) => setTimeLimitSeconds(Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">sekunder</p>
          </div>

          <div className="space-y-3">
            <Label>Maks. tilladt udledning pr. år, pr. kystvandopland</Label>
            {catchments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ingen marker med et kystvandopland i denne simulering.
              </p>
            ) : (
              catchments.map((catchment) => {
                const key = catchmentKey(catchment.kystvandId)
                const input = catchmentInput(key)
                return (
                  <div key={key} className="space-y-2 rounded border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{catchment.label}</span>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={input.sameForAllYears}
                          onChange={(event) =>
                            updateCatchmentInput(key, {
                              sameForAllYears: event.target.checked,
                            })
                          }
                        />
                        Samme grænse for alle år
                      </label>
                    </div>
                    {input.sameForAllYears ? (
                      <div className="space-y-1">
                        <Input
                          type="number"
                          min="0"
                          value={input.uniform}
                          placeholder="Ingen grænse"
                          onChange={(event) =>
                            updateCatchmentInput(key, { uniform: event.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">kg N, gælder hvert år</p>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-4">
                        {ROTATION_CALENDAR_YEARS.map((year) => (
                          <label key={year} className="space-y-1 text-sm">
                            <span className="text-xs text-muted-foreground">{year}</span>
                            <Input
                              type="number"
                              min="0"
                              value={input.perYear[year] ?? ''}
                              placeholder="Ingen grænse"
                              onChange={(event) =>
                                updateCatchmentInput(key, {
                                  perYear: { ...input.perYear, [year]: event.target.value },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="yearly-db-swing">Maks. udsving i DB2 mellem år</Label>
            <Input
              id="yearly-db-swing"
              type="number"
              min="0"
              value={db2SwingPct}
              placeholder="Ingen grænse"
              onChange={(event) => setDb2SwingPct(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              % — intet års samlede DB2 må afvige mere end dette fra
              gennemsnittet af scenariets år
            </p>
          </div>

          <div className="space-y-2">
            <Label>Sædskifter der må forskydes</Label>
            <p className="text-xs text-muted-foreground">
              Kun sædskifter du vælger her kan rykkes frem/tilbage i deres
              cyklus for at overholde grænserne ovenfor — resten indgår
              stadig i optimeringen, men fastholder deres nuværende
              års-fordeling. Ingen valgt = ingen forskydning, optimeringen
              vælger da kun blandt de allerede gemte kandidater.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {kategorier.map((kategori) => {
                const isExpanded = expandedKategorier.has(kategori.kategori)
                const selectedCount = kategori.saedskifter.filter((s) =>
                  selectedPairs.has(`${s.saedskiftevariant}:${s.variant}`),
                ).length
                const allSelected =
                  kategori.saedskifter.length > 0 &&
                  selectedCount === kategori.saedskifter.length
                const partiallySelected = selectedCount > 0 && !allSelected
                return (
                  <div key={kategori.kategori} className="rounded-md">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = partiallySelected
                        }}
                        onChange={() => toggleKategoriAll(kategori)}
                      />
                      <button
                        type="button"
                        className="flex flex-1 items-center justify-between gap-2 rounded-md text-left text-sm hover:bg-muted/50"
                        onClick={() => toggleExpanded(kategori.kategori)}
                      >
                        <span>
                          {kategori.kategori}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {selectedCount}/{kategori.saedskifter.length} valgt
                          </span>
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {isExpanded ? (
                      <div className="space-y-1 border-t px-2 py-1.5">
                        {kategori.saedskifter.map((option) => {
                          const key = `${option.saedskiftevariant}:${option.variant}`
                          return (
                            <label
                              key={key}
                              className="flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={selectedPairs.has(key)}
                                onChange={() =>
                                  togglePair(option.saedskiftevariant, option.variant)
                                }
                              />
                              <span>
                                {option.cropSequence.join(' - ')}{' '}
                                <span className="text-muted-foreground">
                                  (variant {option.variant})
                                </span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedPairs.size} sædskifter valgt · {fields.length} marker ·
              ~{estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
              (estimat, ikke en garanti)
            </p>
          </div>
        </div>

        {runError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
            {runError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Annuller
          </Button>
          <Button
            onClick={() => void runYearlyOptimization()}
            disabled={isRunning}
          >
            {isRunning ? 'Arbejder...' : 'Kør års-optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
