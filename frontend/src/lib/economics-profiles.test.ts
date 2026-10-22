import { describe, expect, it } from 'vitest'

import type { EconomicsModule } from '@/api/types'
import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import {
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  allProfiles,
  appliedProfile,
  deleteProfileMessage,
  describeAppliedProfile,
  describeEconomicsLine,
  describeOwnProfileCount,
  describeOwnProfiles,
  describeProfileOption,
  describeProfileUsers,
  describeStandard,
  freeProfileName,
  isEconomicsCurrent,
  profileForSimulation,
  profileNameError,
  profilesInUse,
  sharedProfileNote,
  simulationsUsingProfile,
} from '@/lib/economics-profiles'

const barleyPrice = (value: number): EconomicsOverrides => ({
  prices: { 'sale:1': value },
  quantities: {},
  yieldPct: {},
})

const MODULES: EconomicsModule[] = [
  {
    id: STANDARD_PROFILE_ID,
    name: 'Standard (SEGES 2026)',
    revision: 0,
    overrides: NO_OVERRIDES,
  },
  {
    id: 'careful',
    name: 'Forsigtig 2027',
    revision: 3,
    overrides: barleyPrice(125),
  },
  {
    id: 'machines',
    name: 'Egen maskinstation',
    revision: 0,
    overrides: NO_OVERRIDES,
  },
]
const PROFILES = allProfiles(MODULES)

const snapshot = (
  sourceId: string,
  name: string,
  revision: number,
  overrides = NO_OVERRIDES,
) => ({ sourceId, name, revision, overrides })

const CURRENT = {
  name: 'Reduceret kvælstof',
  economicsModuleId: 'careful',
  economicsSnapshot: snapshot('careful', 'Forsigtig 2027', 3, barleyPrice(125)),
}

describe('economics profiles', () => {
  it('lists Standard first and then the modules', () => {
    expect(PROFILES.map((profile) => profile.name)).toEqual([
      'Standard (SEGES 2026)',
      'Forsigtig 2027',
      'Egen maskinstation',
    ])
    expect(allProfiles([])).toEqual([STANDARD_PROFILE])
  })

  it('gives a simulation its chosen profile and the one its figures use', () => {
    expect(profileForSimulation(PROFILES, CURRENT).id).toBe('careful')
    expect(profileForSimulation(PROFILES, {})).toBe(STANDARD_PROFILE)
    expect(appliedProfile({})).toBe(STANDARD_PROFILE)
    expect(appliedProfile(CURRENT)).toMatchObject({
      id: 'careful',
      revision: 3,
    })
  })

  it('names a profile the user cannot open by the name it was calculated with', () => {
    const notShared = {
      economicsModuleId: 'theirs',
      economicsSnapshot: snapshot(
        'theirs',
        'Naboens priser',
        2,
        barleyPrice(125),
      ),
    }
    expect(profileForSimulation(PROFILES, notShared)).toMatchObject({
      id: 'theirs',
      name: 'Naboens priser',
      overrides: barleyPrice(125),
    })
    expect(appliedProfile(notShared, PROFILES).name).toBe('Naboens priser')
    expect(isEconomicsCurrent(PROFILES, notShared)).toBe(true)
    expect(profileForSimulation(undefined, notShared).name).toBe(
      'Naboens priser',
    )
    expect(
      profileForSimulation(PROFILES, {
        economicsModuleId: 'theirs',
        economicsSnapshot: snapshot(STANDARD_PROFILE_ID, 'Standard', 0),
      }).name,
    ).toBe('En profil, der ikke er delt med dig')
  })

  it('knows when the figures still use the chosen profile', () => {
    expect(isEconomicsCurrent(PROFILES, CURRENT)).toBe(true)
    expect(isEconomicsCurrent(PROFILES, {})).toBe(true)
    const renamed = {
      ...CURRENT,
      economicsSnapshot: snapshot('careful', 'Forsigtig', 2, barleyPrice(125)),
    }
    expect(isEconomicsCurrent(PROFILES, renamed)).toBe(true)
    const edited = {
      ...CURRENT,
      economicsSnapshot: snapshot('careful', 'Forsigtig 2027', 2),
    }
    expect(isEconomicsCurrent(PROFILES, edited)).toBe(false)
    expect(describeAppliedProfile(PROFILES, edited)).toBe(
      'Forsigtig 2027 er rettet, siden Reduceret kvælstof blev regnet. Genberegn økonomien for at bruge rettelserne.',
    )
    const switched = { ...CURRENT, economicsModuleId: 'machines' }
    expect(isEconomicsCurrent(PROFILES, switched)).toBe(false)
    expect(describeAppliedProfile(PROFILES, switched)).toBe(
      'Reduceret kvælstof er regnet med Forsigtig 2027. Genberegn økonomien for at bruge Egen maskinstation.',
    )
    const deleted = {
      ...CURRENT,
      economicsModuleId: STANDARD_PROFILE_ID,
      economicsSnapshot: snapshot('gone', 'Gammelt navn', 2),
    }
    expect(describeAppliedProfile(PROFILES, deleted)).toBe(
      'Reduceret kvælstof er regnet med Gammelt navn. Genberegn økonomien for at bruge Standard (SEGES 2026).',
    )
    const hidden = { ...CURRENT, economicsModuleId: 'not-shared' }
    expect(describeAppliedProfile(PROFILES, hidden)).toBe(
      'Reduceret kvælstof er regnet med Forsigtig 2027. Den valgte profil er ikke delt med dig, så vælg en af dine egne for at genberegne.',
    )
  })

  it('finds the simulations that use a profile, Standard included', () => {
    const simulations = [
      { id: 'sim-a', economicsModuleId: 'careful' },
      { id: 'sim-b' },
    ]
    expect(simulationsUsingProfile(simulations, 'careful')).toEqual([
      simulations[0],
    ])
    expect(simulationsUsingProfile(simulations, STANDARD_PROFILE_ID)).toEqual([
      simulations[1],
    ])
    expect(simulationsUsingProfile(simulations, 'machines')).toEqual([])
  })

  it('finds the profiles that simulations on the farm use', () => {
    const simulations = [
      { economicsModuleId: 'careful' },
      { economicsModuleId: 'careful' },
      {},
    ]
    expect(
      profilesInUse(PROFILES.slice(1), simulations).map((entry) => entry.id),
    ).toEqual(['careful'])
    expect(profilesInUse(PROFILES.slice(1), [])).toEqual([])
  })

  it('suggests the first free name for a new profile', () => {
    expect(freeProfileName(PROFILES, 'Bakkegården 2027')).toBe(
      'Bakkegården 2027',
    )
    expect(freeProfileName(PROFILES, 'forsigtig 2027')).toBe('forsigtig 2027 2')
  })

  it('wants a name that no other profile has', () => {
    expect(profileNameError(PROFILES, '   ')).toBe('Giv profilen et navn.')
    expect(profileNameError(PROFILES, ' forsigtig 2027 ')).toBe(
      'Der findes allerede en profil med det navn.',
    )
    expect(profileNameError(PROFILES, 'STANDARD (SEGES 2026)')).toBe(
      'Der findes allerede en profil med det navn.',
    )
    expect(profileNameError(PROFILES, 'Forsigtig 2027', 'careful')).toBeNull()
    expect(profileNameError(PROFILES, 'Optimistisk')).toBeNull()
  })

  it('says that simulations on every farm go back to Standard when a profile is deleted', () => {
    expect(deleteProfileMessage([])).toBe(
      'Profilen slettes for dig og alle, den er delt med. Simuleringer, der bruger den, går tilbage til Standard på alle bedrifter og får Standards tal, når økonomien er genberegnet. Det kan ikke fortrydes.',
    )
    expect(deleteProfileMessage(['Reduceret kvælstof', 'Mere vintersæd'])).toBe(
      'Profilen slettes for dig og alle, den er delt med. Simuleringer, der bruger den, går tilbage til Standard på alle bedrifter og får Standards tal, når økonomien er genberegnet. På bedriften gælder det Reduceret kvælstof og Mere vintersæd. Det kan ikke fortrydes.',
    )
  })

  it('sums up the profiles above the simulations', () => {
    expect(describeEconomicsLine(0)).toBe('Simuleringerne regner med Standard.')
    expect(describeEconomicsLine(1)).toBe(
      'Du har 1 egen økonomiprofil ud over Standard, og hver simulering regner med en af dem.',
    )
    expect(describeEconomicsLine(2)).toBe(
      'Du har 2 egne økonomiprofiler ud over Standard, og hver simulering regner med en af dem.',
    )
  })

  it('describes a profile where a simulation chooses it', () => {
    expect(
      describeProfileOption(STANDARD_PROFILE_ID, 0, ['Mere vintersæd']),
    ).toBe('SEGES Budgetkalkuler 2026 · kan ikke rettes')
    expect(describeProfileOption('careful', 3, [])).toBe('3 ændringer')
    expect(
      describeProfileOption('careful', 1, ['Reduceret kvælstof', 'Kopi']),
    ).toBe('1 ændring · bruges af Reduceret kvælstof og Kopi')
    expect(describeProfileOption('careful', null, ['Kopi'])).toBe(
      'bruges af Kopi',
    )
  })

  it('names the simulations on the farm that use a profile', () => {
    expect(describeProfileUsers([])).toBe(
      'Bruges ikke af nogen simulering på bedriften endnu',
    )
    expect(describeProfileUsers(['Reduceret kvælstof', 'Kopi'])).toBe(
      'På bedriften bruges den af Reduceret kvælstof og Kopi',
    )
  })

  it('introduces Standard above the profile cards', () => {
    expect(describeStandard(6, ['Mere vintersæd'])).toBe(
      'Priser og mængder fra SEGES Budgetkalkuler 2026 for 6 afgrøder. Standarden kan ikke rettes, og dine egne profiler måles mod den. På bedriften bruges den af Mere vintersæd.',
    )
  })

  it('says that a change reaches every simulation that shares the profile once recalculated', () => {
    expect(sharedProfileNote(0)).toBeNull()
    expect(sharedProfileNote(1)).toBeNull()
    expect(sharedProfileNote(2)).toBe(
      'En rettelse gælder for begge simuleringer, når de er genberegnet.',
    )
    expect(sharedProfileNote(3)).toBe(
      'En rettelse gælder for alle 3 simuleringer, når de er genberegnet.',
    )
  })

  it('counts the own profiles next to Standard', () => {
    expect(describeOwnProfileCount(0)).toBe('Kun Standard.')
    expect(describeOwnProfileCount(1)).toBe(
      '1 egen profil ud over Standard, som du kan bruge på alle dine bedrifter.',
    )
    expect(describeOwnProfileCount(2)).toBe(
      '2 egne profiler ud over Standard, som du kan bruge på alle dine bedrifter.',
    )
  })

  it('names the own profiles in one short line', () => {
    expect(describeOwnProfiles([])).toBe('Kun Standard')
    expect(describeOwnProfiles(['Bakkegården 2027'])).toBe('Bakkegården 2027')
    expect(describeOwnProfiles(['Bakkegården 2027', 'Forsigtig 2027'])).toBe(
      'Bakkegården 2027 og Forsigtig 2027',
    )
    expect(
      describeOwnProfiles(['Bakkegården 2027', 'Forsigtig 2027', 'Våd høst']),
    ).toBe('Bakkegården 2027 og 2 mere')
  })
})
