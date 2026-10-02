import { describe, expect, it } from 'vitest'

import { NO_OVERRIDES, type EconomicsOverrides } from '@/lib/economics'
import {
  NO_PROFILES,
  STANDARD_PROFILE,
  STANDARD_PROFILE_ID,
  allProfiles,
  deleteProfileMessage,
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

const barleyPrice = (value: number): EconomicsOverrides => ({
  prices: { 'sale:1': value },
  quantities: {},
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
    const first = withNewProfile(farm, 'first')
    expect(first.profiles.at(-1)).toEqual({
      id: 'first',
      name: 'Ny økonomiprofil',
      overrides: NO_OVERRIDES,
    })
    const second = withNewProfile(first, 'second')
    expect(second.profiles.at(-1)?.name).toBe('Ny økonomiprofil 2')
    expect(withNewProfile(second, 'third').profiles.at(-1)?.name).toBe(
      'Ny økonomiprofil 3',
    )
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
      '1 simulering bruger profilen og går tilbage til Standard.',
    )
    expect(deleteProfileMessage(2)).toBe(
      '2 simuleringer bruger profilen og går tilbage til Standard.',
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
          ],
          simulationProfileIds: { 'sim-a': 'careful', 'sim-b': 'deleted' },
        }),
      ),
    ).toEqual(farm)
  })
})
