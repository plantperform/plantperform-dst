import { describe, expect, it } from 'vitest'

import { defaultOptimizationRequest } from '@/api/optimization-runs'

describe('defaultOptimizationRequest', () => {
  it('starts the optimization type saved on the simulation', () => {
    expect(defaultOptimizationRequest('yearly')).toEqual({
      kind: 'yearly',
      input: {},
    })
    expect(defaultOptimizationRequest('optimize')).toEqual({
      kind: 'optimize',
      input: {},
    })
  })

  it('starts Gennemsnit for perioden without saved settings', () => {
    expect(defaultOptimizationRequest(undefined)).toEqual({
      kind: 'optimize',
      input: {},
    })
  })
})
