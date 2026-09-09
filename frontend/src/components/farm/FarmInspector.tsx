import {
  Columns2,
  FlaskConical,
  History,
  Info,
  List,
  Map as MapIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationYearlySummaryKey,
  useScenarioAfgrodeKoder,
  useSimulationFieldYearValues,
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
} from '@/api/types'
import { CatchmentChips } from '@/components/farm/CatchmentChips'
import {
  catchmentKey,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  resolveEffectiveFieldsSort,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import { FarmSplitView } from '@/components/farm/FarmSplitView'
import { FarmTopBar } from '@/components/farm/FarmTopBar'
import { FieldDetailPanel } from '@/components/farm/FieldDetailPanel'
import { SimulationRulesPanel } from '@/components/farm/SimulationRulesPanel'
import { resolveEffectiveView } from '@/components/farm/split-layout'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
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
  formatNumber,
  countCatchmentsOverQuota,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'
import { useEscapeKey } from '@/hooks/use-escape-key'
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

const SPLIT_UNAVAILABLE_TITLE = 'Skærmen er for smal til delt visning'

const buildViewOptions = (
  splitAvailable: boolean,
): SegmentedControlOption<FarmView>[] => [
  { value: 'list', label: 'Liste', icon: List },
  {
    value: 'split',
    label: 'Delt',
    icon: Columns2,
    disabled: !splitAvailable,
    title: splitAvailable ? undefined : SPLIT_UNAVAILABLE_TITLE,
  },
  { value: 'map', label: 'Kort', icon: MapIcon },
]

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
  view: FarmView
  onViewChange: (view: FarmView) => void
  listSlack: number
  onListSlackChange: (slack: number) => void
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  selectedYearIndex: number | null
  onSelectedYearIndexChange: (index: number | null) => void
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
  view,
  onViewChange,
  listSlack,
  onListSlackChange,
  selectedFieldId,
  onSelectedFieldChange,
  selectedYearIndex,
  onSelectedYearIndexChange,
  optimizeDialogOpen,
  onOptimizeDialogOpenChange,
  yearlyOptimizeDialogOpen,
  onYearlyOptimizeDialogOpenChange,
  onError,
}: FarmInspectorProps) => {
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [fieldsSort, setFieldsSort] =
    useState<FieldsSortState>(DEFAULT_FIELDS_SORT)
  const [splitAvailable, setSplitAvailable] = useState(true)
  const [listRequiredWidth, setListRequiredWidth] = useState<number | null>(
    null,
  )
  const [panelCalcOpen, setPanelCalcOpen] = useState(false)
  const [addModeSnap, setAddModeSnap] = useState(false)
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null)
  const [highlightedCatchmentKey, setHighlightedCatchmentKey] = useState<
    string | null
  >(null)
  const [walkthroughOpenOverride, setWalkthroughOpenOverride] = useState<
    boolean | null
  >(null)
  const [zoomRequest, setZoomRequest] = useState<{
    fieldId: string
    nonce: number
  } | null>(null)
  const [rowFocusRequest, setRowFocusRequest] = useState<{
    fieldId: string
    nonce: number
  } | null>(null)
  const viewOptions = useMemo(
    () => buildViewOptions(splitAvailable),
    [splitAvailable],
  )
  const snappedView: FarmView = addModeSnap ? 'map' : view
  const effectiveView = resolveEffectiveView(snappedView, splitAvailable)
  const changeView = (next: FarmView) => {
    setAddModeSnap(false)
    onViewChange(next)
  }
  const isSimulationView = selection.kind === 'simulation'
  const selectionKey =
    selection.kind === 'simulation'
      ? `${farm.id}:simulation-${selection.id}`
      : `${farm.id}:current`
  const [hoveredSelectionKey, setHoveredSelectionKey] = useState(selectionKey)
  if (hoveredSelectionKey !== selectionKey) {
    setHoveredSelectionKey(selectionKey)
    setHoveredFieldId(null)
    setHighlightedCatchmentKey(null)
  }

  const requestZoomToField = (fieldId: string) =>
    setZoomRequest((current) => ({
      fieldId,
      nonce: (current?.nonce ?? 0) + 1,
    }))

  const requestRowFocus = (fieldId: string) =>
    setRowFocusRequest((current) => ({
      fieldId,
      nonce: (current?.nonce ?? 0) + 1,
    }))

  const canSwitchMode = isSimulationView && Boolean(selectedSimulation)
  const effectiveMode: FarmInspectorMode = canSwitchMode ? mode : 'values'
  const isRules = effectiveMode === 'rules'
  const [highlightedMode, setHighlightedMode] = useState(effectiveMode)
  if (highlightedMode !== effectiveMode) {
    setHighlightedMode(effectiveMode)
    setHighlightedCatchmentKey(null)
  }
  const loadingMessage = selectedSimulation
    ? `Indlæser marker for simuleringen ${selectedSimulation.name}...`
    : 'Indlæser marker...'
  if (lastRun && lastRun.simulationId !== selectedSimulation?.id) {
    setLastRun(null)
  }

  const catchmentOverview = useMemo(
    () => countCatchmentsOverQuota(fields, isSimulationView),
    [fields, isSimulationView],
  )

  const effectiveSort = resolveEffectiveFieldsSort(fieldsSort, isRules)
  const sortedFields = useMemo(
    () =>
      [...fields].sort((left, right) =>
        compareFields(left, right, effectiveSort),
      ),
    [fields, effectiveSort],
  )
  const panelField = isRules
    ? null
    : (fields.find((field) => field.id === selectedFieldId) ?? null)

  const effectiveHighlightedCatchmentKey = useMemo(() => {
    if (isRules || highlightedCatchmentKey === null) return null
    const stillPresent = fields.some(
      (field) => catchmentKey(field.kystvandId) === highlightedCatchmentKey,
    )
    return stillPresent ? highlightedCatchmentKey : null
  }, [fields, isRules, highlightedCatchmentKey])

  const selectFieldFromMap = (fieldId: string | null) => {
    onSelectedFieldChange(fieldId)
    if (isRules && fieldId !== null) requestRowFocus(fieldId)
  }

  const handleEscape = useCallback(() => {
    if (panelField !== null) {
      onSelectedFieldChange(null)
      return true
    }
    if (effectiveHighlightedCatchmentKey !== null) {
      setHighlightedCatchmentKey(null)
      return true
    }
    return false
  }, [panelField, effectiveHighlightedCatchmentKey, onSelectedFieldChange])
  useEscapeKey(handleEscape)

  const showYearWalkthrough = isSimulationView && !isRules && !fieldsError
  const effectiveSelectedYearIndex = showYearWalkthrough
    ? selectedYearIndex
    : null
  const yearValuesEnabled =
    effectiveSelectedYearIndex !== null &&
    (effectiveView !== 'list' || selectedFieldId !== null)
  const { data: yearValues, isLoading: yearValuesLoading } =
    useSimulationFieldYearValues(
      farm.id,
      selectedSimulation?.id,
      fields,
      yearValuesEnabled,
    )
  const { data: yearlySummary, isLoading: yearlySummaryLoading } =
    useSimulationYearlySummary(farm.id, selectedSimulation?.id)

  const openRules = () => {
    onOptimizeDialogOpenChange(false)
    onModeChange('rules')
  }

  const recordRun = (response: OptimizeSimulationResponse) => {
    if (!selectedSimulation) return
    setLastRun({ simulationId: selectedSimulation.id, response })
  }

  const rulesPanel =
    isRules && selectedSimulation && !fieldsLoading ? (
      <SimulationRulesPanel
        key={selectedSimulation.id}
        farmId={farm.id}
        simulation={selectedSimulation}
        fields={fields}
      />
    ) : null

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
            aria-label="Liste, delt eller kort"
            value={effectiveView}
            options={viewOptions}
            onValueChange={(next) => {
              if (next !== effectiveView) changeView(next)
            }}
            labelClassName="hidden @4xl:inline"
          />
        }
      />

      {selectedSimulation ? (
        <OptimizeDialog
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          fields={fields}
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
          fields={fields}
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
            'flex h-full flex-col gap-3 overflow-y-auto p-3',
            isRules && 'bg-rules/5',
          )}
        >
          {showYearWalkthrough && selection.kind === 'simulation' ? (
            <YearWalkthrough
              key={selection.id}
              entries={yearlySummary}
              loading={fieldsLoading || yearlySummaryLoading}
              fields={fields}
              selectedYearIndex={selectedYearIndex}
              onSelectedYearIndexChange={onSelectedYearIndexChange}
              catchmentOverview={catchmentOverview}
              lastRun={lastRun?.response ?? null}
              collapsible
              openOverride={walkthroughOpenOverride}
              onOpenOverrideChange={setWalkthroughOpenOverride}
            />
          ) : null}
          {!isRules && !fieldsLoading && !fieldsError && fields.length > 0 ? (
            <CatchmentChips
              farmId={farm.id}
              fields={fields}
              isSimulationView={isSimulationView}
              highlightedKey={effectiveHighlightedCatchmentKey}
              onHighlightedKeyChange={setHighlightedCatchmentKey}
            />
          ) : null}
          {fieldsLoading ? (
            <FarmFieldsSkeleton message={loadingMessage} />
          ) : fieldsError ? (
            <>
              {rulesPanel}
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
              >
                Kunne ikke hente simuleringens marker. Prøv igen om lidt.
              </div>
            </>
          ) : (
            <FarmSplitView
              view={snappedView}
              onViewChange={changeView}
              listSlack={listSlack}
              onListSlackChange={onListSlackChange}
              listRequiredWidth={listRequiredWidth}
              onSplitAvailableChange={setSplitAvailable}
              list={({ width }) => (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  {rulesPanel}
                  <FarmFieldsList
                    farmId={farm.id}
                    sortedFields={sortedFields}
                    isSimulationView={isSimulationView}
                    catchmentOverview={catchmentOverview}
                    simulationId={
                      selection.kind === 'simulation' ? selection.id : undefined
                    }
                    simulation={
                      selection.kind === 'simulation'
                        ? selectedSimulation
                        : undefined
                    }
                    mode={effectiveMode}
                    sort={fieldsSort}
                    onSortChange={setFieldsSort}
                    selectedFieldId={selectedFieldId}
                    onSelectedFieldChange={onSelectedFieldChange}
                    hoveredFieldId={hoveredFieldId}
                    onHoveredFieldChange={setHoveredFieldId}
                    highlightedCatchmentKey={effectiveHighlightedCatchmentKey}
                    onZoomToField={
                      effectiveView === 'list' ? undefined : requestZoomToField
                    }
                    focusRequest={rowFocusRequest ?? undefined}
                    selectedYearIndex={effectiveSelectedYearIndex}
                    paneWidth={width}
                    onRequiredWidthChange={setListRequiredWidth}
                    onError={onError}
                  />
                </div>
              )}
              map={
                <FarmFieldsMap
                  key={selectionKey}
                  farm={farm}
                  fields={fields}
                  readOnly={isSimulationView}
                  mode={effectiveMode}
                  selectedYearIndex={effectiveSelectedYearIndex}
                  yearValues={yearValues}
                  yearValuesLoading={yearValuesEnabled && yearValuesLoading}
                  selectedFieldId={selectedFieldId}
                  onSelectedFieldChange={selectFieldFromMap}
                  hoveredFieldId={hoveredFieldId}
                  onHoveredFieldChange={setHoveredFieldId}
                  highlightedCatchmentKey={effectiveHighlightedCatchmentKey}
                  zoomRequest={zoomRequest ?? undefined}
                  onAddModeChange={setAddModeSnap}
                  onError={onError}
                />
              }
              panelWide={panelCalcOpen}
              renderPanel={
                panelField
                  ? ({ listBehind, mapVisible }) => (
                      <FieldDetailPanel
                        farmId={farm.id}
                        field={panelField}
                        sortedFields={sortedFields}
                        isSimulationView={isSimulationView}
                        simulationId={
                          selection.kind === 'simulation'
                            ? selection.id
                            : undefined
                        }
                        simulation={
                          selection.kind === 'simulation'
                            ? selectedSimulation
                            : undefined
                        }
                        selectedYearIndex={effectiveSelectedYearIndex}
                        onSelectedYearIndexChange={onSelectedYearIndexChange}
                        yearValues={yearValues?.[panelField.id]}
                        listBehind={listBehind}
                        mapVisible={mapVisible}
                        onSelectFieldId={onSelectedFieldChange}
                        onClose={() => onSelectedFieldChange(null)}
                        onZoomToField={requestZoomToField}
                        onCalcOpenChange={setPanelCalcOpen}
                        onError={onError}
                      />
                    )
                  : undefined
              }
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
  fields: FieldRecord[]
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
  fields,
  open,
  onOpenChange,
  onOptimized,
  onOpenRules,
}: OptimizeDialogProps) => {
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(15)
  const [excludedAfgrodekoder, setExcludedAfgrodekoder] = useState<Set<number>>(new Set())

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
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOptimized: (response: OptimizeSimulationResponse) => void
}

const YearlyOptimizeDialog = ({
  farmId,
  simulation,
  fields,
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
