import { describe, expect, it } from 'vitest'

import {
  isSimulationKey,
  rotationCandidatesKey,
  simulationsKey,
} from '@/api/hooks'
import { simulationViewKey } from '@/api/views'

describe('rotationCandidatesKey', () => {
  it("asks only for the simulation's sædskifter and N-norm levels", () => {
    expect(rotationCandidatesKey('farm-a', ['1', 'own-1'], ['100', '90'])).toBe(
      '/farms/farm-a/rotation-candidates?saedskiftevarianter=1,own-1&nNormProcenter=100,90',
    )
    expect(rotationCandidatesKey('farm-a', ['1'], [])).toBe(
      '/farms/farm-a/rotation-candidates?saedskiftevarianter=1',
    )
    expect(rotationCandidatesKey('farm-a', [], ['100'])).toBeNull()
    expect(rotationCandidatesKey(undefined, ['1'], ['100'])).toBeNull()
  })
})

describe('isSimulationKey', () => {
  it("matches every farm's simulation lists and views and nothing else", () => {
    expect(isSimulationKey(simulationsKey('farm-a'))).toBe(true)
    expect(isSimulationKey(simulationViewKey('farm-b', 'sim-1'))).toBe(true)
    expect(isSimulationKey('/farms/farm-a/simulations/sim-1/fields')).toBe(
      false,
    )
    expect(isSimulationKey('/economics-modules')).toBe(false)
    expect(isSimulationKey(['simulation-results', 'farm-a'])).toBe(false)
  })
})
