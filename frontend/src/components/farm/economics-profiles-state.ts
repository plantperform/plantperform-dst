import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { NO_OVERRIDES, type OverridesChange } from '@/lib/economics'
import { EXAMPLE_ECONOMICS } from '@/lib/economics-example'
import {
  NO_PROFILES,
  allProfiles,
  findProfile,
  freeProfileName,
  parseStoredProfiles,
  profileForSimulation,
  profileNameError,
  simulationsUsingProfile,
  withNewProfile,
  withProfileName,
  withProfileOverrides,
  withSimulationProfile,
  withoutProfile,
  type EconomicsProfiles,
} from '@/lib/economics-profiles'

const storageKey = (farmId: string) =>
  `plantperform.economicsProfiles.${farmId}`

const readStoredProfiles = (farmId: string | undefined): EconomicsProfiles => {
  if (!farmId) return NO_PROFILES
  try {
    return parseStoredProfiles(window.localStorage.getItem(storageKey(farmId)))
  } catch {
    return NO_PROFILES
  }
}

const writeStoredProfiles = (
  farmId: string | undefined,
  state: EconomicsProfiles,
) => {
  if (!farmId) return
  try {
    window.localStorage.setItem(storageKey(farmId), JSON.stringify(state))
  } catch {
    return
  }
}

export const useEconomicsProfilesStore = (farmId: string | undefined) => {
  const [stored, setStored] = useState(() => ({
    farmId,
    state: readStoredProfiles(farmId),
    changed: false,
  }))
  if (stored.farmId !== farmId) {
    setStored({ farmId, state: readStoredProfiles(farmId), changed: false })
  }

  useEffect(() => {
    if (stored.changed) writeStoredProfiles(stored.farmId, stored.state)
  }, [stored])

  return useMemo(() => {
    const { state } = stored
    const update = (
      change: (current: EconomicsProfiles) => EconomicsProfiles,
    ) =>
      setStored((current) => ({
        ...current,
        state: change(current.state),
        changed: true,
      }))

    return {
      assumptions: EXAMPLE_ECONOMICS,
      profiles: allProfiles(state),
      ownProfiles: state.profiles,
      overviewPath: `/farms/${stored.farmId}/economics`,
      profilePath: (profileId: string) =>
        `/farms/${stored.farmId}/economics/${profileId}`,
      guidePath: (profileId: string) =>
        `/farms/${stored.farmId}/economics/${profileId}/guide`,
      findProfile: (profileId: string) => findProfile(state, profileId),
      profileForSimulation: (simulationId: string) =>
        profileForSimulation(state, simulationId),
      simulationsUsingProfile: <T extends { id: string }>(
        simulations: T[],
        profileId: string,
      ) => simulationsUsingProfile(state, simulations, profileId),
      nameError: (name: string, profileId?: string) =>
        profileNameError(state, name, profileId),
      newProfileName: (baseName: string) => freeProfileName(state, baseName),
      ensureProfile: (profileId: string, name: string) =>
        update((current) => withNewProfile(current, profileId, name)),
      renameProfile: (profileId: string, name: string) =>
        update((current) => withProfileName(current, profileId, name)),
      deleteProfile: (profileId: string) =>
        update((current) => withoutProfile(current, profileId)),
      changeOverrides: (profileId: string, change: OverridesChange) =>
        update((current) =>
          withProfileOverrides(
            current,
            profileId,
            change(findProfile(current, profileId)?.overrides ?? NO_OVERRIDES),
          ),
        ),
      assignProfile: (simulationId: string, profileId: string) =>
        update((current) =>
          withSimulationProfile(current, simulationId, profileId),
        ),
    }
  }, [stored])
}

export type EconomicsProfilesStore = ReturnType<
  typeof useEconomicsProfilesStore
>

export const EconomicsProfilesContext =
  createContext<EconomicsProfilesStore | null>(null)

export const useEconomicsProfiles = () => {
  const context = useContext(EconomicsProfilesContext)
  if (!context) {
    throw new Error(
      'Economics profiles must be used inside EconomicsProfilesContext',
    )
  }
  return context
}
