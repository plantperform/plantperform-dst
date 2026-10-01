import { SlidersHorizontal } from 'lucide-react'

import type { FieldRecord, Simulation } from '@/api/types'
import { EconomicsAssumptionsEditor } from '@/components/farm/EconomicsAssumptionsEditor'
import { FieldRulesCard } from '@/components/farm/FieldRulesCard'
import { RulesLimitsCard } from '@/components/farm/RulesLimitsCard'
import { SimulationBasisCard } from '@/components/farm/SimulationBasisCard'
import { EXAMPLE_ECONOMICS } from '@/lib/economics-example'

type SimulationRulesPanelProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  lockingFieldId: string | null
  hoveredFieldId: string | null
  focusRequest?: { fieldId: string; nonce: number }
  onHoveredFieldChange: (fieldId: string | null) => void
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
  onEditBasis: (simulation: Simulation) => void
}

export const SimulationRulesPanel = ({
  farmId,
  simulation,
  fields,
  lockingFieldId,
  hoveredFieldId,
  focusRequest,
  onHoveredFieldChange,
  onToggleLock,
  onBindRotation,
  onEditBasis,
}: SimulationRulesPanelProps) => (
  <div className="@container flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
    <div className="border-b border-rules/20 bg-rules/10 px-6 py-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4.5 text-rules" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold">Regler</h2>
      </div>
      <p className="mt-1.5 max-w-190 text-[13px] text-muted-foreground">
        Her bestemmer du, hvad optimeringen må gøre: grænser for hele bedriften
        og marker, den ikke må ændre.
      </p>
    </div>
    <div className="flex flex-col gap-3.5 px-6 pt-5 pb-6">
      <RulesLimitsCard
        key={simulation.id}
        farmId={farmId}
        simulation={simulation}
        fields={fields}
      />
      <SimulationBasisCard
        simulation={simulation}
        onEditBasis={() => onEditBasis(simulation)}
      />
      <FieldRulesCard
        fields={fields}
        lockingFieldId={lockingFieldId}
        hoveredFieldId={hoveredFieldId}
        focusRequest={focusRequest}
        onHoveredFieldChange={onHoveredFieldChange}
        onToggleLock={onToggleLock}
        onBindRotation={onBindRotation}
      />
      <EconomicsAssumptionsEditor assumptions={EXAMPLE_ECONOMICS} />
    </div>
  </div>
)
