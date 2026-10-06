import { z } from 'zod'

import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'

export type EconomicsProfile = {
  id: string
  name: string
  overrides: EconomicsOverrides
  copiedFromId?: string
}

export type EconomicsProfiles = {
  profiles: EconomicsProfile[]
  simulationProfileIds: Readonly<Record<string, string>>
}

export const STANDARD_PROFILE_ID = 'standard'

export const STANDARD_PROFILE: EconomicsProfile = {
  id: STANDARD_PROFILE_ID,
  name: 'Standard (SEGES 2026)',
  overrides: NO_OVERRIDES,
}

export const NO_PROFILES: EconomicsProfiles = {
  profiles: [],
  simulationProfileIds: {},
}

export const allProfiles = (state: EconomicsProfiles): EconomicsProfile[] => [
  STANDARD_PROFILE,
  ...state.profiles,
]

export const findProfile = (
  state: EconomicsProfiles,
  profileId: string,
): EconomicsProfile | undefined =>
  allProfiles(state).find((profile) => profile.id === profileId)

export const profileForSimulation = (
  state: EconomicsProfiles,
  simulationId: string,
): EconomicsProfile =>
  findProfile(
    state,
    state.simulationProfileIds[simulationId] ?? STANDARD_PROFILE_ID,
  ) ?? STANDARD_PROFILE

export const simulationsUsingProfile = <T extends { id: string }>(
  state: EconomicsProfiles,
  simulations: T[],
  profileId: string,
): T[] =>
  simulations.filter(
    (simulation) => profileForSimulation(state, simulation.id).id === profileId,
  )

const comparableName = (name: string) => name.trim().toLocaleLowerCase('da-DK')

export const profileNameError = (
  state: EconomicsProfiles,
  name: string,
  profileId?: string,
): string | null => {
  if (name.trim() === '') return 'Giv profilen et navn.'
  const taken = allProfiles(state).some(
    (profile) =>
      profile.id !== profileId &&
      comparableName(profile.name) === comparableName(name),
  )
  return taken ? 'Der findes allerede en profil med det navn.' : null
}

export const deleteProfileMessage = (simulationCount: number): string => {
  if (simulationCount === 0) return 'Ingen simuleringer bruger profilen.'
  return simulationCount === 1
    ? '1 simulering bruger profilen og går tilbage til Standard. Vælg eventuelt en anden profil til den først.'
    : `${simulationCount} simuleringer bruger profilen og går tilbage til Standard. Vælg eventuelt en anden profil til dem først.`
}

export const sharedProfileNote = (simulationCount: number): string | null => {
  if (simulationCount < 2) return null
  return simulationCount === 2
    ? 'En rettelse gælder for begge simuleringer.'
    : `En rettelse gælder for alle ${simulationCount} simuleringer.`
}

const freeProfileName = (state: EconomicsProfiles, baseName: string) => {
  const taken = new Set(
    allProfiles(state).map((profile) => comparableName(profile.name)),
  )
  let number = 1
  let name = baseName
  while (taken.has(comparableName(name))) {
    number += 1
    name = `${baseName} ${number}`
  }
  return name
}

export const withNewProfile = (
  state: EconomicsProfiles,
  profileId: string,
  baseName: string,
): EconomicsProfiles => ({
  ...state,
  profiles: [
    ...state.profiles,
    {
      id: profileId,
      name: freeProfileName(state, baseName),
      overrides: NO_OVERRIDES,
    },
  ],
})

export const withProfileCopy = (
  state: EconomicsProfiles,
  sourceId: string,
  profileId: string,
): EconomicsProfiles => {
  const source = state.profiles.find((profile) => profile.id === sourceId)
  if (!source) return state
  return {
    ...state,
    profiles: [
      ...state.profiles,
      {
        id: profileId,
        name: freeProfileName(state, `${source.name} (kopi)`),
        overrides: source.overrides,
        copiedFromId: source.id,
      },
    ],
  }
}

const withProfile = (
  state: EconomicsProfiles,
  profileId: string,
  change: (profile: EconomicsProfile) => EconomicsProfile,
): EconomicsProfiles => ({
  ...state,
  profiles: state.profiles.map((profile) =>
    profile.id === profileId ? change(profile) : profile,
  ),
})

export const withProfileName = (
  state: EconomicsProfiles,
  profileId: string,
  name: string,
): EconomicsProfiles =>
  withProfile(state, profileId, (profile) => ({
    ...profile,
    name: name.trim(),
  }))

export const withProfileOverrides = (
  state: EconomicsProfiles,
  profileId: string,
  overrides: EconomicsOverrides,
): EconomicsProfiles =>
  withProfile(state, profileId, (profile) => ({ ...profile, overrides }))

const linksWhere = (
  links: Readonly<Record<string, string>>,
  keep: (simulationId: string, profileId: string) => boolean,
) =>
  Object.fromEntries(
    Object.entries(links).filter(([simulationId, profileId]) =>
      keep(simulationId, profileId),
    ),
  )

export const withoutProfile = (
  state: EconomicsProfiles,
  profileId: string,
): EconomicsProfiles => ({
  profiles: state.profiles.filter((profile) => profile.id !== profileId),
  simulationProfileIds: linksWhere(
    state.simulationProfileIds,
    (_, linkedId) => linkedId !== profileId,
  ),
})

export const withSimulationProfile = (
  state: EconomicsProfiles,
  simulationId: string,
  profileId: string,
): EconomicsProfiles => {
  const links = linksWhere(
    state.simulationProfileIds,
    (linkedSimulationId) => linkedSimulationId !== simulationId,
  )
  const isFarmProfile = state.profiles.some(
    (profile) => profile.id === profileId,
  )
  return {
    ...state,
    simulationProfileIds: isFarmProfile
      ? { ...links, [simulationId]: profileId }
      : links,
  }
}

const storedProfilesSchema = z.object({
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1),
      overrides: z.object({
        prices: z.record(z.string(), z.number()),
        quantities: z.record(z.string(), z.number()),
        yieldPct: z.record(z.string(), z.number()).default({}),
      }),
      copiedFromId: z.string().optional(),
    }),
  ),
  simulationProfileIds: z.record(z.string(), z.string()),
})

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const parseStoredProfiles = (text: string | null): EconomicsProfiles => {
  const stored = storedProfilesSchema.safeParse(
    text === null ? null : parseJson(text),
  )
  if (!stored.success) return NO_PROFILES
  const profiles = stored.data.profiles.filter(
    (profile) => profile.id !== STANDARD_PROFILE_ID,
  )
  const profileIds = new Set(profiles.map((profile) => profile.id))
  return {
    profiles,
    simulationProfileIds: linksWhere(
      stored.data.simulationProfileIds,
      (_, profileId) => profileIds.has(profileId),
    ),
  }
}
