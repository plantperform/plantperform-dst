import { Trash2 } from 'lucide-react'
import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
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
}

export const FarmSidebar = ({
  farm,
  fields,
  simulations,
  selection,
  onSelectionChange,
  onError,
}: FarmSidebarProps) => {
  const [deletingSimulationId, setDeletingSimulationId] = useState<
    string | null
  >(null)
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
    <nav
      aria-label="Visninger"
      className="border-b bg-muted/30 p-3 lg:border-b-0 lg:border-r"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Visninger
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => setNewScenarioOpen(true)}
        >
          Ny
        </Button>
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
      </div>

      <ul className="space-y-1">
        <li>
          <ViewRowButton
            label="Afgrødehistorik"
            context={`${formatFieldCount(fields.length)} · ${formatNumber(totals.area)} ha`}
            selected={selection.kind === 'current'}
            onSelect={() => onSelectionChange({ kind: 'current' })}
          />
        </li>

        {simulations.length > 0 ? (
          <li>
            <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
              Optimeringsalternativer
            </p>
            {/* Indented under Afgrødehistorik: every simulering is a copy of the
                bedrift's marker, not a sibling of them. */}
            <ul className="ml-3 space-y-1 border-l pl-2">
              {simulations.map((simulation) => (
                <li key={simulation.id}>
                  <SimulationViewRow
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
                    onDelete={() => void removeSimulation(simulation.id)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}

type ViewRowButtonProps = {
  label: string
  context: string
  selected: boolean
  onSelect: () => void
}

const ViewRowButton = ({
  label,
  context,
  selected,
  onSelect,
}: ViewRowButtonProps) => (
  <button
    type="button"
    aria-current={selected ? 'page' : undefined}
    className={`w-full rounded-md border-l-2 px-3 py-2 text-left transition-colors ${
      selected
        ? 'border-l-primary bg-primary/10 text-primary'
        : 'border-l-transparent hover:bg-background'
    }`}
    onClick={onSelect}
  >
    <span className={`block truncate text-sm ${selected ? 'font-semibold' : 'font-medium'}`}>
      {label}
    </span>
    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
      {context}
    </span>
  </button>
)

type SimulationViewRowProps = {
  farmId: string
  simulation: Simulation
  selected: boolean
  deleting: boolean
  onSelect: () => void
  onDelete: () => void
}

const SimulationViewRow = ({
  farmId,
  simulation,
  selected,
  deleting,
  onSelect,
  onDelete,
}: SimulationViewRowProps) => {
  const { data: fields = [], isLoading } = useSimulationFields(
    farmId,
    simulation.id,
  )
  const totals = getFieldTotals(fields)
  const context = isLoading
    ? formatRelativeTime(simulation.createdAt)
    : `${formatFieldCount(fields.length)} · ${formatNumber(totals.area)} ha`

  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <ViewRowButton
          label={simulation.name}
          context={context}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 px-2 text-muted-foreground hover:text-red-600"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Slet ${simulation.name}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}
