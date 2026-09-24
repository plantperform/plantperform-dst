import {
  CalendarRange,
  ChevronsUpDown,
  Copy,
  FlaskConical,
  History,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { mutate } from 'swr'

import {
  fetchSimulationFields,
  simulationFieldsKey,
  simulationsKey,
  useSimulationFields,
} from '@/api/hooks'
import {
  createSimulation,
  deleteSimulation,
  updateSimulationConstraints,
} from '@/api/mutations'
import type {
  CreateSimulationInput,
  Farm,
  FieldRecord,
  Simulation,
} from '@/api/types'
import { useAuth } from '@/auth/context'
import {
  useOptimizationRun,
  useStartDefaultOptimization,
  type OptimizationRun,
} from '@/api/optimization-runs'
import { FarmSwitcher } from '@/components/farm/FarmSwitcher'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { useOptimizationRunRetry } from '@/components/farm/optimization-run-retry'
import { OptimizationRunElapsed } from '@/components/farm/OptimizationRunStatus'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
import type {
  FarmInspectorMode,
  FarmView,
  FarmViewSelection,
} from '@/components/farm/types'
import { ViewModeSwitch } from '@/components/farm/ViewModeSwitch'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserMenuContent } from '@/components/UserMenu'
import {
  changedFieldIds,
  describeSeparateQuotas,
  formatCompactDkk,
  formatFieldCount,
  formatQuotaAmount,
  formatWholeNumber,
  isFieldLocked,
  QUOTA_STATUS_STYLES,
  resolveFarmQuota,
  type FarmQuota,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import {
  getStoredRole,
  ROLE_LABELS,
} from '@/lib/onboarding'
import { OPTIMIZATION_KIND_LABELS } from '@/lib/optimization-run'
import { cn } from '@/lib/utils'

const formatCreatedAt = (value: string) => {
  const createdAt = new Date(value).getTime()
  if (Number.isNaN(createdAt)) return 'Oprettet for nylig'

  const diffMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000))
  if (diffMinutes < 1) return 'Oprettet netop nu'
  if (diffMinutes < 60) return `Oprettet for ${diffMinutes} min. siden`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `Oprettet for ${diffHours} t. siden`

  const diffDays = Math.round(diffHours / 24)
  return `Oprettet for ${diffDays} d. siden`
}

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

  const emission =
    quotaKgN !== null && quotaKgN > 0
      ? `${formatWholeNumber(totals.nLoad)} / ${formatWholeNumber(quotaKgN)} kg N`
      : `${formatWholeNumber(totals.nLoad)} kg N`
  const fullEmission = formatQuotaAmount(totals.nLoad, quotaKgN ?? 0)
  const quotaNote =
    quotaKgN === null ? `, ${describeSeparateQuotas(quota)}` : ''

  return {
    level,
    label: `${emission} · ${formatCompactDkk(totals.db2)}`,
    title: `Udledning ${fullEmission} pr. gennemsnitsår${quotaNote}, DB2 ${formatWholeNumber(totals.db2)} kr`,
  }
}


const buildCopyInput = (simulation: Simulation): CreateSimulationInput => ({
  name: `${simulation.name} (kopi)`,
  allowedRotationVariants: simulation.rotationVariants,
  allowedNNormPercentages: simulation.nNormPercentages,
  fertiliser: simulation.fertiliser,
  catchCropSowingDate: simulation.catchCropSowingDate,
  catchCropDailyBasis: simulation.catchCropDailyBasis,
})

export const GROUP_CLASS = 'px-3 py-1 group-data-[collapsible=icon]:px-2'

export const GROUP_LABEL_CLASS =
  'h-7 text-[11px] font-semibold tracking-[0.06em] uppercase'
const VIEW_BUTTON_CLASS =
  'h-auto min-h-12 rounded-md px-3 py-2 data-[active=true]:[&>svg]:text-primary'

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  loadingSelection?: boolean
  onSelectionChange: (selection: FarmViewSelection) => void
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
  view: FarmView
  splitAvailable: boolean
  onViewChange: (view: FarmView) => void
  onError: (message: string | null) => void
  width: number
  onWidthChange: (width: number) => void
}

/**
 * Navigation for the farm: the farm menu, then the views.
 * Rows are single-line so the list stays dense; only the selected view
 * expands to describe itself, which keeps the detail where it is being read.
 * Collapses to an icon rail, so every view keeps a row even when minimised.
 */
export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  loadingSelection = false,
  onSelectionChange,
  mode,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
  view,
  splitAvailable,
  onViewChange,
  onError,
  width,
  onWidthChange,
}: FarmSidebarProps) => {
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [copyingSimulationId, setCopyingSimulationId] = useState<string | null>(
    null,
  )
  const [simulationToDelete, setSimulationToDelete] =
    useState<Simulation | null>(null)
  const [newSimulationOpen, setNewSimulationOpen] = useState(false)
  const startDefaultRun = useStartDefaultOptimization()
  const historyFigures = describeKeyFigures(
    resolveFarmQuota(fields, false),
    false,
  )

  const removeSimulation = async (simulationId: string) => {
    setDeletingSimulationId(simulationId)
    try {
      await deleteSimulation(farm.id, simulationId)
      await mutate(simulationsKey(farm.id))
      await mutate(simulationFieldsKey(farm.id, simulationId), undefined, {
        revalidate: false,
      })
      if (selection.kind === 'simulation' && selection.id === simulationId) {
        onSelectionChange({ kind: 'current' })
      }
      onError(null)
    } catch {
      onError('Kunne ikke slette simuleringen.')
    } finally {
      setDeletingSimulationId(null)
    }
  }

  const copySimulation = async (simulation: Simulation) => {
    setCopyingSimulationId(simulation.id)
    let created: Simulation
    try {
      created = await createSimulation(farm.id, buildCopyInput(simulation))
      await mutate(simulationsKey(farm.id))
    } catch {
      onError('Kunne ikke kopiere simuleringen.')
      setCopyingSimulationId(null)
      return
    }
    let copyError: string | null = null
    try {
      await updateSimulationConstraints(
        farm.id,
        created.id,
        simulation.constraints,
      )
      await mutate(simulationsKey(farm.id))
    } catch {
      copyError =
        'Simuleringen blev kopieret, men reglerne kunne ikke kopieres.'
    }
    if (!copyError) {
      try {
        startDefaultRun(
          farm.id,
          created.id,
          await fetchSimulationFields(farm.id, created.id),
        )
      } catch {
        copyError =
          'Simuleringen blev kopieret, men Optimér kunne ikke startes.'
      }
    }
    onError(copyError)
    onSelectionChange({ kind: 'simulation', id: created.id })
    setCopyingSimulationId(null)
  }

  return (
    <Sidebar collapsible="icon" aria-label="Navigation for bedriften">
      <SidebarHeader className="gap-2 px-3 pt-3 pb-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        <SidebarBrand />
        <FarmSwitcher farm={farm} onError={onError} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className={GROUP_CLASS}>
          <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
            Visninger
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={selection.kind === 'current'}
                  aria-current={
                    selection.kind === 'current' ? 'page' : undefined
                  }
                  className={cn(
                    VIEW_BUTTON_CLASS,
                    'group-data-[collapsible=icon]:justify-center',
                  )}
                  tooltip={{
                    children: (
                      <div className="grid gap-0.5">
                        <span>Afgrødehistorik</span>
                        <span>{historyFigures.label}</span>
                      </div>
                    ),
                  }}
                  onClick={() => onSelectionChange({ kind: 'current' })}
                >
                  <History />
                  <ViewMenuLabel name="Afgrødehistorik">
                    <KeyFiguresLine figures={historyFigures} />
                  </ViewMenuLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className={GROUP_CLASS}>
          <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
            Simuleringer
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {simulations.map((simulation) => {
                const selected =
                  selection.kind === 'simulation' &&
                  selection.id === simulation.id
                return (
                  <SimulationMenuItem
                    key={simulation.id}
                    farmId={farm.id}
                    simulation={simulation}
                    liveFields={fields}
                    selected={selected}
                    loading={loadingSelection && selected}
                    deleting={deletingSimulationId === simulation.id}
                    copying={copyingSimulationId === simulation.id}
                    mode={mode}
                    onModeChange={onModeChange}
                    onOptimize={onOptimize}
                    onYearlyOptimize={onYearlyOptimize}
                    onSelect={() =>
                      onSelectionChange({
                        kind: 'simulation',
                        id: simulation.id,
                      })
                    }
                    onCopy={() => void copySimulation(simulation)}
                    onDelete={() => setSimulationToDelete(simulation)}
                  />
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="rounded-md px-3 font-medium text-primary hover:text-primary"
                  tooltip="Ny simulering"
                  onClick={() => setNewSimulationOpen(true)}
                >
                  <Plus />
                  <span>Ny simulering</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className={cn(GROUP_CLASS, 'mt-auto')}>
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
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-2">
        <CollapseMenuButton />
        <SidebarUserMenu />
      </SidebarFooter>

      <SidebarWidthHandle width={width} onWidthChange={onWidthChange} />

      <NewScenarioPanel
        farmId={farm.id}
        fields={fields}
        open={newSimulationOpen}
        onOpenChange={setNewSimulationOpen}
        onSimulationCreated={(simulation) =>
          onSelectionChange({ kind: 'simulation', id: simulation.id })
        }
        onError={onError}
      />
      <DeleteSimulationDialog
        simulation={simulationToDelete}
        onOpenChange={(open) => {
          if (!open) setSimulationToDelete(null)
        }}
        onConfirm={(simulationId) => void removeSimulation(simulationId)}
      />
    </Sidebar>
  )
}

export const SidebarBrand = () => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <img
      src="/plant-perform-tab-icon.svg"
      alt=""
      className="size-8 shrink-0 rounded-md"
    />
    <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
      <span className="truncate text-sm font-semibold">PlantPerform</span>
      <span className="truncate text-xs text-muted-foreground">
        Sædskifteplanlægning
      </span>
    </div>
  </div>
)

const CollapseMenuButton = () => {
  const { toggleSidebar } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="h-7 px-2 text-xs text-sidebar-foreground/70"
          tooltip="Vis sidepanel"
          onClick={toggleSidebar}
        >
          <PanelLeft />
          <span>Skjul sidepanel</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const SidebarUserMenu = () => {
  const { user } = useAuth()
  const iconRail = useSidebar().state === 'collapsed'
  const email = user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()
  const role = email ? getStoredRole(email) : null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={email ? `Brugermenu, ${email}` : 'Brugermenu'}
              tooltip={email}
              className="h-auto rounded-md border border-sidebar-border bg-card px-2 py-1.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:py-0!"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initial}
              </span>
              <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-xs font-semibold">{email}</span>
                {role ? (
                  <span className="truncate text-[11px] text-sidebar-foreground/70">
                    {ROLE_LABELS[role]}
                  </span>
                ) : null}
              </div>
              <ChevronsUpDown
                className="ml-auto text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={iconRail ? 'right' : 'top'}
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <UserMenuContent />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

type ViewMenuLabelProps = {
  name: string
  children: ReactNode
}

const ViewMenuLabel = ({ name, children }: ViewMenuLabelProps) => (
  <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
    <span className="block truncate font-medium">{name}</span>
    {children}
  </div>
)

type KeyFiguresLineProps = {
  figures?: ViewKeyFigures
  loading?: boolean
  error?: boolean
}

const KeyFiguresLine = ({
  figures,
  loading = false,
  error = false,
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
    <span
      className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-sidebar-foreground/70"
      title={figures.title}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          QUOTA_STATUS_STYLES[figures.level].dot,
        )}
        aria-hidden="true"
      />
      <span className="truncate">{figures.label}</span>
    </span>
  )
}

type SimulationDetailLineProps = {
  changedCount: number
  lockedCount: number
  fieldCount: number
}

const SimulationDetailLine = ({
  changedCount,
  lockedCount,
  fieldCount,
}: SimulationDetailLineProps) => {
  if (changedCount === 0 && lockedCount === 0) return null

  const parts: string[] = []
  if (changedCount > 0) parts.push(`${formatFieldCount(changedCount)} ændret`)
  if (lockedCount > 0) parts.push(`${formatFieldCount(lockedCount)} låst`)

  return (
    <span
      className="truncate pl-3 text-[11px] font-normal text-sidebar-foreground/70 tabular-nums"
      title={`${changedCount} af ${fieldCount} marker har et andet sædskifte end afgrødehistorikken${
        lockedCount > 0 ? `, ${lockedCount} er låst` : ''
      }`}
    >
      {parts.join(' · ')}
    </span>
  )
}

type SimulationMenuItemProps = {
  farmId: string
  simulation: Simulation
  liveFields: FieldRecord[]
  selected: boolean
  loading: boolean
  deleting: boolean
  copying: boolean
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
  onSelect: () => void
  onCopy: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  farmId,
  simulation,
  liveFields,
  selected,
  loading,
  deleting,
  copying,
  mode,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
  onSelect,
  onCopy,
  onDelete,
}: SimulationMenuItemProps) => {
  const iconRail = useSidebar().state === 'collapsed'
  const createdLabel = formatCreatedAt(simulation.createdAt)
  const run = useOptimizationRun(simulation.id)
  const runningRun = run?.status === 'running' ? run : undefined
  const running = Boolean(runningRun)
  const failedRun = run?.status === 'failed' ? run : undefined
  const {
    data: simulationFields,
    error: fieldsError,
    isLoading: fieldsLoading,
  } = useSimulationFields(farmId, simulation.id)
  const quota = useMemo(
    () => (simulationFields ? resolveFarmQuota(simulationFields, true) : null),
    [simulationFields],
  )
  const figures = quota ? describeKeyFigures(quota, true) : undefined
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

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            size="lg"
            isActive={selected}
            aria-current={selected ? 'page' : undefined}
            aria-busy={running || undefined}
            className={cn(
              VIEW_BUTTON_CLASS,
              'relative group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:justify-center',
            )}
            title={iconRail ? undefined : createdLabel}
            onClick={onSelect}
          >
            {loading || running ? <Spinner /> : <FlaskConical />}
            {failedRun ? (
              <span
                className="absolute top-1 right-1 hidden size-2 rounded-full bg-destructive group-data-[collapsible=icon]:block"
                aria-hidden="true"
              />
            ) : null}
            <ViewMenuLabel name={simulation.name}>
              <KeyFiguresLine
                figures={figures}
                loading={fieldsLoading}
                error={Boolean(fieldsError)}
              />
              {runningRun ? (
                <span className="truncate pl-3 text-[11px] font-normal text-primary tabular-nums">
                  <OptimizationRunElapsed run={runningRun} />
                </span>
              ) : simulationFields ? (
                <SimulationDetailLine
                  changedCount={changedCount}
                  lockedCount={lockedCount}
                  fieldCount={simulationFields.length}
                />
              ) : null}
            </ViewMenuLabel>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={!iconRail}>
          {iconRail ? (
            <div className="grid gap-0.5">
              <span>{simulation.name}</span>
              <span>{createdLabel}</span>
              {figures ? <span>{figures.label}</span> : null}
              {runningRun ? (
                <span className="tabular-nums">
                  <OptimizationRunElapsed run={runningRun} />
                </span>
              ) : failedRun ? (
                <span>
                  {OPTIMIZATION_KIND_LABELS[failedRun.kind]} fejlede
                </span>
              ) : null}
            </div>
          ) : (
            createdLabel
          )}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover
            disabled={deleting || copying}
            className="peer-data-[size=lg]/menu-button:top-3.5"
            aria-label={`Handlinger for ${simulation.name}`}
          >
            {copying || deleting ? (
              <Spinner />
            ) : (
              <MoreHorizontal />
            )}
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            disabled={copying}
            title="Opretter en ny simulering med samme indstillinger og regler. Kører Optimér på kopien med det samme. Markernes låse følger ikke med."
            onSelect={onCopy}
          >
            <Copy className="mr-2 size-4" aria-hidden="true" />
            Kopier som ny
          </DropdownMenuItem>
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
      {failedRun ? (
        <SimulationRunFailure run={failedRun} fields={simulationFields} />
      ) : null}
      {selected ? (
        <SimulationSubMenu
          mode={mode}
          disabled={loading}
          running={running}
          onModeChange={onModeChange}
          onOptimize={onOptimize}
          onYearlyOptimize={onYearlyOptimize}
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
      className="flex items-center gap-1 pr-1 pl-9 text-[11px] text-destructive group-data-[collapsible=icon]:hidden"
    >
      <span
        className="min-w-0 flex-1 truncate"
        title={run.status === 'failed' ? run.error : undefined}
      >
        {OPTIMIZATION_KIND_LABELS[run.kind]} fejlede
      </span>
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

// On the list item, because a disabled button does not show its title.
const RUN_IN_PROGRESS_TITLE = 'En optimering kører allerede'

type SimulationSubMenuProps = {
  mode: FarmInspectorMode
  disabled: boolean
  running: boolean
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
}

const SimulationSubMenu = ({
  mode,
  disabled,
  running,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
}: SimulationSubMenuProps) => (
  <SidebarMenuSub>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        className="w-full"
        isActive={mode === 'values'}
      >
        <button
          type="button"
          aria-current={mode === 'values' ? 'page' : undefined}
          title="Vis hvad optimeringen har beregnet for markerne"
          onClick={() => onModeChange('values')}
        >
          <Table2 />
          <span>Værdier</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={mode === 'rules'}
        className="w-full data-[active=true]:text-rules! data-[active=true]:[&>svg]:text-rules!"
      >
        <button
          type="button"
          aria-current={mode === 'rules' ? 'page' : undefined}
          title="Sæt hvad optimeringen må gøre"
          onClick={() => onModeChange('rules')}
        >
          <SlidersHorizontal />
          <span>Regler</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem title={running ? RUN_IN_PROGRESS_TITLE : undefined}>
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
    <SidebarMenuSubItem title={running ? RUN_IN_PROGRESS_TITLE : undefined}>
      <SidebarMenuSubButton asChild className="w-full">
        <button
          type="button"
          disabled={disabled || running}
          onClick={onYearlyOptimize}
        >
          <CalendarRange />
          <span>Års-optimering</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  </SidebarMenuSub>
)

type DeleteSimulationDialogProps = {
  simulation: Simulation | null
  onOpenChange: (open: boolean) => void
  onConfirm: (simulationId: string) => void
}

const DeleteSimulationDialog = ({
  simulation,
  onOpenChange,
  onConfirm,
}: DeleteSimulationDialogProps) => (
  <Dialog open={simulation !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Slet {simulation?.name}?</DialogTitle>
        <DialogDescription>
          Simuleringen og dens kopierede marker slettes. Bedriftens egne marker
          berøres ikke. Handlingen kan ikke fortrydes.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuller</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            variant="destructive"
            onClick={() => {
              if (simulation) onConfirm(simulation.id)
            }}
          >
            Slet simulering
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
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
