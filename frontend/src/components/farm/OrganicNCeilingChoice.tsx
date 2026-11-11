import type { OrganicNCeiling } from '@/api/types'
import { ChoiceCards } from '@/components/farm/ChoiceCards'

type Props = {
  ceiling: OrganicNCeiling
  disabled: boolean
  onChange: (ceiling: OrganicNCeiling) => void
}

const OPTIONS = [
  {
    value: 107,
    label: 'Basisstøtte',
    description:
      'Bedriftens gennemsnit af udnyttet N må højst være 107 kg N pr. ha harmoniareal.',
    guidance: 'Vælg den for den almindelige økologiske arealstøtte.',
  },
  {
    value: 65,
    label: 'Basisstøtte og tillæg for reduceret N-tilførsel',
    description:
      'Gennemsnittet må højst være 65 kg N pr. ha harmoniareal. Til gengæld får de støtteberettigede arealer tillæg for reduceret N-tilførsel.',
    guidance:
      'Optimeringen holder bedriften under 65 kg N, og tillægget indgår i dækningsbidraget.',
  },
] as const

export function OrganicNCeilingChoice({ ceiling, disabled, onChange }: Props) {
  return (
    <ChoiceCards
      legend="Økologisk arealstøtte og N-loft"
      name="scenario-organic-n-ceiling"
      options={OPTIONS}
      value={ceiling}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
