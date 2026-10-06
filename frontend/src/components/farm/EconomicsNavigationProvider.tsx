import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useFarm } from '@/api/hooks'
import {
  EconomicsNavigationContext,
  type GuideStart,
} from '@/components/farm/economics-navigation'
import { useEconomicsProfiles } from '@/components/farm/economics-profiles-state'
import { STANDARD_PROFILE_ID } from '@/lib/economics-profiles'
import { ROTATION_START_CALENDAR_YEAR } from '@/lib/field-domain'

type EconomicsNavigationProviderProps = {
  farmId: string | undefined
  children: ReactNode
}

export const EconomicsNavigationProvider = ({
  farmId,
  children,
}: EconomicsNavigationProviderProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const economics = useEconomicsProfiles()
  const { data: farm } = useFarm(farmId)

  const startGuide = ({ fromProfileId, simulationId, copy }: GuideStart) => {
    const source = economics.findProfile(fromProfileId)
    const fromStandard = !source || source.id === STANDARD_PROFILE_ID
    const profileId = fromStandard
      ? economics.createProfile(
          `${farm?.name ?? 'Bedriften'} ${ROTATION_START_CALENDAR_YEAR}`,
        )
      : copy
        ? economics.copyProfile(source.id)
        : source.id
    navigate(economics.guidePath(profileId), {
      state: {
        guide: {
          created: fromStandard || copy === true,
          simulationId: simulationId ?? null,
          returnTo: `${location.pathname}${location.search}`,
        },
      },
    })
  }

  return (
    <EconomicsNavigationContext.Provider value={{ startGuide }}>
      {children}
    </EconomicsNavigationContext.Provider>
  )
}
