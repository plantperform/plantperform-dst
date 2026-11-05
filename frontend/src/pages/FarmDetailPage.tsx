import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
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
  useFarmView,
  useFarmFields,
  useSimulationFields,
  useSimulations,
} from '@/api/hooks'
import type { Simulation } from '@/api/types'
import { retryFarmHistory } from '@/api/mutations'
import { useAuth } from '@/auth/context'
import { AppBar } from '@/components/AppBar'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { useToast } from '@/components/toast'
import {
  calculationReturnState,
  type ReturnTarget,
} from '@/components/farm/economics-navigation'
import {
  EconomicsProfilesContext,
  useEconomicsProfiles,
  useEconomicsProfilesStore,
} from '@/components/farm/economics-profiles-state'
import { EconomicsGuidePage } from '@/components/farm/EconomicsGuidePage'
import { EconomicsOverview } from '@/components/farm/EconomicsOverview'
import { EconomicsProfilePage } from '@/components/farm/EconomicsProfilePage'
import { FarmAboutPage } from '@/components/farm/FarmAboutPage'
import { FarmInspector } from '@/components/farm/FarmInspector'
import {
  FarmContentSkeleton,
  FarmSidebarSkeleton,
} from '@/components/farm/FarmLoadingShell'
import { FarmSidebar, ShowSidebarButton } from '@/components/farm/FarmSidebar'
import { FarmSwitcher } from '@/components/farm/FarmSwitcher'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { useSidebarWidth } from '@/components/farm/sidebar-width'
import { useSimulationActions } from '@/components/farm/simulation-actions'
import { SimulationComparison } from '@/components/farm/SimulationComparison'
import { SimulationCreationStatus } from '@/components/farm/SimulationCreationStatus'
import { withoutCalculation } from '@/lib/field-domain'
import { isSimulationReady } from '@/lib/simulation-creation'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  deleteProfileMessage,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { HOME_OVERVIEW_STATE, markFarmOpened } from '@/lib/onboarding'

const isSameSelection = (left: FarmViewSelection, right: FarmViewSelection) =>
  left.kind === 'simulation'
    ? right.kind === 'simulation' && left.id === right.id
    : right.kind === 'current'

const FarmDetail = () => {
  const { farmId } = useParams()
  const navigate = useNavigate()
  const onOverview = useMatch('/farms/:farmId/simulations/*') !== null
  const onEconomicsPage = useMatch('/farms/:farmId/economics/*') !== null
  const onAboutPage = useMatch('/farms/:farmId/about') !== null
  const { showToast, showError } = useToast()
  const farmPath = `/farms/${farmId}`
  const { user } = useAuth()
  const farmView = useFarmView(farmId)
  const [retryingHistory, setRetryingHistory] = useState(false)
  const email = user?.email ?? ''
  const economics = useEconomicsProfiles()
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
  const selectedSimulation = simulations.find(
    (simulation) => simulation.id === selectedSimulationId,
  )
  const {
    data: simulationFieldsData,
    error: simulationFieldsError,
    isLoading: simulationFieldsLoading,
    isValidating: simulationFieldsValidating,
    mutate: retrySimulationFields,
    summaryMissing: simulationSummaryMissing,
  } = useSimulationFields(
    farmId,
    selectedSimulationId,
    Boolean(selectedSimulation && isSimulationReady(selectedSimulation)),
  )
  const simulationFields = simulationFieldsData ?? []
  // A saved simulation that has not been optimized has no field snapshot yet,
  // and its view is either missing or empty; show the farm's marker instead of
  // an empty page.
  const hasNoFieldSnapshot =
    selectedSimulation?.fieldsInitialized === false &&
    (simulationSummaryMissing || simulationFields.length === 0)
  const unoptimizedSimulationFields = useMemo(
    () => (hasNoFieldSnapshot ? withoutCalculation(fieldsData ?? []) : null),
    [hasNoFieldSnapshot, fieldsData],
  )
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
    farm !== undefined && !farmLoading && !fieldsLoading && !simulationsLoading
  const activeFields =
    activeSelection.kind === 'current'
      ? fields
      : (unoptimizedSimulationFields ?? simulationFields)
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

  const changeSelection = (next: FarmViewSelection) => {
    setSelection(next)
    if (!isSameSelection(next, activeSelection)) {
      setSelectedFieldId(null)
      setSelectedYearIndex(null)
    }
  }

  const recalculateHistory = async () => {
    if (!farmId || retryingHistory) return
    setRetryingHistory(true)
    try {
      const next = await retryFarmHistory(farmId)
      await farmView.mutate(next, { revalidate: next.status === 'done' })
    } catch {
      showError('Kunne ikke starte beregningen.')
    }
    setRetryingHistory(false)
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
    onError: showError,
  })

  const leavePage = () => {
    if (onOverview || onEconomicsPage || onAboutPage) navigate(farmPath)
  }

  const openView = (next: FarmViewSelection, nextMode: FarmInspectorMode) => {
    changeSelection(next)
    changeMode(nextMode)
    navigate(farmPath)
  }

  const returnFromProfile = (target: ReturnTarget) => {
    if (target.kind === 'overview') {
      navigate(`${farmPath}/simulations`)
    } else if (target.kind === 'compare') {
      navigate({
        pathname: `${farmPath}/simulations/compare`,
        search: target.search,
      })
    } else {
      changeSelection(
        target.simulationId === null
          ? { kind: 'current' }
          : { kind: 'simulation', id: target.simulationId },
      )
      setMode('values')
      if (target.kind === 'field') setSelectedFieldId(target.fieldId)
      navigate(farmPath, { state: calculationReturnState(target) })
    }
  }

  if (notFound || loadFailed) {
    return (
      <main className="min-h-screen bg-background">
        <AppBar />
        <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
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

  const appBar = (
    <AppBar>
      {farm ? (
        <FarmSwitcher
          farm={farm}
          samePage={
            onEconomicsPage ? '/economics' : onAboutPage ? '/about' : ''
          }
        />
      ) : (
        <Skeleton className="h-8 w-40 rounded-lg bg-brand-foreground/20" />
      )}
    </AppBar>
  )

  if (farmView.data && farmView.data.status !== 'done') {
    const failed = farmView.data.status === 'failed'
    return (
      <main className="min-h-screen bg-background">
        {appBar}
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-10 sm:px-10">
          <h1 className="font-display text-4xl tracking-tight break-words">
            {farm?.name}
          </h1>
          <div className="space-y-3 rounded-lg border border-dashed p-4">
            {failed ? (
              <>
                <p role="alert" className="text-sm text-destructive">
                  Markernes historik kunne ikke beregnes.
                </p>
                {farmId ? (
                  <Button
                    size="sm"
                    loading={retryingHistory}
                    onClick={() => void recalculateHistory()}
                  >
                    Prøv igen
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <p
                  role="status"
                  className="flex items-center gap-2 font-medium"
                >
                  <Spinner />
                  Beregner markernes historik...
                </p>
                <p className="text-sm text-muted-foreground">
                  Du kan lukke siden. Beregningen fortsætter, og markernes tal
                  vises her, når den er færdig.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    )
  }

  return (
    <SidebarProvider
      className="h-svh flex-col overflow-hidden"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {appBar}
      <div className="flex min-h-0 flex-1">
        {loadedFarm ? (
          <FarmSidebar
            farm={loadedFarm}
            fields={fields}
            simulations={simulations}
            selection={activeSelection}
            overviewActive={onOverview}
            economicsPageActive={onEconomicsPage}
            aboutActive={onAboutPage}
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
            copyingSimulationId={simulationActions.copyingSimulationId}
            deletingSimulationId={simulationActions.deletingSimulationId}
            onCopySimulation={(simulation) =>
              void simulationActions.copySimulation(simulation)
            }
            onDeleteSimulation={setSimulationToDelete}
            onNewSimulation={() => openNewSimulation(null)}
            onRecalculateHistory={() => void recalculateHistory()}
            recalculatingHistory={retryingHistory}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
        ) : (
          <FarmSidebarSkeleton />
        )}
        <SidebarInset className="min-w-0 overflow-x-hidden md:peer-data-[state=collapsed]:pl-14">
          <SidebarTrigger
            className="fixed top-14 left-2 z-30 size-8 border bg-background shadow-sm md:hidden"
            aria-label="Vis eller skjul sidepanelet"
          />
          <ShowSidebarButton />
          {loadedFarm ? (
            <Routes>
              <Route
                index
                element={selectedSimulation && !isSimulationReady(selectedSimulation) ? (
                  <div className="mx-auto w-full max-w-3xl space-y-4 p-8">
                    <h1 className="font-display text-4xl tracking-tight">{selectedSimulation.name}</h1>
                    <SimulationCreationStatus farmId={loadedFarm.id} simulation={selectedSimulation} />
                    <Button variant="outline" onClick={() => setSimulationToDelete(selectedSimulation)}>
                      Slet simulering
                    </Button>
                  </div>
                ) : (
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
                    simulations={simulations}
                    fieldsLoading={simulationFieldsLoading}
                    summaryMissing={
                      simulationSummaryMissing || hasNoFieldSnapshot
                    }
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
                    onError={showError}
                  />
                )}
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
                path="economics"
                element={
                  <EconomicsOverview
                    farmName={loadedFarm.name}
                    simulations={simulations}
                    onDeleteProfile={setProfileToDelete}
                  />
                }
              />
              <Route
                path="economics/:profileId"
                element={
                  <EconomicsProfilePage
                    farmName={loadedFarm.name}
                    simulations={simulations}
                    onOpenSimulation={(simulationId) =>
                      openView(
                        { kind: 'simulation', id: simulationId },
                        'values',
                      )
                    }
                    onDeleteProfile={setProfileToDelete}
                    onReturn={returnFromProfile}
                  />
                }
              />
              <Route
                path="economics/:profileId/guide"
                element={
                  <EconomicsGuidePage
                    farmName={loadedFarm.name}
                    simulations={simulations}
                    onOpenSimulation={(simulationId) =>
                      openView(
                        { kind: 'simulation', id: simulationId },
                        'values',
                      )
                    }
                  />
                }
              />
              <Route
                path="about"
                element={
                  <FarmAboutPage
                    key={loadedFarm.id}
                    farm={loadedFarm}
                    simulations={simulations}
                  />
                }
              />
              <Route path="*" element={<Navigate to={farmPath} replace />} />
            </Routes>
          ) : (
            <>
              <p role="status" className="sr-only">
                Indlæser bedriften.
              </p>
              <FarmContentSkeleton />
            </>
          )}
        </SidebarInset>
      </div>
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
            onError={showError}
          />
          <ConfirmDialog
            name={simulationToDelete?.name ?? null}
            description="Simuleringen og dens ændringer på markerne slettes. Afgrødehistorikken og økonomiprofilerne berøres ikke."
            confirmLabel="Slet simulering"
            onOpenChange={(open) => {
              if (!open) setSimulationToDelete(null)
            }}
            onConfirm={() => {
              if (simulationToDelete) {
                void simulationActions.removeSimulation(simulationToDelete.id)
              }
            }}
          />
          <ConfirmDialog
            name={profileToDelete?.name ?? null}
            description={deleteProfileMessage(
              profileToDelete
                ? economics
                    .simulationsUsingProfile(simulations, profileToDelete.id)
                    .map((simulation) => simulation.name)
                : [],
            )}
            confirmLabel="Slet profil"
            onOpenChange={(open) => {
              if (!open) setProfileToDelete(null)
            }}
            onConfirm={() => {
              if (!profileToDelete) return
              void economics
                .deleteProfile(profileToDelete.id)
                .then((deleted) => {
                  if (deleted) showToast(`${profileToDelete.name} er slettet`)
                })
            }}
          />
        </>
      ) : null}
    </SidebarProvider>
  )
}

export const FarmDetailPage = () => {
  const { farmId } = useParams()
  const economics = useEconomicsProfilesStore(farmId)

  return (
    <EconomicsProfilesContext.Provider value={economics}>
      <FarmDetail />
    </EconomicsProfilesContext.Provider>
  )
}
