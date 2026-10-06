import { createContext } from 'react'

import type { FieldRecord, Simulation } from '@/api/types'
import type { FieldReturnTarget } from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import type { EconomicsAssumptions } from '@/lib/economics'
import {
  STANDARD_PROFILE,
  type EconomicsProfile,
} from '@/lib/economics-profiles'
import { fieldTitle } from '@/lib/field-domain'

export type BreakdownEconomics = {
  assumptions: EconomicsAssumptions
  profile: EconomicsProfile
  profilePath: string
  returnTo: FieldReturnTarget
}

export const BreakdownEconomicsContext =
  createContext<BreakdownEconomics | null>(null)

export const useFieldEconomics = (
  field: FieldRecord,
  simulation: Simulation | undefined,
): BreakdownEconomics => {
  const economics = useEconomicsProfiles()
  const profile = simulation
    ? economics.profileForSimulation(simulation.id)
    : STANDARD_PROFILE
  return {
    assumptions: economics.assumptions,
    profile,
    profilePath: economics.profilePath(profile.id),
    returnTo: {
      kind: 'field',
      simulationId: simulation?.id ?? null,
      fieldId: field.id,
      label: `Tilbage til ${fieldTitle(field)} i ${simulation?.name ?? 'Afgrødehistorik'}`,
      calculationYearIndex: null,
    },
  }
}
