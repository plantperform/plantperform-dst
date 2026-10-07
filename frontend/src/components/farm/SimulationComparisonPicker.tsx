import { ChevronDown } from 'lucide-react'

import type { Simulation } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  describeComparisonAvailability,
  MAX_COMPARED_SIMULATIONS,
  toggleComparisonId,
  type ComparisonAvailability,
} from '@/lib/simulation-comparison'

const UNKNOWN_AVAILABILITY: ComparisonAvailability = { kind: 'uncalculated' }

type SimulationComparisonPickerProps = {
  simulations: Simulation[]
  availability: Record<string, ComparisonAvailability> | undefined
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export const SimulationComparisonPicker = ({
  simulations,
  availability,
  selectedIds,
  onChange,
}: SimulationComparisonPickerProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        disabled={availability === undefined || simulations.length === 0}
      >
        Vælg simuleringer
        <ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-72">
      {simulations.map((simulation) => {
        const checked = selectedIds.includes(simulation.id)
        const status = describeComparisonAvailability(
          availability?.[simulation.id] ?? UNKNOWN_AVAILABILITY,
        )
        const full = !checked && selectedIds.length >= MAX_COMPARED_SIMULATIONS
        const note =
          status ?? (full ? `Højst ${MAX_COMPARED_SIMULATIONS}` : null)
        return (
          <DropdownMenuCheckboxItem
            key={simulation.id}
            indicator="box"
            checked={checked}
            disabled={note !== null}
            onCheckedChange={() =>
              onChange(toggleComparisonId(selectedIds, simulation.id))
            }
            onSelect={(event) => event.preventDefault()}
          >
            <span className="min-w-0 flex-1 truncate">{simulation.name}</span>
            {note ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {note}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        )
      })}
    </DropdownMenuContent>
  </DropdownMenu>
)
