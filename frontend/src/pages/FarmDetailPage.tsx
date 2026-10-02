import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  Link,
  Navigate,
  Route,
  Routes,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  useFarm,
  useFarmFields,
  useSimulationFields,
  useSimulations,
} from '@/api/hooks'
import type { Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import { DeleteEconomicsProfileDialog } from '@/components/farm/DeleteEconomicsProfileDialog'
import { DeleteSimulationDialog } from '@/components/farm/DeleteSimulationDialog'
import { BreakdownEconomicsContext } from '@/components/farm/economics-breakdown-context'
import {
  EconomicsProfilesContext,
  useEconomicsProfiles,
  useEconomicsProfilesStore,
} from '@/components/farm/economics-profiles-state'
import { EconomicsProfilePage } from '@/components/farm/EconomicsProfilePage'
import { FarmInspector } from '@/components/farm/FarmInspector'
import {
  FarmContentSkeleton,
  FarmSidebarSkeleton,
} from '@/components/farm/FarmLoadingShell'
import { FarmSidebar } from '@/components/farm/FarmSidebar'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { useSidebarWidth } from '@/components/farm/sidebar-width'
import { useSimulationActions } from '@/components/farm/simulation-actions'
import { SimulationComparison } from '@/components/farm/SimulationComparison'
import { SimulationOverview } from '@/components/farm/SimulationOverview'
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
import type { EconomicsProfile } from '@/lib/economics-profiles'
import { HOME_OVERVIEW_STATE, markFarmOpened } from '@/lib/onboarding'

const isSameSelection = (left: FarmViewSelection, right: FarmViewSelection) =>
  left.kind === 'simulation'
    ? right.kind === 'simulation' && left.id === right.id
    : right.kind === 'current'

const FarmDetail = () => {
  const { farmId } = useParams()
  const navigate = useNavigate()
  const onOverview = useMatch('/farms/:farmId/simulations/*') !== null
  const onProfilePage = useMatch('/farms/:farmId/economics/*') !== null
  const farmPath = `/farms/${farmId}`
  const { user } = useAuth()
  const email = user?.email ?? ''
  const economicsProfiles = useEconomicsProfiles()
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
  const [newSimulationOpen, setNewSimulationOpen] = useState(false)
  const [newSimulationSource, setNewSimulationSource] =
    useState<Simulation | null>(null)
  const openNewSimulation = (source: Simulation | null) => {
    setNewSimulationSource(source)
    setNewSimulationOpen(true)
  }
  const [simulationToDelete, setSimulationToDelete] =
    useState<Simulation | null>(null)
  const [profileToDelete, setProfileToDelete] =
    useState<EconomicsProfile | null>(null)
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

  const simulationActions = useSimulationActions({
    farmId,
    selection: activeSelection,
    onSelectionChange: changeSelection,
    onError: showErrorToast,
  })

  const leavePage = () => {
    if (onOverview || onProfilePage) navigate(farmPath)
  }

  const openView = (next: FarmViewSelection, nextMode: FarmInspectorMode) => {
    changeSelection(next)
    changeMode(nextMode)
    navigate(farmPath)
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
  const selectedProfile =
    selectedSimulationId === undefined
      ? null
      : economicsProfiles.profileForSimulation(selectedSimulationId)
  const breakdownEconomics =
    selectedProfile === null
      ? null
      : {
          assumptions: economicsProfiles.assumptions,
          overrides: selectedProfile.overrides,
          profilePath: economicsProfiles.profilePath(selectedProfile.id),
        }

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
          overviewActive={onOverview}
          loadingSelection={simulationFieldsLoading}
          onSelectionChange={(next) => {
            changeSelection(next)
            leavePage()
          }}
          mode={mode}
          onModeChange={(next) => {
            changeMode(next)
            leavePage()
          }}
          onOptimize={() => {
            setOptimizeDialogOpen(true)
            leavePage()
          }}
          view={effectiveView}
          splitAvailable={splitAvailable}
          onViewChange={(next) => {
            selectView(next)
            leavePage()
          }}
          onError={showErrorToast}
          copyingSimulationId={simulationActions.copyingSimulationId}
          deletingSimulationId={simulationActions.deletingSimulationId}
          onCopySimulation={(simulation) =>
            void simulationActions.copySimulation(simulation)
          }
          onDeleteSimulation={setSimulationToDelete}
          onNewSimulation={() => openNewSimulation(null)}
          onDeleteProfile={setProfileToDelete}
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
          <div className="fixed right-4 top-4 z-50 max-w-sm rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg">
            <p role="alert">{toast.message}</p>
          </div>
        ) : null}
        {loadedFarm ? (
          <BreakdownEconomicsContext.Provider value={breakdownEconomics}>
            <Routes>
              <Route
                index
                element={
                  <FarmInspector
                    farm={loadedFarm}
                    fields={activeFields}
                    selection={activeSelection}
                    selectedSimulation={
                      activeSelection.kind === 'simulation'
                        ? simulations.find(
                            (simulation) =>
                              simulation.id === activeSelection.id,
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
                    onEditBasis={openNewSimulation}
                    onError={showErrorToast}
                  />
                }
              />
              <Route
                path="simulations"
                element={
                  <SimulationOverview
                    farmId={loadedFarm.id}
                    fields={fields}
                    simulations={simulations}
                    selection={activeSelection}
                    copyingSimulationId={simulationActions.copyingSimulationId}
                    deletingSimulationId={
                      simulationActions.deletingSimulationId
                    }
                    onOpen={openView}
                    onCopySimulation={(simulation) =>
                      void simulationActions.copySimulation(simulation)
                    }
                    onDeleteSimulation={setSimulationToDelete}
                    onNewSimulation={() => openNewSimulation(null)}
                  />
                }
              />
              <Route
                path="simulations/compare"
                element={
                  <SimulationComparison
                    farmId={loadedFarm.id}
                    fields={fields}
                    simulations={simulations}
                  />
                }
              />
              <Route
                path="economics/:profileId"
                element={
                  <EconomicsProfilePage
                    simulations={simulations}
                    onOpenSimulation={(simulationId) =>
                      openView(
                        { kind: 'simulation', id: simulationId },
                        'values',
                      )
                    }
                    onDeleteProfile={setProfileToDelete}
                  />
                }
              />
              <Route path="*" element={<Navigate to={farmPath} replace />} />
            </Routes>
          </BreakdownEconomicsContext.Provider>
        ) : (
          <>
            <p role="status" className="sr-only">
              Indlæser bedriften.
            </p>
            <FarmContentSkeleton />
          </>
        )}
      </SidebarInset>
      {loadedFarm ? (
        <>
          <NewScenarioPanel
            farmId={loadedFarm.id}
            fields={fields}
            source={newSimulationSource}
            open={newSimulationOpen}
            onOpenChange={setNewSimulationOpen}
            onSimulationCreated={(simulation) =>
              changeSelection({ kind: 'simulation', id: simulation.id })
            }
            onError={showErrorToast}
          />
          <DeleteSimulationDialog
            simulation={simulationToDelete}
            onOpenChange={(open) => {
              if (!open) setSimulationToDelete(null)
            }}
            onConfirm={(simulationId) =>
              void simulationActions.removeSimulation(simulationId)
            }
          />
          <DeleteEconomicsProfileDialog
            profile={profileToDelete}
            simulationCount={
              profileToDelete
                ? economicsProfiles.simulationsUsingProfile(
                    simulations,
                    profileToDelete.id,
                  ).length
                : 0
            }
            onOpenChange={(open) => {
              if (!open) setProfileToDelete(null)
            }}
            onConfirm={economicsProfiles.deleteProfile}
          />
        </>
      ) : null}
    </SidebarProvider>
  )
}

export const FarmDetailPage = () => {
  const { farmId } = useParams()
  const economicsProfiles = useEconomicsProfilesStore(farmId)

  return (
    <EconomicsProfilesContext.Provider value={economicsProfiles}>
      <FarmDetail />
    </EconomicsProfilesContext.Provider>
  )
}
