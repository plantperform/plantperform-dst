import { Info, SlidersHorizontal } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationYearlySummaryKey,
  useFarmHistoricalYearlySummary,
  useScenarioCropCodes,
  useFieldYearValues,
  useSimulationYearlySummary,
  useYearlyOptimizationCandidates,
} from '@/api/hooks'
import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
  updateSimulationField,
} from '@/api/mutations'
import type {
  Farm,
  FieldRecord,
  CatchmentYearlyNLoadCaps,
  OptimizeSimulationResponse,
  Simulation,
} from '@/api/types'
import { CatchmentPicker } from '@/components/farm/CatchmentPicker'
import {
  catchmentKey,
  fieldInCatchment,
  useCatchmentColor,
  useCatchmentLabel,
  useCatchmentOptions,
} from '@/components/farm/catchment-options'
import { useDetachFields } from '@/components/farm/detach-fields'
import { DetachFieldsDialog } from '@/components/farm/DetachFieldsDialog'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  resolveEffectiveFieldsSort,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import { FarmSplitView } from '@/components/farm/FarmSplitView'
import { FieldDetailPanel } from '@/components/farm/FieldDetailPanel'
import { FieldSearch } from '@/components/farm/FieldSearch'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { SimulationRulesPanel } from '@/components/farm/SimulationRulesPanel'
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
  applyFieldYearValues,
  formatNumber,
  isFieldLocked,
  orderFieldsByCatchment,
  ROTATION_CALENDAR_YEARS,
  summarizeCatchmentYearTotals,
  summarizeFieldYears,
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
// simulation, regardless of whether the field actually received a new
// assignment. In scenarios with unoptimised fields, this caused a burst of
// concurrent failed requests (422 "ikke optimeret endnu") for every previously
// opened field. SWR automatically reloads candidate detail the next time the
// panel opens (revalidation on mount), which is sufficient in practice.
const invalidateOptimizationDisplays = async (
  farmId: string,
  simulationId: string,
) => {
  await mutate(simulationYearlySummaryKey(farmId, simulationId))
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
  view: FarmView
  effectiveView: FarmView
  onViewChange: (view: FarmView) => void
  onSplitAvailableChange: (available: boolean) => void
  onAddModeChange: (active: boolean) => void
  listSlack: number
  onListSlackChange: (slack: number) => void
  selectedFieldId: string | null
  onSelectedFieldChange: (fieldId: string | null) => void
  onSelectField: (fieldId: string) => void
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
  effectiveView,
  onViewChange,
  onSplitAvailableChange,
  onAddModeChange,
  listSlack,
  onListSlackChange,
  selectedFieldId,
  onSelectedFieldChange,
  onSelectField,
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
  const [listRequiredWidth, setListRequiredWidth] = useState<number | null>(
    null,
  )
  const [panelCalcOpen, setPanelCalcOpen] = useState(false)
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [bindFieldId, setBindFieldId] = useState<string | null>(null)
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null)
  const [highlightedCatchmentKey, setHighlightedCatchmentKey] = useState<
    string | null
  >(null)
  const [zoomRequest, setZoomRequest] = useState<{
    fieldId: string
    nonce: number
  } | null>(null)
  const [rowFocusRequest, setRowFocusRequest] = useState<{
    fieldId: string
    nonce: number
  } | null>(null)
  const [detachRequest, setDetachRequest] = useState<FieldRecord[]>([])
  const { detachingFieldIds, detachFields } = useDetachFields(farm.id, onError)
  const requestDetach = useCallback(
    (field: FieldRecord) => setDetachRequest([field]),
    [],
  )
  const isSimulationView = selection.kind === 'simulation'
  const selectedSimulationId = selectedSimulation?.id
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

  const confirmDetach = () => {
    const fieldIds = detachRequest.map((field) => field.id)
    setDetachRequest([])
    void detachFields(fieldIds)
  }

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

  const effectiveHighlightedCatchmentKey = useMemo(() => {
    if (isRules || highlightedCatchmentKey === null) return null
    const stillPresent = fields.some((field) =>
      fieldInCatchment(field, highlightedCatchmentKey),
    )
    return stillPresent ? highlightedCatchmentKey : null
  }, [fields, isRules, highlightedCatchmentKey])

  const catchmentLabel = useCatchmentLabel(farm.id, fields)
  const highlightedFields = useMemo(
    () =>
      effectiveHighlightedCatchmentKey === null
        ? fields
        : fields.filter((field) =>
            fieldInCatchment(field, effectiveHighlightedCatchmentKey),
          ),
    [fields, effectiveHighlightedCatchmentKey],
  )
  const effectiveSort = resolveEffectiveFieldsSort(fieldsSort, isRules)
  const panelField = isRules
    ? null
    : (fields.find((field) => field.id === selectedFieldId) ?? null)
  const bindField = fields.find((field) => field.id === bindFieldId) ?? null

  const toggleFieldLock = useCallback(
    async (field: FieldRecord) => {
      if (!selectedSimulationId || field.rotationId === null) return

      const target = isFieldLocked(field) ? [] : [field.rotationId]
      setLockingFieldId(field.id)
      try {
        const updatedField = await updateSimulationField(
          farm.id,
          selectedSimulationId,
          field.id,
          { allowedRotationIds: target },
        )
        await mutate(
          simulationFieldsKey(farm.id, selectedSimulationId),
          (current: FieldRecord[] = []) =>
            current.map((currentField) =>
              currentField.id === updatedField.id ? updatedField : currentField,
            ),
          { revalidate: false },
        )
        onError(null)
      } catch {
        onError('Kunne ikke ændre låsningen af marken.')
      } finally {
        setLockingFieldId(null)
      }
    },
    [farm.id, selectedSimulationId, onError],
  )
  const onToggleLock = useCallback(
    (field: FieldRecord) => void toggleFieldLock(field),
    [toggleFieldLock],
  )
  const onBindRotation = useCallback(
    (field: FieldRecord) => setBindFieldId(field.id),
    [],
  )

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

  const showYearWalkthrough = !isRules && !fieldsError
  const effectiveSelectedYearIndex = showYearWalkthrough
    ? selectedYearIndex
    : null
  const { data: yearValues, isLoading: yearValuesLoading } =
    useFieldYearValues(
      farm.id,
      selectedSimulation?.id,
      fields,
      showYearWalkthrough,
    )
  const listFields = useMemo(
    () =>
      effectiveSelectedYearIndex !== null && yearValues
        ? applyFieldYearValues(fields, yearValues, effectiveSelectedYearIndex)
        : fields,
    [fields, yearValues, effectiveSelectedYearIndex],
  )
  const sortedFields = useMemo(() => {
    const sorted = [...listFields].sort((left, right) =>
      compareFields(left, right, effectiveSort, catchmentLabel),
    )
    const ordered = isRules
      ? sorted
      : orderFieldsByCatchment(sorted, catchmentLabel)
    if (effectiveHighlightedCatchmentKey === null) return ordered
    const inCatchment = (field: FieldRecord) =>
      fieldInCatchment(field, effectiveHighlightedCatchmentKey)
    return [
      ...ordered.filter(inCatchment),
      ...ordered.filter((field) => !inCatchment(field)),
    ]
  }, [
    listFields,
    effectiveSort,
    catchmentLabel,
    isRules,
    effectiveHighlightedCatchmentKey,
  ])
  const simulationSummary = useSimulationYearlySummary(
    farm.id,
    selectedSimulation?.id,
  )
  const historicalSummary = useFarmHistoricalYearlySummary(
    isSimulationView ? undefined : farm.id,
  )
  const {
    data: yearlySummary,
    isLoading: yearlySummaryLoading,
    error: yearlySummaryError,
  } = isSimulationView ? simulationSummary : historicalSummary
  const isCatchmentScoped =
    showYearWalkthrough && effectiveHighlightedCatchmentKey !== null
  const catchmentSummary = useMemo(
    () =>
      isCatchmentScoped
        ? summarizeFieldYears(highlightedFields, yearValues, !isSimulationView)
        : undefined,
    [isCatchmentScoped, highlightedFields, yearValues, isSimulationView],
  )
  const catchmentColor = useCatchmentColor(farm.id, fields)
  const catchmentTotalsByYear = useMemo(
    () => summarizeCatchmentYearTotals(fields, yearValues, !isSimulationView),
    [fields, yearValues, isSimulationView],
  )
  const scopeLabel = isCatchmentScoped
    ? catchmentLabel(highlightedFields[0]?.catchmentId ?? null)
    : null

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

  const fieldSearch = (
    <FieldSearch
      fields={fields}
      loading={fieldsLoading}
      onSelectField={onSelectField}
    />
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col">
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

      <DetachFieldsDialog
        fields={detachRequest}
        onCancel={() => setDetachRequest([])}
        onConfirm={confirmDetach}
      />

      <div
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        aria-busy={fieldsLoading}
      >
        <p role="status" className="sr-only">
          {fieldsLoading ? loadingMessage : ''}
        </p>
        <div
          className={cn(
            'flex h-full flex-col gap-2 overflow-y-auto px-4 pb-4 pt-2',
            isRules && 'bg-rules/5',
          )}
        >
          {showYearWalkthrough ? (
            <div className="flex flex-wrap gap-3">
              {!fieldsLoading && fields.length > 0 ? (
                <CatchmentPicker
                  farmId={farm.id}
                  fields={fields}
                  isSimulationView={isSimulationView}
                  highlightedKey={effectiveHighlightedCatchmentKey}
                  onHighlightedKeyChange={setHighlightedCatchmentKey}
                />
              ) : null}
            <YearWalkthrough
              key={selectionKey}
              entries={catchmentSummary ?? yearlySummary}
              loading={
                fieldsLoading ||
                yearValuesLoading ||
                (!isCatchmentScoped && yearlySummaryLoading)
              }
              fields={highlightedFields}
              scopeLabel={scopeLabel}
              catchmentTotalsByYear={catchmentTotalsByYear}
              selectedYearIndex={selectedYearIndex}
              onSelectedYearIndexChange={onSelectedYearIndexChange}
              catchmentLabel={catchmentLabel}
              catchmentColor={catchmentColor}
              lastRun={lastRun?.response ?? null}
              history={!isSimulationView}
              unavailableMessage={
                yearlySummaryError && !isCatchmentScoped
                  ? `Årstallene kan ikke beregnes: ${yearlySummaryError.message}`
                  : null
              }
            />
            </div>
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
              view={view}
              onViewChange={onViewChange}
              listSlack={listSlack}
              onListSlackChange={onListSlackChange}
              listRequiredWidth={listRequiredWidth}
              onSplitAvailableChange={onSplitAvailableChange}
              list={({ width }) => (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  {rulesPanel}
                  <FarmFieldsList
                    farmId={farm.id}
                    search={fieldSearch}
                    sortedFields={sortedFields}
                    isSimulationView={isSimulationView}
                    simulationId={
                      selection.kind === 'simulation' ? selection.id : undefined
                    }
                    mode={effectiveMode}
                    lockingFieldId={lockingFieldId}
                    onToggleLock={onToggleLock}
                    onBindRotation={onBindRotation}
                    sort={fieldsSort}
                    onSortChange={setFieldsSort}
                    selectedFieldId={selectedFieldId}
                    onSelectedFieldChange={onSelectedFieldChange}
                    hoveredFieldId={hoveredFieldId}
                    onHoveredFieldChange={setHoveredFieldId}
                    highlightedCatchmentKey={effectiveHighlightedCatchmentKey}
                    catchmentLabel={catchmentLabel}
                    catchmentColor={catchmentColor}
                    onHighlightedCatchmentKeyChange={setHighlightedCatchmentKey}
                    onZoomToField={
                      effectiveView === 'list' ? undefined : requestZoomToField
                    }
                    focusRequest={rowFocusRequest ?? undefined}
                    selectedYearIndex={effectiveSelectedYearIndex}
                    paneWidth={width}
                    onRequiredWidthChange={setListRequiredWidth}
                    detachingFieldIds={detachingFieldIds}
                    onRequestDetach={
                      isSimulationView ? undefined : requestDetach
                    }
                  />
                </div>
              )}
              map={
                <FarmFieldsMap
                  key={selectionKey}
                  farm={farm}
                  fields={fields}
                  readOnly={isSimulationView}
                  isSimulationView={isSimulationView}
                  mode={effectiveMode}
                  lockingFieldId={lockingFieldId}
                  onToggleLock={onToggleLock}
                  onBindRotation={onBindRotation}
                  selectedYearIndex={
                    isSimulationView ? effectiveSelectedYearIndex : null
                  }
                  yearValues={yearValues}
                  yearValuesLoading={yearValuesLoading}
                  selectedFieldId={selectedFieldId}
                  onSelectedFieldChange={selectFieldFromMap}
                  hoveredFieldId={hoveredFieldId}
                  onHoveredFieldChange={setHoveredFieldId}
                  highlightedCatchmentKey={effectiveHighlightedCatchmentKey}
                  zoomRequest={zoomRequest ?? undefined}
                  onAddModeChange={onAddModeChange}
                  detachFields={detachFields}
                  search={effectiveView === 'map' ? fieldSearch : undefined}
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
                        isDetaching={detachingFieldIds.includes(panelField.id)}
                        onRequestDetach={() => requestDetach(panelField)}
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
      {bindField && selectedSimulationId && selectedSimulation ? (
        <ManualRotationEditor
          key={`${selectedSimulationId}:${bindField.id}`}
          farmId={farm.id}
          simulationId={selectedSimulationId}
          simulation={selectedSimulation}
          field={bindField}
          intent="lock"
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setBindFieldId(null)
          }}
          onError={onError}
        />
      ) : null}
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

const CropExclusionList = ({
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
  const { data: crops = [] } = useScenarioCropCodes(farmId, simulationId)
  if (crops.length === 0) return null

  return (
    <div className="space-y-2">
      <Label>Afgrøder</Label>
      <p className="text-xs text-muted-foreground">
        Fravælg en afgrøde for at udelukke alle sædskifter, der indeholder den
        et eller flere steder. Valget gælder kun denne kørsel.
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {crops.map((crop) => (
          <label
            key={crop.code}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!excludedCodes.has(crop.code)}
              onChange={() => onToggle(crop.code)}
            />
            <span>{crop.name}</span>
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
  const [excludedCropCodes, setExcludedCropCodes] = useState<Set<number>>(
    new Set(),
  )

  const catchments = useCatchmentOptions(farmId, fields)
  const catchmentLabelByKey = new Map(
    catchments.map((catchment) => [
      catchmentKey(catchment.catchmentId),
      catchment.label,
    ]),
  )
  const { constraints } = simulation

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRunError(null)
      setExcludedCropCodes(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleCrop = (code: number) => {
    setExcludedCropCodes((current) => {
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
        excludedCropCodes: Array.from(excludedCropCodes),
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
                  {constraints.maxNLoadByCatchment.length === 0 ? (
                    'Ingen grænse'
                  ) : (
                    <ul className="space-y-0.5">
                      {constraints.maxNLoadByCatchment.map((cap) => {
                        const key = catchmentKey(cap.catchmentId)
                        const label =
                          catchmentLabelByKey.get(key) ??
                          (cap.catchmentId === null
                            ? 'Uden kystvandopland'
                            : `Kystvandopland ${cap.catchmentId}`)
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
                <dd>{formatLimit(constraints.minFeedUnits, 'FE')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Maks. foderenheder</dt>
                <dd>{formatLimit(constraints.maxFeedUnits, 'FE')}</dd>
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
              onChange={(event) =>
                setTimeLimitSeconds(Number(event.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">
              sekunder - sæt højere hvis optimeringen ikke når at finde en
              løsning i tide på en stor bedrift
            </p>
          </div>

          <CropExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedCropCodes}
            onToggle={toggleCrop}
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
          <Button onClick={() => void runOptimization()} loading={isRunning}>
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
  const [excludedCropCodes, setExcludedCropCodes] = useState<Set<number>>(
    new Set(),
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRunError(null)
      setExcludedCropCodes(new Set())
    }
    onOpenChange(nextOpen)
  }

  const toggleCrop = (code: number) => {
    setExcludedCropCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const { data: categories = [] } = useYearlyOptimizationCandidates(
    farmId,
    simulation.id,
  )
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
    for (const category of categories) {
      for (const option of category.rotations) {
        totalShiftUnits += option.activeLen
      }
    }
    return fields.length * totalShiftUnits * 0.002
  }, [fields.length, categories])

  const runYearlyOptimization = async () => {
    const maxNLoadByCatchment: CatchmentYearlyNLoadCaps[] = catchments.map(
      (catchment) => {
        const key = catchmentKey(catchment.catchmentId)
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
        return { catchmentId: catchment.catchmentId, maxNLoadByYear }
      },
    )
    const trimmedSwing = db2SwingPct.trim()
    setIsRunning(true)
    try {
      const response = await runYearlySimulationOptimization(
        farmId,
        simulation.id,
        {
          timeLimitSeconds,
          maxNLoadByCatchment,
          db2SwingPct: trimmedSwing === '' ? null : Number(trimmedSwing),
          excludedCropCodes: Array.from(excludedCropCodes),
        },
      )
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
              onChange={(event) =>
                setTimeLimitSeconds(Number(event.target.value))
              }
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
                const key = catchmentKey(catchment.catchmentId)
                const input = catchmentInput(key)
                return (
                  <div key={key} className="space-y-2 rounded border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {catchment.label}
                      </span>
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
                            updateCatchmentInput(key, {
                              uniform: event.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          kg N, gælder hvert år
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-4">
                        {ROTATION_CALENDAR_YEARS.map((year) => (
                          <label key={year} className="space-y-1 text-sm">
                            <span className="text-xs text-muted-foreground">
                              {year}
                            </span>
                            <Input
                              type="number"
                              min="0"
                              value={input.perYear[year] ?? ''}
                              placeholder="Ingen grænse"
                              onChange={(event) =>
                                updateCatchmentInput(key, {
                                  perYear: {
                                    ...input.perYear,
                                    [year]: event.target.value,
                                  },
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
            <Label htmlFor="yearly-db-swing">
              Maks. udsving i DB2 mellem år
            </Label>
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
            Alle sædskifter kan forskydes · {fields.length} marker · ~
            {estimatedSeconds < 1 ? '<1' : Math.round(estimatedSeconds)} sek.
            (estimat, ikke en garanti)
          </p>

          <CropExclusionList
            farmId={farmId}
            simulationId={simulation.id}
            excludedCodes={excludedCropCodes}
            onToggle={toggleCrop}
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
            loading={isRunning}
          >
            {isRunning ? 'Arbejder...' : 'Kør års-optimering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
