import { useCallback, useId, useMemo, useState } from 'react'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  useFarmHistoricalYearlySummary,
  useFieldYearValues,
  useSimulationYearlySummary,
} from '@/api/hooks'
import { updateSimulationField } from '@/api/mutations'
import {
  useOptimizationRun,
  useOptimizationRunActions,
} from '@/api/optimization-runs'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import { CatchmentPicker } from '@/components/farm/CatchmentPicker'
import {
  catchmentKey,
  fieldInCatchment,
  useCatchmentColor,
  useCatchmentLabel,
} from '@/components/farm/catchment-options'
import { useDetachFields } from '@/components/farm/detach-fields'
import { DetachFieldsDialog } from '@/components/farm/DetachFieldsDialog'
import { FarmFieldsList } from '@/components/farm/FarmFieldsList'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import { FarmFieldsMap } from '@/components/farm/FarmFieldsMap'
import { FarmFieldsSkeleton } from '@/components/farm/FarmFieldsSkeleton'
import { FarmSplitView } from '@/components/farm/FarmSplitView'
import { FieldDetailPanel } from '@/components/farm/FieldDetailPanel'
import { FieldSearch } from '@/components/farm/FieldSearch'
import { ManualRotationEditor } from '@/components/farm/ManualRotationEditor'
import { OptimizeDialog } from '@/components/farm/OptimizeDialog'
import { SimulationRulesPanel } from '@/components/farm/SimulationRulesPanel'
import { RULES_PANEL_WIDTH } from '@/components/farm/split-layout'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { OptimizationBanner } from '@/components/farm/OptimizationRunStatus'
import { useOverviewCollapsed } from '@/components/farm/overview-layout'
import { OverviewCollapseToggle } from '@/components/farm/OverviewCollapseToggle'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
import { LoadError } from '@/components/ui/load-error'
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

type FarmInspectorProps = {
  farm: Farm
  fields: FieldRecord[]
  selection: FarmViewSelection
  selectedSimulation?: Simulation
  fieldsLoading?: boolean
  fieldsError?: boolean
  fieldsRetrying?: boolean
  onRetryFields?: () => void
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
  onEditBasis: (simulation: Simulation) => void
  onError: (message: string | null) => void
}

export const FarmInspector = ({
  farm,
  fields,
  selection,
  selectedSimulation,
  fieldsLoading = false,
  fieldsError = false,
  fieldsRetrying = false,
  onRetryFields,
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
  onEditBasis,
  onError,
}: FarmInspectorProps) => {
  const optimizationRun = useOptimizationRun(selectedSimulation?.id)
  const { markStale } = useOptimizationRunActions()
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

  const singleCatchmentKey = useMemo(() => {
    const keys = new Set(fields.map((field) => catchmentKey(field.catchmentId)))
    return keys.size === 1 && !keys.has(catchmentKey(null))
      ? [...keys][0]
      : null
  }, [fields])
  const effectiveHighlightedCatchmentKey = useMemo(() => {
    if (singleCatchmentKey !== null || highlightedCatchmentKey === null)
      return null
    const stillPresent = fields.some((field) =>
      fieldInCatchment(field, highlightedCatchmentKey),
    )
    return stillPresent ? highlightedCatchmentKey : null
  }, [fields, singleCatchmentKey, highlightedCatchmentKey])

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
  const panelField = isRules
    ? null
    : (fields.find((field) => field.id === selectedFieldId) ?? null)
  const bindField = fields.find((field) => field.id === bindFieldId) ?? null

  const toggleFieldLock = useCallback(
    async (field: FieldRecord) => {
      if (!selectedSimulationId || field.rotationId === null) return

      const unlocking = isFieldLocked(field)
      const target = unlocking ? [] : [field.rotationId]
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
        if (unlocking) markStale(selectedSimulationId)
        onError(null)
      } catch {
        onError('Kunne ikke ændre låsningen af marken.')
      } finally {
        setLockingFieldId(null)
      }
    },
    [farm.id, selectedSimulationId, onError, markStale],
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

  const showYearWalkthrough = !fieldsError
  const {
    collapsed: overviewCollapsed,
    changeCollapsed: changeOverviewCollapsed,
  } = useOverviewCollapsed()
  const overviewId = useId()
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
      compareFields(left, right, fieldsSort, catchmentLabel),
    )
    const ordered = orderFieldsByCatchment(sorted, catchmentLabel)
    if (effectiveHighlightedCatchmentKey === null) return ordered
    const inCatchment = (field: FieldRecord) =>
      fieldInCatchment(field, effectiveHighlightedCatchmentKey)
    return [
      ...ordered.filter(inCatchment),
      ...ordered.filter((field) => !inCatchment(field)),
    ]
  }, [
    listFields,
    fieldsSort,
    catchmentLabel,
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
    : singleCatchmentKey !== null
      ? catchmentLabel(fields[0]?.catchmentId ?? null)
      : null

  const openRules = () => {
    onOptimizeDialogOpenChange(false)
    onModeChange('rules')
  }

  const rulesPanel =
    isRules && selectedSimulation && !fieldsLoading ? (
      <div className="pr-4">
        <SimulationRulesPanel
          key={selectedSimulation.id}
          farmId={farm.id}
          simulation={selectedSimulation}
          fields={fields}
          lockingFieldId={lockingFieldId}
          hoveredFieldId={hoveredFieldId}
          focusRequest={rowFocusRequest ?? undefined}
          onHoveredFieldChange={setHoveredFieldId}
          onToggleLock={onToggleLock}
          onBindRotation={onBindRotation}
          onEditBasis={onEditBasis}
        />
      </div>
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
          onOpenRules={openRules}
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
          {isSimulationView && selectedSimulation ? (
            <OptimizationBanner
              farmId={farm.id}
              simulationId={selectedSimulation.id}
              run={optimizationRun}
              fields={fieldsLoading || fieldsError ? undefined : fields}
            />
          ) : null}
          {showYearWalkthrough ? (
            <>
            <div id={overviewId} className="flex flex-wrap gap-3">
              {!overviewCollapsed &&
              !fieldsLoading &&
              fields.length > 0 &&
              singleCatchmentKey === null ? (
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
                (!isCatchmentScoped &&
                  (yearlySummaryLoading ||
                    (optimizationRun?.status === 'succeeded' &&
                      optimizationRun.refreshing)))
              }
              fields={highlightedFields}
              scopeLabel={scopeLabel}
              splitPanels={singleCatchmentKey !== null}
              collapsed={overviewCollapsed}
              catchmentTotalsByYear={catchmentTotalsByYear}
              yearValues={yearValues}
              selectedYearIndex={selectedYearIndex}
              onSelectedYearIndexChange={onSelectedYearIndexChange}
              catchmentLabel={catchmentLabel}
              catchmentColor={catchmentColor}
              lastRun={
                optimizationRun?.status === 'succeeded'
                  ? optimizationRun.response
                  : null
              }
              history={!isSimulationView}
              unavailableMessage={
                yearlySummaryError && !isCatchmentScoped
                  ? `Årstallene kan ikke beregnes: ${yearlySummaryError.message}`
                  : null
              }
            />
            </div>
            <OverviewCollapseToggle
              collapsed={overviewCollapsed}
              onCollapsedChange={changeOverviewCollapsed}
              controls={overviewId}
            />
            </>
          ) : null}
          {fieldsLoading ? (
            <FarmFieldsSkeleton message={loadingMessage} />
          ) : fieldsError ? (
            <LoadError
              message="Kunne ikke hente simuleringens marker."
              onRetry={onRetryFields}
              retrying={fieldsRetrying}
            />
          ) : (
            <FarmSplitView
              view={view}
              onViewChange={onViewChange}
              listSlack={listSlack}
              onListSlackChange={onListSlackChange}
              listRequiredWidth={
                isRules ? RULES_PANEL_WIDTH : listRequiredWidth
              }
              onSplitAvailableChange={onSplitAvailableChange}
              list={({ width }) =>
                rulesPanel ?? (
                  <FarmFieldsList
                    farmId={farm.id}
                    search={fieldSearch}
                    sortedFields={sortedFields}
                    isSimulationView={isSimulationView}
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
                    selectedYearIndex={effectiveSelectedYearIndex}
                    paneWidth={width}
                    onRequiredWidthChange={setListRequiredWidth}
                    detachingFieldIds={detachingFieldIds}
                    onRequestDetach={
                      isSimulationView ? undefined : requestDetach
                    }
                  />
                )
              }
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
                        yearValuesLoading={yearValuesLoading}
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
