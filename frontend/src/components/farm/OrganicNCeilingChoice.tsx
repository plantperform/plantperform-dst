import type { OrganicNCeiling } from '@/api/types'
import { ChoiceCards } from '@/components/farm/ChoiceCards'
import { ORGANIC_N_CEILING_SUPPORT } from '@/lib/simulation-form'

type Props = {
  ceiling: OrganicNCeiling
  disabled: boolean
  onChange: (ceiling: OrganicNCeiling) => void
}

const OPTIONS = [
  {
    value: 107,
    label: ORGANIC_N_CEILING_SUPPORT[107],
    description:
      'Bedriftens gennemsnit af udnyttet N må højst være 107 kg N pr. ha harmoniareal.',
    guidance: 'Vælg den for den almindelige økologiske arealstøtte.',
  },
  {
    value: 65,
    label: ORGANIC_N_CEILING_SUPPORT[65],
    description:
      'Gennemsnittet må højst være 65 kg N pr. ha harmoniareal. Til gengæld får de støtteberettigede arealer tillæg for reduceret N-tilførsel.',
    guidance:
      'Optimeringen holder bedriften på højst 65 kg N, og tillægget indgår i dækningsbidraget.',
  },
] as const

export function OrganicNCeilingChoice({ ceiling, disabled, onChange }: Props) {
  return (
    <ChoiceCards
      legend="Økologisk N-loft"
      name="scenario-organic-n-ceiling"
      options={OPTIONS}
      value={ceiling}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
