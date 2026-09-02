import {
  ChevronLeft,
  FlaskConical,
  PanelLeft,
  Plus,
  Sprout,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { mutate } from 'swr'

import {
  simulationFieldsKey,
  simulationsKey,
  useSimulationFields,
} from '@/api/hooks'
import { deleteSimulation } from '@/api/mutations'
import type { Farm, FieldRecord, Simulation } from '@/api/types'
import type { FarmViewSelection } from '@/components/farm/types'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import { SidebarResizeHandle } from '@/components/farm/SidebarResizeHandle'
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  formatFieldCount,
  formatNumber,
  formatRelativeTime,
  getFieldTotals,
} from '@/lib/farm-totals'

type FarmSidebarProps = {
  farm: Farm
  fields: FieldRecord[]
  simulations: Simulation[]
  selection: FarmViewSelection
  onSelectionChange: (selection: FarmViewSelection) => void
  onError: (message: string | null) => void
  width: number
  onWidthChange: (width: number) => void
}

/**
 * Navigation for the bedrift: back to the bedrift list, then the visninger.
 * Rows are single-line so the list stays dense; only the selected visning
 * expands to describe itself, which keeps the detail where it is being read.
 * Collapses to an icon rail, so every visning keeps a row even when minimized.
 */
export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  onSelectionChange,
  onError,
  width,
  onWidthChange,
}: FarmSidebarProps) => {
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
  const [simulationToDelete, setSimulationToDelete] =
    useState<Simulation | null>(null)
  const [newScenarioOpen, setNewScenarioOpen] = useState(false)
  const totals = getFieldTotals(fields)

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
    <Sidebar collapsible="icon" aria-label="Visninger">
      <SidebarHeader className="p-2">
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
      </SidebarHeader>

      <SidebarDivider />

      <SidebarContent>
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Bedrifter">
                  <Link to="/">
                    <ChevronLeft />
                    <span>Bedrifter</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarDivider />

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Optimeringsalternativer</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {simulations.map((simulation) => (
                <SimulationMenuItem
                  key={simulation.id}
                  farmId={farm.id}
                  simulation={simulation}
                  selected={
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
                  onClick={() => setNewScenarioOpen(true)}
                >
                  <Plus />
                  <span>Ny simulering</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupLabel>Visninger</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <ViewMenuButton
                  icon={<Sprout />}
                  label="Afgrødehistorik"
                  selected={selection.kind === 'current'}
                  onSelect={() => onSelectionChange({ kind: 'current' })}
                />
                {selection.kind === 'current' ? (
                  <ViewDetails
                    entries={[
                      ['Marker', formatFieldCount(fields.length)],
                      ['Areal', `${formatNumber(totals.area)} ha`],
                    ]}
                  />
                ) : null}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarDivider />

      <SidebarFooter className="p-1 pb-3">
        <CollapseMenuButton />
      </SidebarFooter>

      <SidebarWidthHandle width={width} onWidthChange={onWidthChange} />

      <NewScenarioPanel
        farmId={farm.id}
        fields={fields}
        open={newScenarioOpen}
        onOpenChange={setNewScenarioOpen}
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

/**
 * A rule between sidebar sections. SidebarSeparator is not usable here: its
 * `w-full` is a variant utility that outranks the `w-auto` meant to make room
 * for the horizontal margin, so it overflows the sidebar by that margin.
 */
const SidebarDivider = () => (
  <div className="mx-2 h-px shrink-0 bg-sidebar-border" />
)

/**
 * Folds the sidebar down to its icon rail. It names what it does while the
 * sidebar is open; collapsed, the tooltip says how to get back.
 */
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

type ViewMenuButtonProps = {
  icon: React.ReactNode
  label: string
  selected: boolean
  onSelect: () => void
}

const ViewMenuButton = ({
  icon,
  label,
  selected,
  onSelect,
}: ViewMenuButtonProps) => (
  <SidebarMenuButton
    isActive={selected}
    aria-current={selected ? 'page' : undefined}
    tooltip={label}
    onClick={onSelect}
  >
    {icon}
    <span className="truncate">{label}</span>
  </SidebarMenuButton>
)

type ViewDetailsProps = {
  entries: [label: string, value: string][]
}

/** Description of the selected visning, folded out under its navigation row. */
const ViewDetails = ({ entries }: ViewDetailsProps) => (
  <dl className="mt-1 mb-1 ml-4 space-y-0.5 border-l border-sidebar-border pl-3 text-xs group-data-[collapsible=icon]:hidden">
    {entries.map(([label, value]) => (
      <div key={label} className="flex items-baseline justify-between gap-2">
        <dt className="text-sidebar-foreground/60">{label}</dt>
        <dd className="truncate font-medium">{value}</dd>
      </div>
    ))}
  </dl>
)

type SimulationMenuItemProps = {
  farmId: string
  simulation: Simulation
  selected: boolean
  deleting: boolean
  onSelect: () => void
  onDelete: () => void
}

const SimulationMenuItem = ({
  farmId,
  simulation,
  selected,
  deleting,
  onSelect,
  onDelete,
}: SimulationMenuItemProps) => {
  // Only the selected simulering describes itself, so only it needs its marker.
  const { data: fields = [], isLoading } = useSimulationFields(
    farmId,
    selected ? simulation.id : undefined,
  )
  const totals = getFieldTotals(fields)

  return (
    <SidebarMenuItem>
      <ViewMenuButton
        icon={<FlaskConical />}
        label={simulation.name}
        selected={selected}
        onSelect={onSelect}
      />
      <SidebarMenuAction
        showOnHover
        disabled={deleting}
        aria-label={`Slet ${simulation.name}`}
        onClick={onDelete}
      >
        <Trash2 />
      </SidebarMenuAction>
      {selected ? (
        <ViewDetails
          entries={[
            ['Marker', isLoading ? '…' : formatFieldCount(fields.length)],
            ['Areal', isLoading ? '…' : `${formatNumber(totals.area)} ha`],
            ['DB2', isLoading ? '…' : `${formatNumber(totals.db2)} kr`],
            ['Oprettet', formatRelativeTime(simulation.createdAt)],
          ]}
        />
      ) : null}
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

/** The drag handle only makes sense while the sidebar shows its full width. */
const SidebarWidthHandle = ({
  width,
  onWidthChange,
}: SidebarWidthHandleProps) => {
  const { state, isMobile } = useSidebar()
  if (isMobile || state !== 'expanded') return null

  return <SidebarResizeHandle width={width} onWidthChange={onWidthChange} />
}
