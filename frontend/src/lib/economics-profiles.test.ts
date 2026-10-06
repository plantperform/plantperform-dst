import { describe, expect, it } from 'vitest'

import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import {
  NO_PROFILES,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  allProfiles,
  deleteProfileMessage,
  describeEconomicsEntry,
  describeProfileOption,
  parseStoredProfiles,
  profileForSimulation,
  profileNameError,
  sharedProfileNote,
  simulationsUsingProfile,
  withNewProfile,
  withProfileCopy,
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
  })

  it('copies a profile with its changes and remembers where it came from', () => {
    const copied = withProfileCopy(farm, 'careful', 'copy')
    expect(copied.profiles.at(-1)).toEqual({
      id: 'copy',
      name: 'Forsigtig 2027 (kopi)',
      overrides: barleyPrice(125),
      copiedFromId: 'careful',
    })
    expect(
      withProfileCopy(copied, 'careful', 'again').profiles.at(-1)?.name,
    ).toBe('Forsigtig 2027 (kopi) 2')
    expect(withProfileCopy(farm, 'deleted', 'copy')).toEqual(farm)
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

  it('says how many simulations go back to Standard when a profile is deleted', () => {
    expect(deleteProfileMessage(0)).toBe('Ingen simuleringer bruger profilen.')
    expect(deleteProfileMessage(1)).toBe(
      '1 simulering bruger profilen og går tilbage til Standard. Vælg eventuelt en anden profil til den først.',
    )
    expect(deleteProfileMessage(2)).toBe(
      '2 simuleringer bruger profilen og går tilbage til Standard. Vælg eventuelt en anden profil til dem først.',
    )
  })

  it('introduces the economics above the simulations', () => {
    expect(describeEconomicsEntry([])).toEqual({
      title: 'Simuleringerne regner med Standard (SEGES 2026)',
      text: 'Har bedriften en bedre salgsaftale, højere udbytte eller en anden pris hos maskinstationen? Ret de få tal, der betyder mest for dækningsbidraget, og se virkningen her.',
    })
    expect(
      describeEconomicsEntry([
        { name: 'Bakkegården 2027', simulationNames: ['Reduceret kvælstof'] },
      ]),
    ).toEqual({
      title: 'Bedriftens økonomiprofil: Bakkegården 2027',
      text: 'Bakkegården 2027 bruges af Reduceret kvælstof. Indtil profilerne indgår i beregningen, er tallene regnet med Standard.',
    })
    expect(
      describeEconomicsEntry([
        {
          name: 'Bakkegården 2027',
          simulationNames: ['Reduceret kvælstof', 'Mere vintersæd'],
        },
        { name: 'Forsigtig 2027', simulationNames: [] },
      ]),
    ).toEqual({
      title: 'Bedriftens økonomiprofiler: Bakkegården 2027 og Forsigtig 2027',
      text: 'Bakkegården 2027 bruges af Reduceret kvælstof og Mere vintersæd. Forsigtig 2027 bruges af ingen simuleringer endnu. Indtil profilerne indgår i beregningen, er tallene regnet med Standard.',
    })
  })

  it('describes a profile where a simulation chooses it', () => {
    expect(
      describeProfileOption(STANDARD_PROFILE_ID, 0, ['Mere vintersæd']),
    ).toBe('SEGES Budgetkalkuler 2026 · kan ikke rettes')
    expect(describeProfileOption('careful', 3, [])).toBe('3 ændringer')
    expect(
      describeProfileOption('careful', 1, ['Reduceret kvælstof', 'Kopi']),
    ).toBe('1 ændring · bruges af Reduceret kvælstof, Kopi')
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

  it('reads profiles stored before the yield percentage existed', () => {
    const stored = {
      profiles: [
        {
          id: 'careful',
          name: 'Forsigtig 2027',
          overrides: { prices: { 'sale:1': 125 }, quantities: {} },
        },
      ],
      simulationProfileIds: {},
    }
    expect(
      parseStoredProfiles(JSON.stringify(stored)).profiles[0].overrides,
    ).toEqual(barleyPrice(125))
  })

  it('reads what was stored and leaves out what it cannot use', () => {
    expect(parseStoredProfiles(JSON.stringify(farm))).toEqual(farm)
    const withCopy = withProfileCopy(farm, 'careful', 'copy')
    expect(parseStoredProfiles(JSON.stringify(withCopy))).toEqual(withCopy)
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
          ],
          simulationProfileIds: { 'sim-a': 'careful', 'sim-b': 'deleted' },
        }),
      ),
    ).toEqual(farm)
  })
})
