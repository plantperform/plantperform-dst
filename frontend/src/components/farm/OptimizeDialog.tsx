import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import type { FieldRecord, Simulation } from '@/api/types'

type Props = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRules: () => void
}

export const OptimizeDialog = ({
  farmId,
  simulation,
  fields,
  open,
  onOpenChange,
}: Props) => (
  <NewScenarioPanel
    farmId={farmId}
    fields={fields}
    source={simulation}
    open={open}
    onOpenChange={onOpenChange}
    onSimulationCreated={() => {}}
    onError={() => {}}
  />
)
