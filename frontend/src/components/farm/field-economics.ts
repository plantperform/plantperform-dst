import { createContext } from 'react'

import { useFarmBudgets } from '@/api/economics'
import type { FieldRecord, Simulation } from '@/api/types'
import {
  useCalculationReturn,
  type FieldReturnTarget,
} from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import type { EconomicsAssumptions } from '@/lib/economics'
import {
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { fieldTitle } from '@/lib/field-domain'

type FieldEconomics = {
  assumptions: EconomicsAssumptions | undefined
  profile: EconomicsProfile
  profilePath: string
  returnTo: FieldReturnTarget
  openAtYearIndex: number | undefined
  onOpenedAtYear: () => void
}

export const FieldEconomicsContext = createContext<FieldEconomics | null>(null)

export const useFieldEconomics = (
  field: FieldRecord,
  simulation: Simulation | undefined,
): FieldEconomics => {
  const economics = useEconomicsProfiles()
  const [openAtYearIndex, onOpenedAtYear] = useCalculationReturn(field.id)
  const profile = simulation
    ? economics.appliedProfile(simulation)
    : STANDARD_PROFILE
  const { data: assumptions } = useFarmBudgets(
    simulation && profile.id !== STANDARD_PROFILE_ID
      ? economics.farmId
      : undefined,
    { simulationId: simulation?.id ?? '' },
  )
  return {
    assumptions,
    profile,
    profilePath: economics.profilePath(profile.id),
    returnTo: {
      kind: 'field',
      simulationId: simulation?.id ?? null,
      fieldId: field.id,
      name: `${fieldTitle(field)} i ${simulation?.name ?? 'Afgrødehistorik'}`,
      calculationYearIndex: null,
    },
    openAtYearIndex,
    onOpenedAtYear,
  }
}
