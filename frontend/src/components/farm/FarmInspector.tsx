import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  History,
  Info,
  List,
  Map as MapIcon,
  SlidersHorizontal,
  Table2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

const invalidateOptimizationDisplays = async (
  farmId: string,
  simulationId: string,
) => {
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

type FarmView = 'list' | 'map'

const VIEW_OPTIONS: SegmentedControlOption<FarmView>[] = [
  { value: 'list', label: 'Liste', icon: List },
  { value: 'map', label: 'Kort', icon: MapIcon },
]

const MODE_OPTIONS: SegmentedControlOption<FarmInspectorMode>[] = [
  {
    value: 'values',
    label: 'Værdier',
    icon: Table2,
    title: 'Vis hvad optimeringen har beregnet for markerne',
  },
  {
    value: 'rules',
    label: 'Regler',
    icon: SlidersHorizontal,
    title: 'Sæt hvad optimeringen må gøre',
    activeClassName: 'bg-rules text-rules-foreground hover:bg-rules/90',
  },
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
  simulationId: string
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const { data: entries } = useSimulationYearlySummary(farm.id, simulationId)
  const quota = useMemo(
    () =>
      resolveFarmQuota(computeFieldTotals(fields, true).udledningskvoteMarkKgn),
    [fields],
  )

  if (!entries || entries.length === 0) return null

  const overYearCount =
    quota.quotaKgn > 0
      ? entries.filter((entry) => entry.totalNLoadKg > quota.quotaKgn).length
      : 0

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
              {YEARLY_OVERVIEW_YEAR_RANGE_LABEL} - DB2 og udledning pr.
              kalenderår
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

type OptimizeButtonProps = {
  onOptimize: () => void
  onYearlyOptimize: () => void
  disabled?: boolean
}

const OptimizeButton = ({
  onOptimize,
  onYearlyOptimize,
  disabled = false,
}: OptimizeButtonProps) => (
  <div className="flex shrink-0 items-center">
    <Button
      size="xs"
      className="rounded-r-none"
      onClick={onOptimize}
      disabled={disabled}
    >
      Optimér
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          className="rounded-l-none border-l border-primary-foreground/25 px-1.5"
          aria-label="Flere måder at optimere"
          disabled={disabled}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onYearlyOptimize}>
          <CalendarRange className="mr-2 size-4" aria-hidden="true" />
          Års-optimering...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)

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
  onError: (message: string | null) => void
}

export const FarmInspector = ({
  farm,
  fields,
  selection,
  selectedSimulation,
  fieldsLoading = false,
  fieldsError = false,
  onError,
}: FarmInspectorProps) => {
  const [view, setView] = useState<FarmView>('list')
  const [mode, setMode] = useState<FarmInspectorMode>('values')
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false)
  const [yearlyOptimizeDialogOpen, setYearlyOptimizeDialogOpen] = useState(false)
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
    setOptimizeDialogOpen(false)
    setMode('rules')
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
        onError={onError}
        actions={
          <>
            {canSwitchMode ? (
              <SegmentedControl
                aria-label="Værdier eller regler"
                value={effectiveMode}
                options={MODE_OPTIONS}
                onValueChange={setMode}
                className="bg-rules/10"
                labelClassName="hidden @4xl:inline"
                disabled={fieldsLoading}
              />
            ) : null}
            {selectedSimulation ? (
              <OptimizeButton
                onOptimize={() => setOptimizeDialogOpen(true)}
                onYearlyOptimize={() => setYearlyOptimizeDialogOpen(true)}
                disabled={fieldsLoading}
              />
            ) : null}
            <SegmentedControl
              aria-label="Liste eller kort"
              value={view}
              options={VIEW_OPTIONS}
              onValueChange={setView}
              labelClassName="hidden @4xl:inline"
            />
          </>
        }
      />

      {selectedSimulation ? (
        <OptimizeDialog
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
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
          onOpenChange={setYearlyOptimizeDialogOpen}
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
          <DialogTitle>Års-optimering - {simulation.name}</DialogTitle>
          <DialogDescription>
            Optimér med udledningsloft pr. kalenderår og en grænse for hvor
            meget dækningsbidraget må svinge år til år. Vælg herunder hvilke
            sædskifter der må rykkes frem/tilbage i deres cyklus for at
            overholde grænserne - du styrer selv afvejningen mellem hvor
            mange muligheder optimeringen har, og hvor lang tid den tager.
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

          <div className="space-y-2">
            <Label>Sædskifter der må forskydes</Label>
            <p className="text-xs text-muted-foreground">
              Kun sædskifter du vælger her kan rykkes frem/tilbage i deres
              cyklus for at overholde grænserne ovenfor - resten indgår
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
