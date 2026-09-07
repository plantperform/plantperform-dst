import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  History,
  Info,
  List,
  Map as MapIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  useFarmHistoricalYearlySummary,
  useFarmEmissions,
  simulationFieldsKey,
  simulationYearlySummaryKey,
  useScenarioAfgrodeKoder,
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
import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import { FarmStatusHeader } from '@/components/farm/FarmStatusHeader'
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
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import {
  computeFieldTotals,
  formatNumber,
  resolveFarmQuota,
  ROTATION_START_CALENDAR_YEAR,
  YEAR_BAR_FILL_COLOR,
  YEAR_BAR_OVER_COLOR,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

// After an "Optimér" or "Års-optimering" run, simulationFieldsKey has already
// been updated directly from the response (no refetch needed). The yearly
// overview strip uses a separate SWR key, however, and would otherwise retain
// data from before the run. That is invisible to the user but makes new
// constraints or caps appear to have been ignored, so force a refetch.
//
// The "Beregningsgennemgang pr. år" panel (candidate detail) is deliberately no
// longer invalidated here. A broadly matching key revalidation previously
// refreshed every candidate-detail key the user had ever opened in this
// simulering, regardless of whether the mark actually received a new
// assignment. In scenarier with unoptimised marker, this caused a burst of
// concurrent failed requests (422 "ikke optimeret endnu") for every previously
// opened mark. SWR automatically reloads candidate detail the next time the
// panel opens (revalidation on mount), which is sufficient in practice.
const invalidateOptimizationDisplays = async (farmId: string, simulationId: string) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
}

const NUM_ROTATION_YEARS = 8
const ROTATION_CALENDAR_YEARS = Array.from(
  { length: NUM_ROTATION_YEARS },
  (_, index) => ROTATION_START_CALENDAR_YEAR + index,
)

type FarmView = 'list' | 'map'

const VIEW_OPTIONS: SegmentedControlOption<FarmView>[] = [
  { value: 'list', label: 'Liste', icon: List },
  { value: 'map', label: 'Kort', icon: MapIcon },
]

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
  simulationId?: string
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const simulationSummary = useSimulationYearlySummary(
    simulationId ? farm.id : undefined,
    simulationId,
  )
  const historicalSummary = useFarmHistoricalYearlySummary(
    simulationId ? undefined : farm.id,
  )
  const { data: historicalEmissionsByCatchment = [] } = useFarmEmissions(
    simulationId ? undefined : farm.id,
  )
  const { data: entries, error } = simulationId
    ? simulationSummary
    : historicalSummary
  const quota = useMemo(
    () =>
      resolveFarmQuota(
        computeFieldTotals(fields, Boolean(simulationId)).udledningskvoteMarkKgn,
      ),
    [fields, simulationId],
  )

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Kunne ikke hente årsoversigten: {error.message}
      </div>
    )
  }
  if (!entries || entries.length === 0) return null

  const firstYear = simulationId
    ? ROTATION_START_CALENDAR_YEAR + entries[0].year - 1
    : entries[0].year
  const lastYear = simulationId
    ? ROTATION_START_CALENDAR_YEAR + entries[entries.length - 1].year - 1
    : entries[entries.length - 1].year

  const overYearCount =
    quota.quotaKgn > 0
      ? entries.filter((entry) => entry.totalNLoadKg > quota.quotaKgn).length
      : 0
  const overCatchmentCount = historicalEmissionsByCatchment.filter(
    (entry) => !entry.overholder,
  ).length
  const compliantCatchmentCount =
    historicalEmissionsByCatchment.length - overCatchmentCount

  return (
    <div className="rounded-lg border bg-card">
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
              {firstYear}-{lastYear} - DB2 og udledning år for år
              {overYearCount > 0 ? (
                <span className="ml-1 font-medium text-red-700">
                  · {overYearCount} af {entries.length} år over grænsen
                </span>
              ) : null}
              {!simulationId && historicalEmissionsByCatchment.length > 0 ? (
                <span className="ml-1">
                  · Vandoplande: {compliantCatchmentCount} overholder,{' '}
                  {overCatchmentCount} overskrider
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <YearlyOverviewMiniBars entries={entries} quotaKgn={quota.quotaKgn} />
      </button>
      {isOpen ? (
        <div className="border-t px-4 pb-4 pt-3">
          {!simulationId ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Årsoversigten er samlet for bedriften. Historisk udledning og
              kvote for hvert Vandopland vises under Nøgletal; de tal viser
              historikken, ikke et optimeringsresultat.
            </p>
          ) : null}
          <YearlyOverviewTable
            entries={entries}
            quota={quota}
            yearsAreCalendarYears={!simulationId}
          />
        </div>
      ) : null}
    </div>
  )
}

type LastRun = {
  simulationId: string
  response: OptimizeSimulationResponse
}

type FarmInspectorProps = {
  farm: Farm
  fields: FieldRecord[]
  selection: FarmViewSelection
  selectedSimulation?: Simulation
  fieldsLoading?: boolean
  fieldsError?: boolean
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  optimizeDialogOpen: boolean
  onOptimizeDialogOpenChange: (open: boolean) => void
  yearlyOptimizeDialogOpen: boolean
  onYearlyOptimizeDialogOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}

export const FarmInspector = ({
  farm,
  fields,
  selection,
  selectedSimulation,
  fieldsLoading = false,
  fieldsError = false,
  mode,
  onModeChange,
  optimizeDialogOpen,
  onOptimizeDialogOpenChange,
  yearlyOptimizeDialogOpen,
  onYearlyOptimizeDialogOpenChange,
  onError,
}: FarmInspectorProps) => {
  const [view, setView] = useState<FarmView>('list')
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [fieldsSort, setFieldsSort] =
    useState<FieldsSortState>(DEFAULT_FIELDS_SORT)
  const isSimulationView = selection.kind === 'simulation'

  const canSwitchMode = isSimulationView && Boolean(selectedSimulation)
  const effectiveMode: FarmInspectorMode = canSwitchMode ? mode : 'values'
  const isRules = effectiveMode === 'rules'
  const loadingMessage = selectedSimulation
    ? `Indlæser marker for simuleringen ${selectedSimulation.name}...`
    : 'Indlæser marker...'
  if (lastRun && lastRun.simulationId !== selectedSimulation?.id) {
    setLastRun(null)
  }

  const openRules = () => {
    onOptimizeDialogOpenChange(false)
    onModeChange('rules')
  }

  const recordRun = (response: OptimizeSimulationResponse) => {
    if (!selectedSimulation) return
    setLastRun({ simulationId: selectedSimulation.id, response })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <FarmTopBar
        farm={farm}
        viewLabel={
          selectedSimulation
            ? `Simulering: ${selectedSimulation.name}`
            : 'Afgrødehistorik'
        }
        viewIcon={selectedSimulation ? FlaskConical : History}
        actions={
          <SegmentedControl
            aria-label="Liste eller kort"
            value={view}
            options={VIEW_OPTIONS}
            onValueChange={setView}
            labelClassName="hidden @4xl:inline"
          />
        }
      />

      {selectedSimulation ? (
        <OptimizeDialog
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={optimizeDialogOpen}
          onOpenChange={onOptimizeDialogOpenChange}
          onOptimized={recordRun}
          onOpenRules={openRules}
        />
      ) : null}

      {selectedSimulation ? (
        <YearlyOptimizeDialog
          key={`yearly-${selectedSimulation.id}`}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={yearlyOptimizeDialogOpen}
          onOpenChange={onYearlyOptimizeDialogOpenChange}
          onOptimized={recordRun}
        />
      ) : null}

      <div
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        aria-busy={fieldsLoading}
      >
        <p role="status" className="sr-only">
          {fieldsLoading ? loadingMessage : ''}
        </p>
        <div
          className={cn(
            'h-full p-3',
            view === 'list'
              ? 'space-y-3 overflow-y-auto'
              : 'flex flex-col gap-3',
            isRules && 'bg-rules/5',
          )}
        >
          {isRules || fieldsError ? null : (
            <FarmStatusHeader
              farmId={farm.id}
              fields={fields}
              isSimulationView={isSimulationView}
              lastRun={lastRun?.response ?? null}
              loading={fieldsLoading}
            />
          )}
          {isRules && selectedSimulation && !fieldsLoading ? (
            <SimulationRulesPanel
              key={selectedSimulation.id}
              farmId={farm.id}
              simulation={selectedSimulation}
              fields={fields}
            />
          ) : null}
          {fieldsLoading ? (
            <FarmFieldsSkeleton message={loadingMessage} />
          ) : fieldsError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              Kunne ikke hente simuleringens marker. Prøv igen om lidt.
            </div>
          ) : view === 'list' ? (
            <>
              {!isRules ? (
                <YearlyOverviewSection
                  farm={farm}
                  fields={fields}
                  simulationId={
                    selection.kind === 'simulation' ? selection.id : undefined
                  }
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
      </div>
    </section>
  )
}

type OptimizeDialogProps = {
  farmId: string
  simulation: Simulation
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
  onOpenRules: () => void
}

const formatLimit = (value: number | null, unit: string) =>
  value === null ? 'Ingen grænse' : `${formatNumber(value)} ${unit}`

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

const AfgrodeExclusionList = ({
  farmId,
  simulationId,
  excludedCodes,
  onToggle,
}: {
  farmId: string
  simulationId: string
  excludedCodes: Set<number>
  onToggle: (code: number) => void
}) => {
  const { data: afgroder = [] } = useScenarioAfgrodeKoder(farmId, simulationId)
  if (afgroder.length === 0) return null

  return (
    <div className="space-y-2">
      <Label>Afgrøder</Label>
      <p className="text-xs text-muted-foreground">
        Fravælg en afgrøde for at udelukke alle sædskifter, der indeholder den
        et eller flere steder. Valget gælder kun denne kørsel.
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {afgroder.map((afgrode) => (
          <label
            key={afgrode.code}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!excludedCodes.has(afgrode.code)}
              onChange={() => onToggle(afgrode.code)}
            />
            <span>{afgrode.navn}</span>
          </label>
        ))}
      </div>
    </div>
  )
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
  const [excludedAfgrodekoder, setExcludedAfgrodekoder] = useState<Set<number>>(new Set())

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
    if (!nextOpen) {
      setRunError(null)
      setExcludedAfgrodekoder(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleAfgrode = (code: number) => {
    setExcludedAfgrodekoder((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const runOptimization = async () => {
    setIsRunning(true)
    try {
      const response = await runSimulationOptimization(farmId, simulation.id, {
        timeLimitSeconds,
        excludedAfgrodekoder: Array.from(excludedAfgrodekoder),
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
            Kør optimeringen med de regler, der er gemt på simuleringen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2 rounded-lg border border-rules/30 bg-rules/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal
                className="h-4 w-4 text-rules"
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
                className="rounded-sm font-medium text-rules underline underline-offset-2 hover:text-rules/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
              sekunder - sæt højere hvis optimeringen ikke når at finde en
              løsning i tide på en stor bedrift
            </p>
          </div>

          <AfgrodeExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedAfgrodekoder}
            onToggle={toggleAfgrode}
          />
        </div>

        {runError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
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
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [excludedAfgrodekoder, setExcludedAfgrodekoder] = useState<Set<number>>(new Set())

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRunError(null)
      setExcludedAfgrodekoder(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleAfgrode = (code: number) => {
    setExcludedAfgrodekoder((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
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

  // Estimate, not a guarantee. Every candidate may be shifted.
  const estimatedSeconds = useMemo(() => {
    let totalShiftUnits = 0
    for (const kategori of kategorier) {
      for (const option of kategori.saedskifter) {
        totalShiftUnits += option.activeLen
      }
    }
    return fields.length * totalShiftUnits * 0.002
  }, [fields.length, kategorier])

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
    setIsRunning(true)
    try {
      const response = await runYearlySimulationOptimization(farmId, simulation.id, {
        timeLimitSeconds,
        maxNLoadByKystvandopland,
        db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
        excludedAfgrodekoder: Array.from(excludedAfgrodekoder),
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
          <DialogTitle>Års-optimering - {simulation.name}</DialogTitle>
          <DialogDescription>
            Optimér med udledningsloft pr. kalenderår og en grænse for hvor
            meget dækningsbidraget må svinge år til år. Alle sædskifter kan
            rykkes frem eller tilbage i deres cyklus.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            Indstillingerne herunder gælder <strong>kun denne kørsel</strong> og
            gemmes ikke på simuleringen - de nulstilles, når dialogen lukkes, og
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
              % - intet års samlede DB2 må afvige mere end dette fra
              gennemsnittet af simuleringens år
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Alle sædskifter kan forskydes · {fields.length} marker ·
            ~{estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
            (estimat, ikke en garanti)
          </p>

          <AfgrodeExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedAfgrodekoder}
            onToggle={toggleAfgrode}
          />
        </div>

        {runError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap text-red-700">
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
