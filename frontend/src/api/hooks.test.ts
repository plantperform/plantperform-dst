import { describe, expect, it } from 'vitest'

import { isSimulationKey, simulationsKey } from '@/api/hooks'
import { simulationViewKey } from '@/api/views'

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
