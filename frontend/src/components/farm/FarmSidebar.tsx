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
    <aside className="border-b bg-muted/30 p-4 lg:border-b-0 lg:border-r">
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Visninger
              </p>
              <p className="text-xs text-muted-foreground">
                Aktuelle marker og optimeringsalternativer.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80"
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

          <div className="space-y-2">
            <button
              type="button"
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selection.kind === 'current'
                  ? 'border-primary bg-primary/10'
                  : 'bg-background/70 hover:bg-background'
              }`}
              onClick={() => onSelectionChange({ kind: 'current' })}
            >
              <span
                className={
                  selection.kind === 'current' ? 'font-semibold' : 'font-medium'
                }
              >
                Afgrødehistorik
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatFieldCount(fields.length)} · {formatNumber(totals.area)}{' '}
                ha
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                DB2 {formatNumber(totals.db2)} kr · Udledning{' '}
                {formatNumber(totals.nLoad)} kg N · Udvaskning{' '}
                {formatNumber(totals.leaching)} kg N
              </span>
            </button>

            {simulations.map((simulation) => (
              <SimulationViewRow
                key={simulation.id}
                farmId={farm.id}
                simulation={simulation}
                selected={
                  selection.kind === 'simulation' &&
                  selection.id === simulation.id
                }
                deleting={deletingSimulationId === simulation.id}
                onSelect={() =>
                  onSelectionChange({ kind: 'simulation', id: simulation.id })
                }
                onDelete={() => void removeSimulation(simulation.id)}
              />
            ))}
          </div>
        </div>

      </div>
    </aside>
  )
}

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

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-background/70 p-2 transition-colors ${
        selected ? 'border-primary bg-primary/10' : 'hover:bg-background'
      }`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
      >
        <span
          className={`block truncate text-sm ${selected ? 'font-semibold' : 'font-medium'}`}
        >
          {simulation.name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatRelativeTime(simulation.createdAt)}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {isLoading
            ? 'Indlæser nøgletal...'
            : `${formatFieldCount(fields.length)} · ${formatNumber(totals.area)} ha`}
        </span>
        {!isLoading ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            DB2 {formatNumber(totals.db2)} kr · Udledning{' '}
            {formatNumber(totals.nLoad)} kg N · Udvaskning{' '}
            {formatNumber(totals.leaching)} kg N
          </span>
        ) : null}
      </button>
      <Button
        size="sm"
        variant="outline"
        className="bg-background/80 px-2"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Slet ${simulation.name}`}
      >
        {deleting ? '...' : 'Slet'}
      </Button>
    </div>
  )
}
