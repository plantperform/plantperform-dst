import {
  Columns2,
  FlaskConical,
  History,
  List,
  Map as MapIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  useFarmHistoricalYearlySummary,
  useFieldYearValues,
  useSimulationYearlySummary,
} from '@/api/hooks'
import { updateSimulationField } from '@/api/mutations'
import type {
  Farm,
  FieldRecord,
  OptimizeSimulationResponse,
  Simulation,
} from '@/api/types'
import { CatchmentPicker } from '@/components/farm/CatchmentPicker'
import {
  fieldInCatchment,
  useCatchmentColor,
  useCatchmentLabel,
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
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { OptimizeDialog } from '@/components/farm/OptimizeDialog'
import { SimulationRulesPanel } from '@/components/farm/SimulationRulesPanel'
import { resolveEffectiveView } from '@/components/farm/split-layout'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
import { YearlyOptimizeDialog } from '@/components/farm/YearlyOptimizeDialog'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/segmented-control'
import {
  applyFieldYearValues,
  isFieldLocked,
  orderFieldsByCatchment,
  summarizeCatchmentYearTotals,
  summarizeFieldYears,
} from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'
import { useEscapeKey } from '@/hooks/use-escape-key'
import { cn } from '@/lib/utils'

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
  const [lockingFieldId, setLockingFieldId] = useState<string | null>(null)
  const [bindFieldId, setBindFieldId] = useState<string | null>(null)
  const [addModeSnap, setAddModeSnap] = useState(false)
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

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <FarmTopBar
        farm={farm}
        onError={onError}
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
