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
import {
  isSimulationKey,
  isSimulationResultsKey,
  isSimulationsFieldsKey,
  simulationsKey,
  simulationViewKey,
  useSimulations,
} from '@/api/hooks'
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
  canRecalculateEconomics,
  freeProfileName,
  isEconomicsCurrent,
  profileForSimulation,
  profileNameError,
  simulationsUsingProfile,
  STANDARD_PROFILE_ID,
  type EconomicsProfile,
} from '@/lib/economics-profiles'

type ModuleEdit = Partial<Pick<EconomicsModule, 'name' | 'overrides'>>

const PROFILE_GONE =
  'Profilen findes ikke længere. En, den er delt med, kan have slettet den.'

const REFRESH_INTERVAL_MS = 5000

// An edit is often followed by more; simulations that are behind their profile
// are recalculated once the profiles have been left alone this long.
const RECALCULATE_AFTER_EDIT_MS = 1500

const recalculationError = (error: unknown) => {
  const status = error instanceof ApiError ? error.status : null
  if (status === 409) {
    return 'Simuleringen er ændret eller regner allerede. Den er hentet igen, så prøv igen om lidt.'
  }
  if (status === 504) return 'Genberegningen tog for lang tid. Prøv igen.'
  return 'Økonomien kunne ikke genberegnes. Prøv igen.'
}

// What the automatic recalculation has tried: a simulation at one revision
// against the revision of the profile it was behind.
const attemptKey = (simulation: Simulation, profile: EconomicsProfile) =>
  `${simulation.id}:${simulation.revision}:${profile.revision}`

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
  const attempted = useRef(new Set<string>())
  const reconciling = useRef(false)
  const { data: simulations } = useSimulations(farmId)

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
    // A comparison reads the saved result out of the simulation's view, so it is
    // read again once the view has been. A recalculation that is done within its
    // request never shows the simulation as calculating, and would otherwise
    // leave the figures next to it as they were.
    await mutate(simulationViewKey(farmId, simulation.id))
    void mutate(
      (key) =>
        farmId !== undefined &&
        (isSimulationsFieldsKey(key, farmId) ||
          isSimulationResultsKey(key, farmId)),
    )
  }

  const recalculate = async (
    simulation: Simulation,
    { quiet = false }: { quiet?: boolean } = {},
  ) => {
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
      const conflict = error instanceof ApiError && error.status === 409
      if (!(quiet && conflict)) showError(recalculationError(error))
      await mutate(simulationsKey(farmId))
      return null
    }
  }

  // A simulation that is behind its profile, whether it was edited here or by
  // someone it is shared with, is recalculated without anyone pressing Genberegn,
  // so its figures and regnskab follow the profile. Each state is tried once; if
  // that fails, the warning on the simulation still offers Genberegn.
  useEffect(() => {
    if (!farmId || !moduleList || !simulations) return
    const timer = setTimeout(() => {
      if (reconciling.current) return
      const available = allProfiles(moduleList)
      const behind = simulations.flatMap((simulation) => {
        const selected = available.find(
          (profile) =>
            profile.id ===
            (simulation.economicsModuleId ?? STANDARD_PROFILE_ID),
        )
        return selected !== undefined &&
          canRecalculateEconomics(simulation) &&
          !isEconomicsCurrent(available, simulation) &&
          !attempted.current.has(attemptKey(simulation, selected))
          ? [{ simulation, selected }]
          : []
      })
      if (behind.length === 0) return
      reconciling.current = true
      void (async () => {
        try {
          for (const { simulation, selected } of behind) {
            attempted.current.add(attemptKey(simulation, selected))
            await recalculate(simulation, { quiet: true })
          }
        } finally {
          reconciling.current = false
        }
      })()
    }, RECALCULATE_AFTER_EDIT_MS)
    return () => clearTimeout(timer)
    // recalculate only reads refs and stable SWR functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, moduleList, simulations])

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
    // `recalculate` applies the profile at once, so the caller can wait for the
    // new figures instead of leaving it to the automatic recalculation.
    assignProfile: async (
      simulation: Simulation,
      profileId: string,
      { recalculate: apply = false }: { recalculate?: boolean } = {},
    ) => {
      let assigned = simulation
      if ((simulation.economicsModuleId ?? STANDARD_PROFILE_ID) !== profileId) {
        try {
          assigned = await selectSimulationEconomics(
            farm,
            simulation,
            profileId,
          )
          await refreshSimulation(assigned)
        } catch {
          showError('Profilen kunne ikke vælges. Prøv igen.')
          await mutate(simulationsKey(farmId))
          return
        }
      }
      const profile = known?.find((entry) => entry.id === profileId)
      if (!apply || !profile || isEconomicsCurrent(known, assigned)) return
      attempted.current.add(attemptKey(assigned, profile))
      await recalculate(assigned)
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
