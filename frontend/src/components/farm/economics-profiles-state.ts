import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'

import { ApiError } from '@/api/client'
import {
  createEconomicsModule,
  deleteEconomicsModule,
  economicsModulesKey,
  recalculateSimulationEconomics,
  selectSimulationEconomics,
  updateEconomicsModule,
  useEconomicsModules,
  useFarmBudgets,
} from '@/api/economics'
import { isSimulationKey, simulationsKey, simulationViewKey } from '@/api/hooks'
import type { EconomicsModule, FarmingSystem, Simulation } from '@/api/types'
import { useToast } from '@/components/toast'
import {
  creationRequestIdentity,
  type CreationRequestIdentity,
} from '@/lib/simulation-creation'
import {
  NO_OVERRIDES,
  sameOverrides,
  type OverridesChange,
} from '@/lib/economics'
import {
  allProfiles,
  appliedProfile,
  freeProfileName,
  isEconomicsCurrent,
  profileForSimulation,
  profileNameError,
  simulationsUsingProfile,
  STANDARD_PROFILE_ID,
} from '@/lib/economics-profiles'

type ModuleEdit = Partial<Pick<EconomicsModule, 'name' | 'overrides'>>

const PROFILE_GONE =
  'Profilen findes ikke længere. En, den er delt med, kan have slettet den.'

const REFRESH_INTERVAL_MS = 5000

const recalculationError = (error: unknown) => {
  const status = error instanceof ApiError ? error.status : null
  if (status === 409) {
    return 'Simuleringen er ændret eller regner allerede. Den er hentet igen, så prøv igen om lidt.'
  }
  if (status === 504) return 'Genberegningen tog for lang tid. Prøv igen.'
  return 'Økonomien kunne ikke genberegnes. Prøv igen.'
}

export const useEconomicsProfilesStore = (farmId: string | undefined) => {
  const [farmingSystem, setFarmingSystem] =
    useState<FarmingSystem>('Konventionel')
  const {
    data: moduleList,
    error: modulesError,
    isValidating: reloading,
    mutate: mutateModules,
  } = useEconomicsModules()
  const { cache, mutate } = useSWRConfig()
  const { showError } = useToast()
  const saving = useRef(new Map<string, Promise<boolean>>())
  const recalculations = useRef(new Map<string, CreationRequestIdentity>())

  useEffect(() => {
    let refreshedAt = 0
    const refresh = () => {
      if (
        document.visibilityState !== 'visible' ||
        Date.now() - refreshedAt < REFRESH_INTERVAL_MS
      ) {
        return
      }
      refreshedAt = Date.now()
      void Promise.all(saving.current.values()).then(() => mutateModules())
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [mutateModules])

  const farm = farmId ?? ''
  const profiles = allProfiles(moduleList ?? [])
  const known = moduleList === undefined ? undefined : profiles
  const cachedModule = (profileId: string) =>
    (
      cache.get(economicsModulesKey)?.data as EconomicsModule[] | undefined
    )?.find((module) => module.id === profileId)
  const withModule = (
    profileId: string,
    change: (module: EconomicsModule) => EconomicsModule,
  ) =>
    mutateModules(
      (current = []) =>
        current.map((module) =>
          module.id === profileId ? change(module) : module,
        ),
      { revalidate: false },
    )
  const forgetProfile = (profileId: string) =>
    mutateModules(
      (current = []) => current.filter((module) => module.id !== profileId),
      { revalidate: false },
    )

  const editModule = (
    profileId: string,
    edit: (module: EconomicsModule) => ModuleEdit,
  ): Promise<boolean> => {
    const before = cachedModule(profileId)
    if (!before) return Promise.resolve(false)
    const edited = { ...before, ...edit(before) }
    if (
      edited.name === before.name &&
      sameOverrides(edited.overrides, before.overrides)
    ) {
      return Promise.resolve(true)
    }
    void withModule(profileId, () => edited)
    const saved = (saving.current.get(profileId) ?? Promise.resolve(true)).then(
      async () => {
        const module = cachedModule(profileId)
        if (!module) return false
        try {
          const stored = await updateEconomicsModule(profileId, {
            expectedRevision: module.revision,
            name: module.name,
            overrides: module.overrides,
          })
          const latest = saving.current.get(profileId) === saved
          await withModule(profileId, (current) =>
            latest ? stored : { ...current, revision: stored.revision },
          )
          return true
        } catch (error) {
          const status = error instanceof ApiError ? error.status : null
          if (status === 404) {
            showError(PROFILE_GONE)
            await forgetProfile(profileId)
            return false
          }
          showError(
            status === 409
              ? 'Profilen er rettet et andet sted. Den er hentet igen, så prøv rettelsen igen.'
              : 'Rettelsen kunne ikke gemmes. Prøv igen.',
          )
          await mutateModules()
          return false
        }
      },
    )
    saving.current.set(profileId, saved)
    return saved
  }

  const refreshSimulation = async (simulation: Simulation) => {
    await mutate(
      simulationsKey(farmId),
      (current: Simulation[] = []) =>
        current.map((entry) =>
          entry.id === simulation.id ? simulation : entry,
        ),
      { revalidate: false },
    )
    void mutate(simulationViewKey(farmId, simulation.id))
  }

  const recalculate = async (simulation: Simulation) => {
    const saved = await saving.current.get(
      simulation.economicsModuleId ?? STANDARD_PROFILE_ID,
    )
    if (saved === false) return null
    const identity = creationRequestIdentity(
      { id: simulation.id, revision: simulation.revision },
      recalculations.current.get(simulation.id) ?? null,
    )
    recalculations.current.set(simulation.id, identity)
    try {
      const recalculated = await recalculateSimulationEconomics(
        farm,
        simulation,
        identity.requestId,
      )
      recalculations.current.delete(simulation.id)
      await refreshSimulation(recalculated)
      return recalculated
    } catch (error) {
      showError(recalculationError(error))
      await mutate(simulationsKey(farmId))
      return null
    }
  }

  return {
    farmId,
    farmingSystem,
    setFarmingSystem,
    ready: moduleList !== undefined,
    loadError: modulesError as unknown,
    reloading,
    reload: () => mutateModules(),
    profiles,
    ownProfiles: known?.filter((profile) => profile.id !== STANDARD_PROFILE_ID),
    overviewPath: `/farms/${farmId}/economics`,
    profilePath: (profileId: string) =>
      `/farms/${farmId}/economics/${profileId}`,
    guidePath: (profileId: string) =>
      `/farms/${farmId}/economics/${profileId}/guide`,
    findProfile: (profileId: string) =>
      profiles.find((profile) => profile.id === profileId),
    appliedProfile: (simulation: Pick<Simulation, 'economicsSnapshot'>) =>
      appliedProfile(simulation, known),
    profileForSimulation: (simulation: Simulation) =>
      profileForSimulation(known, simulation),
    isEconomicsCurrent: (simulation: Simulation) =>
      isEconomicsCurrent(known, simulation),
    simulationsUsingProfile,
    nameError: (name: string, profileId?: string) =>
      profileNameError(profiles, name, profileId),
    newProfileName: (baseName: string) => freeProfileName(profiles, baseName),
    saveProfile: async (
      profileId: string,
      name: string,
      change: OverridesChange,
    ): Promise<string | null> => {
      if (cachedModule(profileId)) {
        const saved = await editModule(profileId, (module) => ({
          name: name.trim(),
          overrides: change(module.overrides),
        }))
        return saved ? profileId : null
      }
      try {
        const created = await createEconomicsModule(
          name.trim(),
          change(NO_OVERRIDES),
        )
        await mutateModules((current = []) => [...current, created], {
          revalidate: false,
        })
        return created.id
      } catch {
        showError('Profilen kunne ikke gemmes. Prøv igen.')
        return null
      }
    },
    renameProfile: (profileId: string, name: string) =>
      editModule(profileId, () => ({ name: name.trim() })),
    changeOverrides: (profileId: string, change: OverridesChange) =>
      editModule(profileId, (module) => ({
        overrides: change(module.overrides),
      })),
    deleteProfile: async (profileId: string) => {
      await saving.current.get(profileId)
      try {
        await deleteEconomicsModule(profileId)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : null
        if (status !== 404) {
          showError(
            status === 409
              ? 'En simulering med profilen regner lige nu. Prøv igen, når den er færdig.'
              : 'Profilen kunne ikke slettes. Prøv igen.',
          )
          await mutateModules()
          return false
        }
      }
      await forgetProfile(profileId)
      void mutate(isSimulationKey)
      return true
    },
    forgetProfile,
    assignProfile: async (simulation: Simulation, profileId: string) => {
      if ((simulation.economicsModuleId ?? STANDARD_PROFILE_ID) === profileId) {
        return
      }
      try {
        await refreshSimulation(
          await selectSimulationEconomics(farm, simulation, profileId),
        )
      } catch {
        showError('Profilen kunne ikke vælges. Prøv igen.')
        await mutate(simulationsKey(farmId))
      }
    },
    recalculate,
    withCurrentEconomics: async (simulation: Simulation) => {
      await Promise.all(saving.current.values())
      const fresh = await mutateModules()
      return isEconomicsCurrent(fresh && allProfiles(fresh), simulation)
        ? simulation
        : recalculate(simulation)
    },
  }
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

export const useEconomicsAssumptions = (farmingSystem?: FarmingSystem) => {
  const economics = useEconomicsProfiles()
  return useFarmBudgets(economics.farmId, {
    farmingSystem: farmingSystem ?? economics.farmingSystem,
  })
}
