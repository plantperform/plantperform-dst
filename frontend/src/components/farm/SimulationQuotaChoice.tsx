import type { OptimizationKind } from '@/lib/optimization-run'
import { OPTIMIZATION_KIND_LABELS } from '@/lib/optimization-run'
import { cn } from '@/lib/utils'

type Props = {
  kind: OptimizationKind
  disabled: boolean
  onChange: (kind: OptimizationKind) => void
}

const OPTIONS = [
  {
    kind: 'optimize',
    description:
      'Kvoten gælder for gennemsnittet af simuleringens år. Et år må ligge over kvoten, når et andet ligger tilsvarende under.',
    guidance:
      'Vælg den, når kvoten skal overholdes over hele perioden. Bruger de regler, der er gemt på simuleringen.',
  },
  {
    kind: 'yearly',
    description:
      'Kvoten er et loft, som udledningen ikke må overstige i noget kalenderår. Sædskifterne kan rykkes i deres cyklus for at sprede udledningen.',
    guidance:
      'Vælg den, når kvoten skal overholdes hvert år, eller når DB2 ikke må svinge for meget mellem årene. Bruger de indstillinger, der er gemt på simuleringen.',
  },
] as const

export function SimulationQuotaChoice({ kind, disabled, onChange }: Props) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">
        Hvordan skal udledningskvoten gælde?
      </legend>
      {OPTIONS.map((option) => (
        <label
          key={option.kind}
          className={cn(
            'flex items-start gap-3 rounded-md border p-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            kind === option.kind
              ? 'border-primary bg-primary/5'
              : 'bg-background',
            !disabled && 'cursor-pointer hover:bg-muted/50',
          )}
        >
          <input
            type="radio"
            name="scenario-quota-mode"
            value={option.kind}
            checked={kind === option.kind}
            onChange={() => onChange(option.kind)}
            className="mt-1"
          />
          <span className="space-y-1.5">
            <span className="block font-medium">
              {OPTIMIZATION_KIND_LABELS[option.kind]}
            </span>
            <span className="block text-muted-foreground">
              {option.description}
            </span>
            <span className="block text-xs text-muted-foreground">
              {option.guidance}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
