import { ChoiceCards } from '@/components/farm/ChoiceCards'
import type { OptimizationKind } from '@/lib/optimization-run'
import { OPTIMIZATION_KIND_LABELS } from '@/lib/optimization-run'

type Props = {
  kind: OptimizationKind
  disabled: boolean
  onChange: (kind: OptimizationKind) => void
}

const OPTIONS = [
  {
    value: 'yearly',
    label: OPTIMIZATION_KIND_LABELS.yearly,
    description:
      'Kvoten er et loft, som udledningen ikke må overstige i noget kalenderår. Sædskifterne kan rykkes i deres cyklus for at sprede udledningen.',
    guidance:
      'Vælg den, når kvoten skal overholdes hvert år, eller når DB2 ikke må svinge for meget mellem årene. Bruger de indstillinger, der er gemt på simuleringen.',
  },
  {
    value: 'optimize',
    label: OPTIMIZATION_KIND_LABELS.optimize,
    description:
      'Kvoten gælder for gennemsnittet af simuleringens år. Et år må ligge over kvoten, når et andet ligger tilsvarende under.',
    guidance:
      'Vælg den, når kvoten skal overholdes over hele perioden. Bruger de regler, der er gemt på simuleringen.',
  },
] as const

export function SimulationQuotaChoice({ kind, disabled, onChange }: Props) {
  return (
    <ChoiceCards
      legend="Hvordan skal udledningskvoten gælde?"
      name="scenario-quota-mode"
      options={OPTIONS}
      value={kind}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
