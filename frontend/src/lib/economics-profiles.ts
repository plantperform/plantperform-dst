import type { EconomicsModule, Simulation } from '@/api/types'
import {
  formatChangeCount,
  formatCropCount,
  formatNameList,
  NO_OVERRIDES,
  sameOverrides,
} from '@/lib/economics'

export const STANDARD_SOURCE = 'SEGES Budgetkalkuler 2026'

export type EconomicsProfile = EconomicsModule

export const STANDARD_PROFILE_ID = 'standard'

export const STANDARD_PROFILE: EconomicsProfile = {
  id: STANDARD_PROFILE_ID,
  name: 'Standard (SEGES 2026)',
  overrides: NO_OVERRIDES,
  revision: 0,
}

export const allProfiles = (modules: EconomicsModule[]): EconomicsProfile[] => [
  STANDARD_PROFILE,
  ...modules.filter((module) => module.id !== STANDARD_PROFILE_ID),
]

type ProfiledSimulation = Pick<
  Simulation,
  'economicsModuleId' | 'economicsSnapshot'
>

const NOT_SHARED_NAME = 'En profil, der ikke er delt med dig'
const LOADING_NAME = 'Henter profilen'

export const appliedProfile = (
  { economicsSnapshot: snapshot }: ProfiledSimulation,
  profiles?: EconomicsProfile[],
): EconomicsProfile => {
  if (!snapshot) return STANDARD_PROFILE
  const known =
    snapshot.sourceId === STANDARD_PROFILE_ID
      ? STANDARD_PROFILE
      : profiles?.find((profile) => profile.id === snapshot.sourceId)
  return {
    id: snapshot.sourceId,
    name: known?.name ?? snapshot.name,
    overrides: snapshot.overrides,
    revision: snapshot.revision,
  }
}

export const profileForSimulation = (
  profiles: EconomicsProfile[] | undefined,
  simulation: ProfiledSimulation,
): EconomicsProfile => {
  const selectedId = simulation.economicsModuleId ?? STANDARD_PROFILE_ID
  const applied = appliedProfile(simulation, profiles)
  return (
    (profiles ?? [STANDARD_PROFILE]).find(
      (profile) => profile.id === selectedId,
    ) ??
    (applied.id === selectedId
      ? applied
      : {
          id: selectedId,
          name: profiles ? NOT_SHARED_NAME : LOADING_NAME,
          overrides: NO_OVERRIDES,
          revision: 0,
        })
  )
}

export const isEconomicsCurrent = (
  profiles: EconomicsProfile[] | undefined,
  simulation: ProfiledSimulation,
): boolean => {
  const selected = profileForSimulation(profiles, simulation)
  const applied = appliedProfile(simulation)
  return (
    selected.id === applied.id &&
    sameOverrides(selected.overrides, applied.overrides)
  )
}

export const simulationsUsingProfile = <T extends ProfiledSimulation>(
  simulations: T[],
  profileId: string,
): T[] =>
  simulations.filter(
    (simulation) =>
      (simulation.economicsModuleId ?? STANDARD_PROFILE_ID) === profileId,
  )

export const profilesInUse = (
  profiles: EconomicsProfile[],
  simulations: ProfiledSimulation[],
): EconomicsProfile[] =>
  profiles.filter(
    (profile) => simulationsUsingProfile(simulations, profile.id).length > 0,
  )

const comparableName = (name: string) => name.trim().toLocaleLowerCase('da-DK')

export const profileNameError = (
  profiles: EconomicsProfile[],
  name: string,
  profileId?: string,
): string | null => {
  if (name.trim() === '') return 'Giv profilen et navn.'
  const taken = profiles.some(
    (profile) =>
      profile.id !== profileId &&
      comparableName(profile.name) === comparableName(name),
  )
  return taken ? 'Der findes allerede en profil med det navn.' : null
}

export const freeProfileName = (
  profiles: EconomicsProfile[],
  baseName: string,
): string => {
  const taken = new Set(profiles.map((profile) => comparableName(profile.name)))
  let number = 1
  let name = baseName
  while (taken.has(comparableName(name))) {
    number += 1
    name = `${baseName} ${number}`
  }
  return name
}

export const PROFILE_USERS_ON_FARM = 'På bedriften bruges den af'

export const describeProfileUsers = (simulationNames: string[]): string =>
  simulationNames.length > 0
    ? `${PROFILE_USERS_ON_FARM} ${formatNameList(simulationNames)}`
    : 'Bruges ikke af nogen simulering på bedriften endnu'

export const deleteProfileMessage = (simulationNames: string[]): string =>
  `Profilen slettes for dig og alle, den er delt med. Simuleringer, der bruger den, går tilbage til Standard på alle bedrifter og får Standards tal, når økonomien er genberegnet.${
    simulationNames.length > 0
      ? ` På bedriften gælder det ${formatNameList(simulationNames)}.`
      : ''
  } Det kan ikke fortrydes.`

export const ECONOMICS_INVITATION =
  'Har bedriften en anden salgspris, et andet udbytte eller andre priser for markarbejdet, kan tallene rettes i en økonomiprofil.'

export const describeEconomicsLine = (ownProfileCount: number): string => {
  if (ownProfileCount === 0) return 'Simuleringerne regner med Standard.'
  return `Du har ${ownProfileCount} ${
    ownProfileCount === 1 ? 'egen økonomiprofil' : 'egne økonomiprofiler'
  } ud over Standard, og hver simulering regner med en af dem.`
}

export const describeOwnProfileCount = (count: number): string => {
  if (count === 0) return 'Kun Standard.'
  return `${count} ${count === 1 ? 'egen profil' : 'egne profiler'} ud over Standard, som du kan bruge på alle dine bedrifter.`
}

export const describeOwnProfiles = (names: string[]): string => {
  if (names.length === 0) return 'Kun Standard'
  if (names.length <= 2) return formatNameList(names)
  return `${names[0]} og ${names.length - 1} mere`
}

export const describeProfileOption = (
  profileId: string,
  changeCount: number | null,
  simulationNames: string[],
): string => {
  if (profileId === STANDARD_PROFILE_ID) {
    return `${STANDARD_SOURCE} · kan ikke rettes`
  }
  const users =
    simulationNames.length > 0
      ? `bruges af ${formatNameList(simulationNames)}`
      : null
  return [changeCount === null ? null : formatChangeCount(changeCount), users]
    .filter((part) => part !== null)
    .join(' · ')
}

export const describeStandard = (
  cropCount: number,
  simulationNames: string[],
): string =>
  `Priser og mængder fra ${STANDARD_SOURCE} for ${formatCropCount(cropCount)}. Standarden kan ikke rettes, og dine egne profiler måles mod den. ${describeProfileUsers(['afgrødehistorikken', ...simulationNames])}.`

export const sharedProfileNote = (simulationCount: number): string | null => {
  if (simulationCount < 2) return null
  return simulationCount === 2
    ? 'En rettelse gælder for begge simuleringer, når de er genberegnet.'
    : `En rettelse gælder for alle ${simulationCount} simuleringer, når de er genberegnet.`
}

export const describeAppliedProfile = (
  profiles: EconomicsProfile[],
  simulation: ProfiledSimulation & Pick<Simulation, 'name'>,
): string => {
  const selected = profileForSimulation(profiles, simulation)
  const applied = appliedProfile(simulation, profiles)
  if (!profiles.some((profile) => profile.id === selected.id)) {
    return `${simulation.name} er regnet med ${applied.name}. Den valgte profil er ikke delt med dig, så vælg en af dine egne for at genberegne.`
  }
  return selected.id === applied.id
    ? `${applied.name} er rettet, siden ${simulation.name} blev regnet. Genberegn økonomien for at bruge rettelserne.`
    : `${simulation.name} er regnet med ${applied.name}. Genberegn økonomien for at bruge ${selected.name}.`
}
