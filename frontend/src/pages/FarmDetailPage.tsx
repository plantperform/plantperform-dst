import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  useFarm,
  useFarmFields,
  useSimulationFields,
  useSimulations,
} from '@/api/hooks'
import { useAuth } from '@/auth/context'
import { FarmInspector } from '@/components/farm/FarmInspector'
import {
  FarmContentSkeleton,
  FarmSidebarSkeleton,
} from '@/components/farm/FarmLoadingShell'
import { FarmSidebar } from '@/components/farm/FarmSidebar'
import { useSidebarWidth } from '@/components/farm/sidebar-width'
import {
  resolveEffectiveView,
  useSplitLayout,
} from '@/components/farm/split-layout'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { Button } from '@/components/ui/button'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LoadError } from '@/components/ui/load-error'
import { HOME_OVERVIEW_STATE, markFarmOpened } from '@/lib/onboarding'

const isSameSelection = (left: FarmViewSelection, right: FarmViewSelection) =>
  left.kind === 'simulation'
    ? right.kind === 'simulation' && left.id === right.id
    : right.kind === 'current'

export const FarmDetailPage = () => {
  const { farmId } = useParams()
  const { user } = useAuth()
  const email = user?.email ?? ''
  const {
    data: farm,
    error: farmError,
    isLoading: farmLoading,
    isValidating: farmValidating,
    mutate: retryFarm,
  } = useFarm(farmId)
  const {
    data: fieldsData,
    error: fieldsError,
    isLoading: fieldsLoading,
    isValidating: fieldsValidating,
    mutate: retryFields,
  } = useFarmFields(farmId)
  const {
    data: simulationsData,
    error: simulationsError,
    isLoading: simulationsLoading,
    isValidating: simulationsValidating,
    mutate: retrySimulations,
  } = useSimulations(farmId)
  const fields = fieldsData ?? []
  const simulations = simulationsData ?? []
  const [selection, setSelection] = useState<FarmViewSelection>({
    kind: 'current',
  })
  const activeSelection =
    selection.kind === 'simulation' &&
    simulationsData &&
    !simulations.some((simulation) => simulation.id === selection.id)
      ? ({ kind: 'current' } as const)
      : selection
  const selectedSimulationId =
    activeSelection.kind === 'simulation' ? activeSelection.id : undefined
  const {
    data: simulationFieldsData,
    error: simulationFieldsError,
    isLoading: simulationFieldsLoading,
    isValidating: simulationFieldsValidating,
    mutate: retrySimulationFields,
  } = useSimulationFields(farmId, selectedSimulationId)
  const simulationFields = simulationFieldsData ?? []
  const [mode, setMode] = useState<FarmInspectorMode>('values')
  const { view, changeView, listSlack, changeListSlack } = useSplitLayout()
  const [splitAvailable, setSplitAvailable] = useState(true)
  const [addModeSnap, setAddModeSnap] = useState(false)
  const snappedView: FarmView = addModeSnap ? 'map' : view
  const effectiveView = resolveEffectiveView(snappedView, splitAvailable)
  const selectView = (next: FarmView) => {
    setAddModeSnap(false)
    changeView(next)
  }
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [selectedYearIndex, setSelectedYearIndex] = useState<number | null>(
    null,
  )
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false)
  const [yearlyOptimizeDialogOpen, setYearlyOptimizeDialogOpen] =
    useState(false)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  )
  const toastTimeoutRef = useRef<number | null>(null)
  const { width: sidebarWidth, changeWidth: setSidebarWidth } =
    useSidebarWidth()
  const notFound = farmError instanceof ApiError && farmError.status === 404
  const farmFailed = Boolean(farmError) && farm === undefined
  const fieldsFailed = Boolean(fieldsError) && fieldsData === undefined
  const simulationsFailed =
    Boolean(simulationsError) && simulationsData === undefined
  const loadFailed = farmFailed || fieldsFailed || simulationsFailed
  const loadFailedMessage = farmFailed
    ? 'Kunne ikke hente bedriften.'
    : fieldsFailed
      ? 'Kunne ikke hente bedriftens marker.'
      : 'Kunne ikke hente bedriftens simuleringer.'
  const retryingLoad =
    (farmFailed && farmValidating) ||
    (fieldsFailed && fieldsValidating) ||
    (simulationsFailed && simulationsValidating)
  const retryLoad = () => {
    if (farmFailed) void retryFarm()
    if (fieldsFailed) void retryFields()
    if (simulationsFailed) void retrySimulations()
  }
  const isReady =
    farm !== undefined &&
    !farmLoading &&
    !fieldsLoading &&
    !simulationsLoading
  const activeFields =
    activeSelection.kind === 'current' ? fields : simulationFields
  const activeFieldsLoading =
    activeSelection.kind === 'simulation' && simulationFieldsLoading

  if (
    selectedFieldId !== null &&
    !activeFieldsLoading &&
    !activeFields.some((field) => field.id === selectedFieldId)
  ) {
    setSelectedFieldId(null)
  }

  if (selection.kind === 'simulation' && activeSelection.kind === 'current') {
    setSelection({ kind: 'current' })
    setSelectedYearIndex(null)
  }

  const loadedFarmId = farm?.id

  useEffect(() => {
    if (email && loadedFarmId) {
      markFarmOpened(email, loadedFarmId)
    }
  }, [email, loadedFarmId])

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    },
    [],
  )

  const showErrorToast = (message: string | null) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current)
    }

    if (!message) {
      setToast(null)
      return
    }

    const toastId = Date.now()
    setToast({ id: toastId, message })
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === toastId ? null : current))
      toastTimeoutRef.current = null
    }, 4000)
  }

  const changeSelection = (next: FarmViewSelection) => {
    setSelection(next)
    if (!isSameSelection(next, activeSelection)) {
      setSelectedFieldId(null)
      setSelectedYearIndex(null)
    }
  }

  const changeMode = (next: FarmInspectorMode) => {
    setMode(next)
    if (next !== mode) setSelectedFieldId(null)
    // Regler only renders in the list pane, so switch away from a pure map
    // view - otherwise the mode changes but nothing visible opens.
    if (next === 'rules' && effectiveView === 'map') selectView('split')
  }

  const selectFieldFromSearch = (fieldId: string) => {
    if (!activeFields.some((field) => field.id === fieldId)) return
    setSelectedFieldId(fieldId)
    if (mode === 'rules') setMode('values')
  }

  if (notFound || loadFailed) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>
                {notFound
                  ? 'Bedriften blev ikke fundet'
                  : 'Bedriften kunne ikke hentes'}
              </CardTitle>
              <CardDescription>
                {notFound
                  ? 'Den valgte bedrift findes ikke.'
                  : 'Der opstod en fejl, da bedriften skulle hentes.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {notFound ? null : (
                <LoadError
                  message={loadFailedMessage}
                  onRetry={retryLoad}
                  retrying={retryingLoad}
                />
              )}
              <Button asChild variant={notFound ? 'default' : 'outline'}>
                <Link to="/" state={HOME_OVERVIEW_STATE}>
                  Alle bedrifter
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const loadedFarm = isReady ? farm : undefined

  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {loadedFarm ? (
        <FarmSidebar
          farm={loadedFarm}
          fields={fields}
          simulations={simulations}
          selection={activeSelection}
          loadingSelection={simulationFieldsLoading}
          onSelectionChange={changeSelection}
          mode={mode}
          onModeChange={changeMode}
          onOptimize={() => setOptimizeDialogOpen(true)}
          onYearlyOptimize={() => setYearlyOptimizeDialogOpen(true)}
          view={effectiveView}
          splitAvailable={splitAvailable}
          onViewChange={selectView}
          onError={showErrorToast}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        />
      ) : (
        <FarmSidebarSkeleton farm={farm} onError={showErrorToast} />
      )}
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <SidebarTrigger
          className="fixed top-2 left-2 z-30 size-8 border bg-background shadow-sm md:hidden"
          aria-label="Vis eller skjul sidepanelet"
        />
        {toast ? (
          <div className="fixed right-4 top-4 z-50 max-w-sm rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
            <p role="alert">{toast.message}</p>
          </div>
        ) : null}
        {loadedFarm ? (
          <FarmInspector
            farm={loadedFarm}
            fields={activeFields}
            selection={activeSelection}
            selectedSimulation={
              activeSelection.kind === 'simulation'
                ? simulations.find(
                    (simulation) => simulation.id === activeSelection.id,
                  )
                : undefined
            }
            fieldsLoading={simulationFieldsLoading}
            fieldsError={
              Boolean(simulationFieldsError) &&
              simulationFieldsData === undefined
            }
            fieldsRetrying={simulationFieldsValidating}
            onRetryFields={() => void retrySimulationFields()}
            mode={mode}
            onModeChange={changeMode}
            view={snappedView}
            effectiveView={effectiveView}
            onViewChange={selectView}
            onSplitAvailableChange={setSplitAvailable}
            onAddModeChange={setAddModeSnap}
            listSlack={listSlack}
            onListSlackChange={changeListSlack}
            selectedFieldId={selectedFieldId}
            onSelectedFieldChange={setSelectedFieldId}
            onSelectField={selectFieldFromSearch}
            selectedYearIndex={selectedYearIndex}
            onSelectedYearIndexChange={setSelectedYearIndex}
            optimizeDialogOpen={optimizeDialogOpen}
            onOptimizeDialogOpenChange={setOptimizeDialogOpen}
            yearlyOptimizeDialogOpen={yearlyOptimizeDialogOpen}
            onYearlyOptimizeDialogOpenChange={setYearlyOptimizeDialogOpen}
            onError={showErrorToast}
          />
        ) : (
          <>
            <p role="status" className="sr-only">
              Indlæser bedriften.
            </p>
            <FarmContentSkeleton />
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
