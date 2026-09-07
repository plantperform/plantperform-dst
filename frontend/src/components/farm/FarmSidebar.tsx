import {
  FlaskConical,
  History,
  Loader2,
  PanelLeft,
  Plus,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { mutate } from 'swr'

import { simulationFieldsKey, simulationsKey } from '@/api/hooks'
import { deleteSimulation } from '@/api/mutations'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import { useAuth } from '@/auth/context'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
import type { FarmViewSelection } from '@/components/farm/types'
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
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getStoredRole, HOME_OVERVIEW_STATE } from '@/lib/onboarding'

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

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  loadingSelection?: boolean
  onSelectionChange: (selection: FarmViewSelection) => void
  onError: (message: string | null) => void
  width: number
  onWidthChange: (width: number) => void
}

export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  loadingSelection = false,
  onSelectionChange,
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
                  <SidebarMenuButton asChild tooltip="Alle bedrifter">
                    <Link to="/" state={HOME_OVERVIEW_STATE}>
                      <Warehouse />
                      <span>Alle bedrifter</span>
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
                  isActive={selection.kind === 'current'}
                  aria-current={
                    selection.kind === 'current' ? 'page' : undefined
                  }
                  tooltip="Afgrødehistorik"
                  onClick={() => onSelectionChange({ kind: 'current' })}
                >
                  <History />
                  <span className="truncate">Afgrødehistorik</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Simuleringer</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {simulations.map((simulation) => (
                <SimulationMenuItem
                  key={simulation.id}
                  simulation={simulation}
                  selected={
                    selection.kind === 'simulation' &&
                    selection.id === simulation.id
                  }
                  loading={
                    loadingSelection &&
                    selection.kind === 'simulation' &&
                    selection.id === simulation.id
                  }
                  deleting={deletingSimulationId === simulation.id}
                  onSelect={() =>
                    onSelectionChange({
                      kind: 'simulation',
                      id: simulation.id,
                    })
                  }
                  onDelete={() => setSimulationToDelete(simulation)}
                />
              ))}
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

type SimulationMenuItemProps = {
  simulation: Simulation
  selected: boolean
  loading: boolean
  deleting: boolean
  onSelect: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  simulation,
  selected,
  loading,
  deleting,
  onSelect,
  onDelete,
}: SimulationMenuItemProps) => {
  const iconRail = useIsIconRail()
  const createdLabel = formatCreatedAt(simulation.createdAt)

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuButton
            isActive={selected}
            aria-current={selected ? 'page' : undefined}
            onClick={onSelect}
          >
            {loading ? (
              <Loader2 className="motion-safe:animate-spin" />
            ) : (
              <FlaskConical />
            )}
            <span className="truncate">{simulation.name}</span>
          </SidebarMenuButton>
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          {iconRail ? `${simulation.name} · ${createdLabel}` : createdLabel}
        </TooltipContent>
      </Tooltip>
      <SidebarMenuAction
        showOnHover
        disabled={deleting}
        aria-label={`Slet ${simulation.name}`}
        onClick={onDelete}
      >
        <Trash2 />
      </SidebarMenuAction>
    </SidebarMenuItem>
  )
}

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
