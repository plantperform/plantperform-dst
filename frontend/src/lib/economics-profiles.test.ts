import { describe, expect, it } from 'vitest'

import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import {
  ECONOMICS_INVITATION,
  NO_PROFILES,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  allProfiles,
  deleteProfileMessage,
  describeEconomicsEntry,
  describeProfileOption,
  describeProfileUsers,
  describeStandard,
  parseStoredProfiles,
  profileForSimulation,
  profileNameError,
  sharedProfileNote,
  simulationsUsingProfile,
  withNewProfile,
  withProfileName,
  withProfileOverrides,
  withSimulationProfile,
  withoutProfile,
  type EconomicsProfiles,
} from '@/lib/economics-profiles'

const barleyPrice = (value: number): EconomicsOverrides => ({
  prices: { 'sale:1': value },
  quantities: {},
  yieldPct: {},
})

const farm: EconomicsProfiles = {
  profiles: [
    { id: 'careful', name: 'Forsigtig 2027', overrides: barleyPrice(125) },
    { id: 'machines', name: 'Egen maskinstation', overrides: NO_OVERRIDES },
  ],
  simulationProfileIds: { 'sim-a': 'careful' },
}

describe('economics profiles', () => {
  it('lists Standard first and then the farm profiles', () => {
    expect(allProfiles(farm).map((profile) => profile.name)).toEqual([
      'Standard (SEGES 2026)',
      'Forsigtig 2027',
      'Egen maskinstation',
    ])
    expect(allProfiles(NO_PROFILES)).toEqual([STANDARD_PROFILE])
  })

  it('gives a simulation its linked profile and Standard otherwise', () => {
    expect(profileForSimulation(farm, 'sim-a').id).toBe('careful')
    expect(profileForSimulation(farm, 'sim-b')).toBe(STANDARD_PROFILE)
    expect(
      profileForSimulation(
        { ...farm, simulationProfileIds: { 'sim-c': 'deleted' } },
        'sim-c',
      ),
    ).toBe(STANDARD_PROFILE)
  })

  it('finds the simulations that use a profile, Standard included', () => {
    const simulations = [{ id: 'sim-a' }, { id: 'sim-b' }]
    expect(simulationsUsingProfile(farm, simulations, 'careful')).toEqual([
      { id: 'sim-a' },
    ])
    expect(
      simulationsUsingProfile(farm, simulations, STANDARD_PROFILE_ID),
    ).toEqual([{ id: 'sim-b' }])
    expect(simulationsUsingProfile(farm, simulations, 'machines')).toEqual([])
  })

  it('starts a new profile from Standard with the first free name', () => {
    const first = withNewProfile(farm, 'first', 'Bakkegården 2027')
    expect(first.profiles.at(-1)).toEqual({
      id: 'first',
      name: 'Bakkegården 2027',
      overrides: NO_OVERRIDES,
    })
    const second = withNewProfile(first, 'second', 'Bakkegården 2027')
    expect(second.profiles.at(-1)?.name).toBe('Bakkegården 2027 2')
    expect(
      withNewProfile(second, 'third', 'bakkegården 2027').profiles.at(-1)?.name,
    ).toBe('bakkegården 2027 3')
    expect(withNewProfile(second, 'first', 'Et andet navn')).toBe(second)
  })

  it('wants a name that no other profile on the farm has', () => {
    expect(profileNameError(farm, '   ')).toBe('Giv profilen et navn.')
    expect(profileNameError(farm, ' forsigtig 2027 ')).toBe(
      'Der findes allerede en profil med det navn.',
    )
    expect(profileNameError(farm, 'STANDARD (SEGES 2026)')).toBe(
      'Der findes allerede en profil med det navn.',
    )
    expect(profileNameError(farm, 'Forsigtig 2027', 'careful')).toBeNull()
    expect(profileNameError(farm, 'Optimistisk')).toBeNull()
  })

  it('renames a profile and changes its prices without touching the others', () => {
    const renamed = withProfileName(farm, 'machines', ' Maskinstation ')
    expect(renamed.profiles.map((profile) => profile.name)).toEqual([
      'Forsigtig 2027',
      'Maskinstation',
    ])
    const changed = withProfileOverrides(farm, 'machines', barleyPrice(150))
    expect(changed.profiles[1].overrides).toEqual(barleyPrice(150))
    expect(changed.profiles[0]).toBe(farm.profiles[0])
    expect(
      withProfileOverrides(farm, STANDARD_PROFILE_ID, barleyPrice(150)),
    ).toEqual(farm)
  })

  it('sends the simulations of a deleted profile back to Standard', () => {
    const deleted = withoutProfile(farm, 'careful')
    expect(deleted.profiles.map((profile) => profile.id)).toEqual(['machines'])
    expect(deleted.simulationProfileIds).toEqual({})
    expect(profileForSimulation(deleted, 'sim-a')).toBe(STANDARD_PROFILE)
  })

  it('links a simulation to a farm profile and drops the link for Standard or an unknown profile', () => {
    expect(
      withSimulationProfile(farm, 'sim-b', 'machines').simulationProfileIds,
    ).toEqual({ 'sim-a': 'careful', 'sim-b': 'machines' })
    expect(
      withSimulationProfile(farm, 'sim-a', STANDARD_PROFILE_ID)
        .simulationProfileIds,
    ).toEqual({})
    expect(
      withSimulationProfile(farm, 'sim-b', 'deleted').simulationProfileIds,
    ).toEqual({ 'sim-a': 'careful' })
  })

  it('says which simulations go back to Standard when a profile is deleted', () => {
    expect(deleteProfileMessage([])).toBe(
      'Bruges ikke af nogen simulering endnu.',
    )
    expect(deleteProfileMessage(['Reduceret kvælstof', 'Mere vintersæd'])).toBe(
      'Bruges af Reduceret kvælstof og Mere vintersæd, som går tilbage til Standard (SEGES 2026).',
    )
  })

  it('introduces the economics above the simulations', () => {
    expect(describeEconomicsEntry([])).toEqual({
      title: 'Simuleringerne regner med Standard (SEGES 2026)',
      text: ECONOMICS_INVITATION,
    })
    expect(describeEconomicsEntry(['Bakkegården 2027'])).toEqual({
      title: 'Bedriftens økonomiprofil: Bakkegården 2027',
      text: 'Indtil profilen indgår i beregningen, er tallene regnet med Standard (SEGES 2026).',
    })
    expect(
      describeEconomicsEntry(['Bakkegården 2027', 'Forsigtig 2027']),
    ).toEqual({
      title: 'Bedriftens økonomiprofiler: Bakkegården 2027 og Forsigtig 2027',
      text: 'Indtil profilerne indgår i beregningen, er tallene regnet med Standard (SEGES 2026).',
    })
  })

  it('describes a profile where a simulation chooses it', () => {
    expect(
      describeProfileOption(STANDARD_PROFILE_ID, 0, ['Mere vintersæd']),
    ).toBe('SEGES Budgetkalkuler 2026 · kan ikke rettes')
    expect(describeProfileOption('careful', 3, [])).toBe('3 ændringer')
    expect(
      describeProfileOption('careful', 1, ['Reduceret kvælstof', 'Kopi']),
    ).toBe('1 ændring · bruges af Reduceret kvælstof og Kopi')
  })

  it('names the simulations that use a profile', () => {
    expect(describeProfileUsers([])).toBe(
      'Bruges ikke af nogen simulering endnu',
    )
    expect(describeProfileUsers(['Reduceret kvælstof', 'Kopi'])).toBe(
      'Bruges af Reduceret kvælstof og Kopi',
    )
  })

  it('introduces Standard above the profile cards', () => {
    expect(describeStandard(6, ['Mere vintersæd'])).toBe(
      'Priser og mængder fra SEGES Budgetkalkuler 2026 for 6 afgrøder. Standarden kan ikke rettes, og bedriftens egne profiler måles mod den. Bruges af afgrødehistorikken og Mere vintersæd.',
    )
  })

  it('says that a change reaches every simulation that shares the profile', () => {
    expect(sharedProfileNote(0)).toBeNull()
    expect(sharedProfileNote(1)).toBeNull()
    expect(sharedProfileNote(2)).toBe(
      'En rettelse gælder for begge simuleringer.',
    )
    expect(sharedProfileNote(3)).toBe(
      'En rettelse gælder for alle 3 simuleringer.',
    )
  })

  it('reads what was stored and leaves out what it cannot use', () => {
    expect(parseStoredProfiles(JSON.stringify(farm))).toEqual(farm)
    expect(parseStoredProfiles(null)).toEqual(NO_PROFILES)
    expect(parseStoredProfiles('{not json')).toEqual(NO_PROFILES)
    expect(parseStoredProfiles(JSON.stringify({ profiles: 'none' }))).toEqual(
      NO_PROFILES,
    )
    expect(
      parseStoredProfiles(
        JSON.stringify({
          profiles: [
            ...farm.profiles,
            { id: STANDARD_PROFILE_ID, name: 'Kopi', overrides: NO_OVERRIDES },
            { id: 'broken', name: 'Uden tal' },
          ],
          simulationProfileIds: {
            'sim-a': 'careful',
            'sim-b': 'deleted',
            'sim-c': 'broken',
          },
        }),
      ),
    ).toEqual(farm)
  })
})
