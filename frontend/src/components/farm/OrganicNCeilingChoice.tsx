import type { OrganicNCeiling } from '@/api/types'
import { cn } from '@/lib/utils'

type Props = {
  ceiling: OrganicNCeiling
  disabled: boolean
  onChange: (ceiling: OrganicNCeiling) => void
}

const OPTIONS = [
  {
    ceiling: 107,
    label: 'Basisstøtte',
    description:
      'Bedriftens gennemsnit af udnyttet N må højst være 107 kg N pr. ha harmoniareal.',
    guidance: 'Vælg den for den almindelige økologiske arealstøtte.',
  },
  {
    ceiling: 65,
    label: 'Basisstøtte og tillæg for reduceret N-tilførsel',
    description:
      'Gennemsnittet må højst være 65 kg N pr. ha harmoniareal. Til gengæld får de støtteberettigede arealer tillæg for reduceret N-tilførsel.',
    guidance:
      'Optimeringen holder bedriften under 65 kg N, og tillægget indgår i dækningsbidraget.',
  },
] as const

export function OrganicNCeilingChoice({ ceiling, disabled, onChange }: Props) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">
        Økologisk arealstøtte og N-loft
      </legend>
      {OPTIONS.map((option) => (
        <label
          key={option.ceiling}
          className={cn(
            'flex items-start gap-3 rounded-md border p-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            ceiling === option.ceiling
              ? 'border-primary bg-primary/5'
              : 'bg-background',
            !disabled && 'cursor-pointer hover:bg-muted/50',
          )}
        >
          <input
            type="radio"
            name="scenario-organic-n-ceiling"
            value={option.ceiling}
            checked={ceiling === option.ceiling}
            onChange={() => onChange(option.ceiling)}
            className="mt-1"
          />
          <span className="space-y-1.5">
            <span className="block font-medium">{option.label}</span>
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
