import {
  creationStatusLabel,
  isSimulationCreating,
  isSimulationReady,
} from '@/lib/simulation-creation'
import {
  ChevronRight,
  Coins,
  Copy,
  FlaskConical,
  History,
  Info,
  MoreVertical,
  RefreshCw,
  PanelLeft,
  Play,
  Plus,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router-dom'

import { useFarmMembers, useSimulationFields } from '@/api/hooks'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import {
  useOptimizationRun,
  type OptimizationRun,
} from '@/api/optimization-runs'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { useFieldSetChanges } from '@/components/farm/field-set-changes'
import { useOptimizationRunRetry } from '@/components/farm/optimization-run-retry'
import { OptimizationRunElapsed } from '@/components/farm/OptimizationRunStatus'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { ViewModeSwitch } from '@/components/farm/ViewModeSwitch'
import { AppTooltip } from '@/components/ui/app-tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useStoredFlag } from '@/hooks/use-stored-flag'
import {
  describeAppliedProfile,
  describeOwnProfiles,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'
import { describeFarmAccess, otherMemberEmails } from '@/lib/farm-access'
import {
  changedFieldIds,
  describeSeparateQuotas,
  formatCompactDkk,
  formatFieldCount,
  formatQuotaAmount,
  formatWholeNumber,
  isFieldLocked,
  perHaFigure,
  QUOTA_STATUS_STYLES,
  resolveFarmQuota,
  totalsPerHa,
  type FarmQuota,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import { optimizationRunName } from '@/lib/optimization-run'
import { formatCreatedAt } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

type ViewKeyFigures = {
  level: QuotaStatusLevel
  label: string
  title: string
}

const describeKeyFigures = (
  quota: FarmQuota,
  isSimulationView: boolean,
): ViewKeyFigures => {
  const { totals, level, quotaKgN } = quota

  if (totals.calculatedCount === 0) {
    return {
      level,
      label: `Ikke beregnet · ${formatFieldCount(totals.fieldCount)}`,
      title: isSimulationView
        ? `Kør Optimér for at beregne markerne (${formatFieldCount(totals.fieldCount)})`
        : `Ingen marker er beregnet endnu (${formatFieldCount(totals.fieldCount)})`,
    }
  }

  const emission = perHaFigure(
    totalsPerHa(totals, 'nLoad'),
    'nLoad',
    `${formatWholeNumber(totals.nLoad)} kg N`,
  ).value
  const fullEmission = formatQuotaAmount(totals.nLoad, quotaKgN ?? 0)
  const quotaNote =
    quotaKgN === null ? `, ${describeSeparateQuotas(quota)}` : ''
  const emissionTitle = `Udledning ${fullEmission} pr. gennemsnitsår${quotaNote}`

  if (!isSimulationView) return { level, label: emission, title: emissionTitle }

  const earnings = perHaFigure(
    totalsPerHa(totals, 'db2'),
    'db2',
    formatCompactDkk(totals.db2),
  ).value
  return {
    level,
    label: `${emission} · ${earnings}`,
    title: `${emissionTitle}, DB2 ${formatWholeNumber(totals.db2)} kr`,
  }
}

export const FARM_SIDEBAR_CLASS = 'top-12 h-[calc(100svh-3rem)]!'

export const GROUP_CLASS = 'px-3 py-0'

export const GROUP_LABEL_CLASS =
  'h-auto px-2 pt-4 pb-2 text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase'

const VIEW_BUTTON_CLASS =
  'h-auto min-h-0 items-start gap-2.5 rounded-[10px] p-2.5 text-[15px] data-[active=true]:font-normal [&>svg]:mt-0.5 [&>svg]:size-[18px]'

const SUB_BUTTON_CLASS =
  'h-auto min-h-0 rounded-lg px-2.5 py-2 text-[15px] data-[active=true]:font-normal'

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  overviewActive: boolean
  economicsPageActive: boolean
  aboutActive: boolean
  loadingSelection?: boolean
  onSelectionChange: (selection: FarmViewSelection) => void
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  view: FarmView
  splitAvailable: boolean
  onViewChange: (view: FarmView) => void
  copyingSimulationId: string | null
  deletingSimulationId: string | null
  onCopySimulation: (simulation: Simulation) => void
  onDeleteSimulation: (simulation: Simulation) => void
  onNewSimulation: () => void
  onRecalculateHistory: () => void
  recalculatingHistory: boolean
  width: number
  onWidthChange: (width: number) => void
}

export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  overviewActive,
  economicsPageActive,
  aboutActive,
  loadingSelection = false,
  onSelectionChange,
  mode,
  onModeChange,
  onOptimize,
  view,
  splitAvailable,
  onViewChange,
  copyingSimulationId,
  deletingSimulationId,
  onCopySimulation,
  onDeleteSimulation,
  onNewSimulation,
  onRecalculateHistory,
  recalculatingHistory,
  width,
  onWidthChange,
}: FarmSidebarProps) => {
  const historyFigures = describeKeyFigures(
    resolveFarmQuota(fields, false),
    false,
  )
  const [simulationsOpen, setSimulationsOpen] = useState(true)
  const simulationListId = useId()
  const [farmGroupMinimized, setFarmGroupMinimized] = useStoredFlag(
    'plantperform.farmGroupMinimized',
  )
  const farmGroupOpen = !farmGroupMinimized
  const farmGroupId = useId()
  const showEconomics = farmGroupOpen || economicsPageActive
  const showAbout = farmGroupOpen || aboutActive
  const pageActive = overviewActive || economicsPageActive || aboutActive
  const { user } = useAuth()
  const { data: members } = useFarmMembers(farm.id)
  const economics = useEconomicsProfiles()
  const historyActive = !pageActive && selection.kind === 'current'
  const selectedSimulationId =
    !pageActive && selection.kind === 'simulation' ? selection.id : null
  const compareActive = useMatch('/farms/:farmId/simulations/compare') !== null
  const simulationPages = [
    {
      to: `/farms/${farm.id}/simulations`,
      label: 'Oversigt',
      active: overviewActive && !compareActive,
    },
    {
      to: `/farms/${farm.id}/simulations/compare`,
      label: 'Sammenlign',
      active: compareActive,
    },
  ]

  return (
    <Sidebar
      className={FARM_SIDEBAR_CLASS}
      aria-label="Navigation for bedriften"
    >
      <SidebarContent className="gap-0 pt-0.5">
        <SidebarGroup className={GROUP_CLASS}>
          <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
            Visninger
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={historyActive}
                  aria-current={historyActive ? 'page' : undefined}
                  className={VIEW_BUTTON_CLASS}
                  onClick={() => onSelectionChange({ kind: 'current' })}
                >
                  <History />
                  <ViewMenuLabel name="Afgrødehistorik">
                    <KeyFiguresLine figures={historyFigures} />
                  </ViewMenuLabel>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction
                      aria-label="Handlinger for afgrødehistorik"
                      disabled={recalculatingHistory}
                    >
                      <MoreVertical />
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem
                      disabled={recalculatingHistory}
                      onSelect={onRecalculateHistory}
                    >
                      <RefreshCw />
                      Genberegn historik
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-expanded={simulationsOpen}
                  aria-controls={simulationListId}
                  className="h-auto gap-2.5 rounded-[10px] px-2.5 pt-2.5 pb-1.5 text-[15px] [&>svg:first-child]:size-[18px]"
                  onClick={() => setSimulationsOpen((open) => !open)}
                >
                  <FlaskConical />
                  <span>Simuleringer</span>
                  <ChevronRight
                    className={cn(
                      'ml-auto motion-safe:transition-transform',
                      simulationsOpen && 'rotate-90',
                    )}
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <li id={simulationListId}>
                <SidebarMenu className="w-auto gap-0.5 pl-7">
                  {simulationPages.map(({ to, label, active }) =>
                    simulations.length > 0 && simulationsOpen ? (
                      <SidebarMenuItem key={to}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          className={SUB_BUTTON_CLASS}
                        >
                          <NavLink to={to} end>
                            <span>{label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : null,
                  )}
                  {simulations.map((simulation) => {
                    const selected = simulation.id === selectedSimulationId
                    return (
                      <SimulationMenuItem
                        key={simulation.id}
                        farmId={farm.id}
                        simulation={simulation}
                        liveFields={fields}
                        selected={selected}
                        folded={!simulationsOpen}
                        loading={loadingSelection && selected}
                        deleting={deletingSimulationId === simulation.id}
                        copying={copyingSimulationId === simulation.id}
                        mode={mode}
                        onModeChange={onModeChange}
                        onOptimize={onOptimize}
                        onSelect={() =>
                          onSelectionChange({
                            kind: 'simulation',
                            id: simulation.id,
                          })
                        }
                        onCopy={() => onCopySimulation(simulation)}
                        onDelete={() => onDeleteSimulation(simulation)}
                      />
                    )
                  })}
                  {simulationsOpen ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className={cn(
                          SUB_BUTTON_CLASS,
                          'text-primary hover:text-primary',
                        )}
                        onClick={onNewSimulation}
                      >
                        <Plus />
                        <span>Ny simulering</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </li>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {pageActive ? null : (
        <SidebarGroup className={GROUP_CLASS}>
          <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
            Vis som
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <ViewModeSwitch
              view={view}
              splitAvailable={splitAvailable}
              onViewChange={onViewChange}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarGroup className={GROUP_CLASS}>
        <SidebarGroupLabel
          asChild
          className={cn(GROUP_LABEL_CLASS, 'w-full hover:text-foreground')}
        >
          <button
            type="button"
            aria-expanded={farmGroupOpen}
            aria-controls={farmGroupId}
            onClick={() => setFarmGroupMinimized(farmGroupOpen)}
          >
            Bedriften
            <ChevronRight
              className={cn(
                'ml-auto motion-safe:transition-transform',
                farmGroupOpen && 'rotate-90',
              )}
              aria-hidden="true"
            />
          </button>
        </SidebarGroupLabel>
        <SidebarGroupContent id={farmGroupId}>
          {showEconomics || showAbout ? (
            <SidebarMenu>
              {showEconomics ? (
                <PageMenuItem
                  to={economics.overviewPath}
                  active={economicsPageActive}
                  name="Økonomi"
                  icon={<Coins />}
                >
                  {economics.ownProfiles
                    ? describeOwnProfiles(
                        economics.ownProfiles.map((profile) => profile.name),
                      )
                    : null}
                </PageMenuItem>
              ) : null}
              {showAbout ? (
                <PageMenuItem
                  to={`/farms/${farm.id}/about`}
                  active={aboutActive}
                  name="Om bedriften"
                  icon={<Info />}
                >
                  {members
                    ? describeFarmAccess(
                        otherMemberEmails(members, user?.email ?? ''),
                      )
                    : null}
                </PageMenuItem>
              ) : null}
            </SidebarMenu>
          ) : null}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarFooter className="px-3 pt-1 pb-3">
        <CollapseMenuButton />
      </SidebarFooter>

      <SidebarWidthHandle width={width} onWidthChange={onWidthChange} />
    </Sidebar>
  )
}

export const ShowSidebarButton = () => {
  const { state, isMobile } = useSidebar()
  if (isMobile || state === 'expanded') return null

  return (
    <SidebarTrigger
      aria-label="Vis sidepanel"
      className="absolute top-3 left-3 z-20 size-9 rounded-lg border bg-card text-muted-foreground"
    />
  )
}

const CollapseMenuButton = () => {
  const { toggleSidebar } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="h-auto gap-2 px-2.5 py-2 text-[13px] text-muted-foreground"
          onClick={toggleSidebar}
        >
          <PanelLeft />
          <span>Skjul sidepanel</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

type PageMenuItemProps = {
  to: string
  active: boolean
  name: string
  icon: ReactNode
  children: ReactNode
}

const PageMenuItem = ({
  to,
  active,
  name,
  icon,
  children,
}: PageMenuItemProps) => (
  <SidebarMenuItem>
    <SidebarMenuButton
      asChild
      size="lg"
      isActive={active}
      className={VIEW_BUTTON_CLASS}
    >
      <NavLink to={to}>
        {icon}
        <ViewMenuLabel name={name}>
          <span className="truncate text-xs font-normal text-sidebar-foreground/70">
            {children}
          </span>
        </ViewMenuLabel>
      </NavLink>
    </SidebarMenuButton>
  </SidebarMenuItem>
)

type ViewMenuLabelProps = {
  name: string
  children: ReactNode
}

const ViewMenuLabel = ({ name, children }: ViewMenuLabelProps) => (
  <div className="grid min-w-0 flex-1 gap-[3px] leading-tight">
    <span className="block truncate">{name}</span>
    {children}
  </div>
)

type KeyFiguresLineProps = {
  figures?: ViewKeyFigures
  loading?: boolean
  error?: boolean
  showTooltip?: boolean
}

const KeyFiguresLine = ({
  figures,
  loading = false,
  error = false,
  showTooltip = true,
}: KeyFiguresLineProps) => {
  if (loading || (!figures && !error)) {
    return (
      <span className="flex h-4 items-center">
        <span
          className="h-3 w-24 rounded bg-sidebar-accent motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="sr-only">Henter nøgletal</span>
      </span>
    )
  }

  if (!figures) {
    return (
      <span className="truncate text-xs font-normal text-sidebar-foreground/70">
        Kunne ikke hente nøgletal
      </span>
    )
  }

  return (
    <AppTooltip content={showTooltip ? figures.title : null} side="right">
      <span className="flex w-full min-w-0 items-center gap-1.5 text-xs font-normal text-sidebar-foreground/70">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            QUOTA_STATUS_STYLES[figures.level].dot,
          )}
          aria-hidden="true"
        />
        <span className="truncate">{figures.label}</span>
      </span>
    </AppTooltip>
  )
}

const describeSimulationChanges = (
  changedCount: number,
  lockedCount: number,
  fieldCount: number,
) =>
  `${changedCount} af ${fieldCount} marker har et andet sædskifte end afgrødehistorikken${
    lockedCount > 0 ? `, ${lockedCount} er låst` : ''
  }`

type SimulationMenuItemProps = {
  farmId: string
  simulation: Simulation
  liveFields: FieldRecord[]
  selected: boolean
  folded: boolean
  loading: boolean
  deleting: boolean
  copying: boolean
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onSelect: () => void
  onCopy: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  farmId,
  simulation,
  liveFields,
  selected,
  folded,
  loading,
  deleting,
  copying,
  mode,
  onModeChange,
  onOptimize,
  onSelect,
  onCopy,
  onDelete,
}: SimulationMenuItemProps) => {
  const economics = useEconomicsProfiles()
  const profile = economics.appliedProfile(simulation)
  const ownProfileName =
    profile.id === STANDARD_PROFILE_ID ? null : profile.name
  const economicsNote =
    economics.ready && !economics.isEconomicsCurrent(simulation)
      ? describeAppliedProfile(economics.profiles, simulation)
      : null
  const createdLabel = formatCreatedAt(simulation.createdAt)
  const run = useOptimizationRun(simulation.id)
  const runningRun = run?.status === 'running' ? run : undefined
  const running = Boolean(runningRun) || isSimulationCreating(simulation)
  const failedRun = run?.status === 'failed' ? run : undefined
  const {
    data: simulationFields,
    error: fieldsError,
    isLoading: fieldsLoading,
    summaryMissing,
  } = useSimulationFields(farmId, simulation.id, isSimulationReady(simulation))
  const quota = simulationFields
    ? resolveFarmQuota(simulationFields, true)
    : null
  const figures = quota ? describeKeyFigures(quota, true) : undefined
  const fieldSetChanges = useFieldSetChanges(
    farmId,
    simulation,
    simulationFields,
  )
  const changedCount = useMemo(
    () =>
      simulationFields ? changedFieldIds(simulationFields, liveFields).size : 0,
    [simulationFields, liveFields],
  )
  const lockedCount = useMemo(
    () =>
      simulationFields ? simulationFields.filter(isFieldLocked).length : 0,
    [simulationFields],
  )
  const changesTitle =
    simulationFields && !runningRun && (changedCount > 0 || lockedCount > 0)
      ? describeSimulationChanges(
          changedCount,
          lockedCount,
          simulationFields.length,
        )
      : null

  if (
    folded && !selected && !running && !failedRun &&
    simulation.creationStatus !== 'failed'
  ) return null

  return (
    <SidebarMenuItem>
      <div className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton
              size="lg"
              isActive={selected}
              aria-current={selected ? 'page' : undefined}
              aria-busy={running || undefined}
              className={cn(SUB_BUTTON_CLASS, 'items-start gap-2')}
              onClick={onSelect}
            >
              {loading || running ? <Spinner className="mt-0.5" /> : null}
              <ViewMenuLabel name={simulation.name}>
                {!isSimulationReady(simulation) ? (
                  <span className="truncate text-xs">
                    {creationStatusLabel(simulation)}
                  </span>
                ) : summaryMissing ? (
                  <span className="truncate text-xs">Oversigt mangler</span>
                ) : (
                  <KeyFiguresLine
                    figures={figures}
                    loading={fieldsLoading}
                    error={Boolean(fieldsError)}
                    showTooltip={false}
                  />
                )}
                {runningRun ? (
                  <span className="truncate pl-3 text-[11px] font-normal text-primary tabular-nums">
                    <OptimizationRunElapsed run={runningRun} />
                  </span>
                ) : simulationFields ? (
                  <span className="truncate text-xs font-normal text-sidebar-foreground/70">
                    Regner med {ownProfileName ?? 'Standard'}
                  </span>
                ) : null}
                {!runningRun && fieldSetChanges ? (
                  <span className="truncate text-xs font-normal text-sidebar-foreground/70">
                    {fieldSetChanges}
                  </span>
                ) : null}
              </ViewMenuLabel>
            </SidebarMenuButton>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" className="max-w-64">
            <div className="grid gap-0.5">
              <span>{createdLabel}</span>
              {figures ? <span>{figures.title}</span> : null}
              {changesTitle ? <span>{changesTitle}</span> : null}
              {economicsNote ? <span>{economicsNote}</span> : null}
            </div>
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              disabled={deleting || copying}
              className="top-1/2! -translate-y-1/2"
              aria-label={`Handlinger for ${simulation.name}`}
            >
              {copying || deleting ? <Spinner /> : <MoreVertical />}
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem disabled={!isSimulationReady(simulation)} onSelect={() => {
              onSelect()
              onOptimize()
            }}>
              Indstillinger og navn
            </DropdownMenuItem>
            <AppTooltip content="Gemmer en ny simulering med samme indstillinger og regler. Du kan ændre kopien, før du kører Optimér. Kopien får bedriftens marker, så låse og tilføjede eller fjernede marker følger ikke med.">
              <DropdownMenuItem disabled={copying || !isSimulationReady(simulation)} onSelect={onCopy}>
                <Copy className="mr-2 size-4" aria-hidden="true" />
                Kopier som ny
              </DropdownMenuItem>
            </AppTooltip>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={deleting}
              onSelect={onDelete}
            >
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              Slet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {failedRun ? (
        <SimulationRunFailure run={failedRun} fields={simulationFields} />
      ) : null}
      {selected && isSimulationReady(simulation) ? (
        <SimulationSubMenu
          mode={mode}
          disabled={loading}
          running={running}
          onModeChange={onModeChange}
          onOptimize={onOptimize}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

type SimulationRunFailureProps = {
  run: OptimizationRun
  fields: FieldRecord[] | undefined
}

// Kept until dismissed, so a failure is not missed while the user is elsewhere.
const SimulationRunFailure = ({ run, fields }: SimulationRunFailureProps) => {
  const { retry, dismiss } = useOptimizationRunRetry(run, fields)
  return (
    <div
      role="alert"
      className="flex items-center gap-1 pr-1 pl-2.5 text-[11px] text-destructive"
    >
      {/* The type is left to the tooltip; with it the line is too long to fit
          next to "Prøv igen". */}
      <AppTooltip
        content={
          run.status === 'failed'
            ? `${optimizationRunName(run.kind)} fejlede: ${run.error}`
            : undefined
        }
      >
        <span className="min-w-0 flex-1 truncate">Optimering fejlede</span>
      </AppTooltip>
      <button
        type="button"
        className="shrink-0 rounded px-1 font-medium underline-offset-2 hover:underline disabled:opacity-50"
        disabled={!retry}
        onClick={retry}
      >
        Prøv igen
      </button>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 hover:bg-sidebar-accent"
        aria-label="Luk fejlbeskeden"
        onClick={dismiss}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
}

const RUN_IN_PROGRESS_TITLE = 'En optimering kører allerede'

type SimulationSubMenuProps = {
  mode: FarmInspectorMode
  disabled: boolean
  running: boolean
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
}

const SimulationSubMenu = ({
  mode,
  disabled,
  running,
  onModeChange,
  onOptimize,
}: SimulationSubMenuProps) => (
  <SidebarMenuSub>
    <AppTooltip content="Vis hvad optimeringen har beregnet for markerne">
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          asChild
          className="w-full"
          isActive={mode === 'values'}
        >
          <button
            type="button"
            aria-current={mode === 'values' ? 'page' : undefined}
            onClick={() => onModeChange('values')}
          >
            <Table2 />
            <span>Værdier</span>
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </AppTooltip>
    <AppTooltip content="Sæt hvad optimeringen må gøre">
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          asChild
          isActive={mode === 'rules'}
          className="w-full data-[active=true]:text-rules! data-[active=true]:[&>svg]:text-rules!"
        >
          <button
            type="button"
            aria-current={mode === 'rules' ? 'page' : undefined}
            onClick={() => onModeChange('rules')}
          >
            <SlidersHorizontal />
            <span>Regler</span>
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </AppTooltip>
    <AppTooltip content={running ? RUN_IN_PROGRESS_TITLE : undefined}>
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild className="w-full">
          <button
            type="button"
            disabled={disabled || running}
            onClick={onOptimize}
          >
            <Play />
            <span>Optimér</span>
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </AppTooltip>
  </SidebarMenuSub>
)

type SidebarWidthHandleProps = {
  width: number
  onWidthChange: (width: number) => void
}

const SidebarWidthHandle = ({
  width,
  onWidthChange,
}: SidebarWidthHandleProps) => {
  const { state, isMobile } = useSidebar()
  if (isMobile || state !== 'expanded') return null

  return <SidebarResizeHandle width={width} onWidthChange={onWidthChange} />
}
