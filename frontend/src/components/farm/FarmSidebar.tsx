import {
  CalendarRange,
  ChevronsUpDown,
  FlaskConical,
  History,
  Loader2,
  PanelLeft,
  Play,
  Plus,
  SlidersHorizontal,
  Table2,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useSimulationFields,
} from '@/api/hooks'
import { deleteSimulation } from '@/api/mutations'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
import type {
  FarmInspectorMode,
  FarmViewSelection,
} from '@/components/farm/types'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserMenuContent } from '@/components/UserMenu'
import {
  computeFieldTotals,
  formatCompactKr,
  formatFieldCount,
  formatNumber,
  formatWholeNumber,
  QUOTA_STATUS_STYLES,
  totalsQuotaStatusLevel,
  type QuotaStatusLevel,
} from '@/lib/field-domain'
import {
  getStoredRole,
  HOME_OVERVIEW_STATE,
  ROLE_LABELS,
} from '@/lib/onboarding'
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

const useIsIconRail = () => {
  const { state, isMobile } = useSidebar()
  return !isMobile && state === 'collapsed'
}

type ViewKeyFigures = {
  level: QuotaStatusLevel
  label: string
  title: string
}

const describeKeyFigures = (
  fields: FieldRecord[],
  isSimulationView: boolean,
): ViewKeyFigures => {
  const totals = computeFieldTotals(fields, isSimulationView)
  const level = totalsQuotaStatusLevel(totals)
  const quota = totals.udledningskvoteMarkKgn

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
    quota > 0
      ? `${formatWholeNumber(totals.nLoad)} / ${formatWholeNumber(quota)} kg N`
      : `${formatWholeNumber(totals.nLoad)} kg N`
  const fullEmission =
    quota > 0
      ? `${formatNumber(totals.nLoad)} af ${formatNumber(quota)} kg N`
      : `${formatNumber(totals.nLoad)} kg N`

  return {
    level,
    label: `${emission} · ${formatCompactKr(totals.db2)}`,
    title: `Udledning ${fullEmission} pr. gennemsnitsår, DB2 ${formatWholeNumber(totals.db2)} kr`,
  }
}

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
  onError: (message: string | null) => void
  width: number
  onWidthChange: (width: number) => void
}

/**
 * Navigation for the bedrift: back to the bedrift list, then the visninger.
 * Rows are single-line so the list stays dense; only the selected visning
 * expands to describe itself, which keeps the detail where it is being read.
 * Collapses to an icon rail, so every visning keeps a row even when minimised.
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
  onError,
  width,
  onWidthChange,
}: FarmSidebarProps) => {
  const { user } = useAuth()
  const email = user?.email ?? ''
  const role = email ? getStoredRole(email) : null
  const showAllFarms = role !== 'landmand'
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [simulationToDelete, setSimulationToDelete] =
    useState<Simulation | null>(null)
  const [newSimulationOpen, setNewSimulationOpen] = useState(false)
  const historyFigures = describeKeyFigures(fields, false)

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

  return (
    <Sidebar collapsible="icon" aria-label="Navigation for bedriften">
      <SidebarHeader className="h-13 justify-center border-b border-sidebar-border px-2 py-0">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        {showAllFarms ? (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel>Bedrift</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Bedrifter">
                    <Link to="/" state={HOME_OVERVIEW_STATE}>
                      <Warehouse />
                      <span>Bedrifter</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Visninger</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={selection.kind === 'current'}
                  aria-current={
                    selection.kind === 'current' ? 'page' : undefined
                  }
                  className="group-data-[collapsible=icon]:justify-center"
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

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Simuleringer</SidebarGroupLabel>
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
                    selected={selected}
                    loading={loadingSelection && selected}
                    deleting={deletingSimulationId === simulation.id}
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
                    onDelete={() => setSimulationToDelete(simulation)}
                  />
                )
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="text-sidebar-foreground/70"
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
      </SidebarContent>

      <SidebarFooter className="p-1 pb-3">
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

const SidebarBrand = () => (
  <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
    <img
      src="/plantperform-mark.svg"
      alt=""
      className="size-9 shrink-0 group-data-[collapsible=icon]:size-8"
    />
    <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
      <span className="truncate text-base font-semibold tracking-tight">
        PlantPerform
      </span>
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
          className="text-sidebar-foreground/70"
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
  const iconRail = useIsIconRail()
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
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:py-0!"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initial}
              </span>
              <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm">{email}</span>
                {role ? (
                  <span className="truncate text-xs text-sidebar-foreground/70">
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
    <span className="truncate">{name}</span>
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

type SimulationMenuItemProps = {
  farmId: string
  simulation: Simulation
  selected: boolean
  loading: boolean
  deleting: boolean
  mode: FarmInspectorMode
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
  onSelect: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  farmId,
  simulation,
  selected,
  loading,
  deleting,
  mode,
  onModeChange,
  onOptimize,
  onYearlyOptimize,
  onSelect,
  onDelete,
}: SimulationMenuItemProps) => {
  const iconRail = useIsIconRail()
  const createdLabel = formatCreatedAt(simulation.createdAt)
  const {
    data: simulationFields,
    error: fieldsError,
    isLoading: fieldsLoading,
  } = useSimulationFields(farmId, simulation.id)
  const figures = simulationFields
    ? describeKeyFigures(simulationFields, true)
    : undefined

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            size="lg"
            isActive={selected}
            aria-current={selected ? 'page' : undefined}
            className="group-data-[collapsible=icon]:justify-center"
            title={iconRail ? undefined : createdLabel}
            onClick={onSelect}
          >
            {loading ? (
              <Loader2 className="motion-safe:animate-spin" />
            ) : (
              <FlaskConical />
            )}
            <ViewMenuLabel name={simulation.name}>
              <KeyFiguresLine
                figures={figures}
                loading={fieldsLoading}
                error={Boolean(fieldsError)}
              />
            </ViewMenuLabel>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={!iconRail}>
          {iconRail ? (
            <div className="grid gap-0.5">
              <span>{simulation.name}</span>
              <span>{createdLabel}</span>
              {figures ? <span>{figures.label}</span> : null}
            </div>
          ) : (
            createdLabel
          )}
        </TooltipContent>
      </Tooltip>
      <SidebarMenuAction
        showOnHover
        disabled={deleting}
        className="peer-data-[size=lg]/menu-button:top-3.5"
        aria-label={`Slet ${simulation.name}`}
        onClick={onDelete}
      >
        <Trash2 />
      </SidebarMenuAction>
      {selected ? (
        <SimulationSubMenu
          mode={mode}
          disabled={loading}
          onModeChange={onModeChange}
          onOptimize={onOptimize}
          onYearlyOptimize={onYearlyOptimize}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

type SimulationSubMenuProps = {
  mode: FarmInspectorMode
  disabled: boolean
  onModeChange: (mode: FarmInspectorMode) => void
  onOptimize: () => void
  onYearlyOptimize: () => void
}

const SimulationSubMenu = ({
  mode,
  disabled,
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
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild className="w-full">
        <button type="button" disabled={disabled} onClick={onOptimize}>
          <Play />
          <span>Optimér</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild className="w-full">
        <button type="button" disabled={disabled} onClick={onYearlyOptimize}>
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
