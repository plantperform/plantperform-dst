import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultOptimizationRequest } from '@/api/optimization-runs'

const offer = vi.hoisted(() => ({ periodAverage: true }))

vi.mock('@/lib/optimization-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/optimization-run')>()),
  get PERIOD_AVERAGE_OFFERED() {
    return offer.periodAverage
  },
}))

afterEach(() => {
  offer.periodAverage = true
})

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

  it('starts Loft hvert år while Gennemsnit for perioden is hidden', () => {
    offer.periodAverage = false
    expect(defaultOptimizationRequest('optimize')).toEqual({
      kind: 'yearly',
      input: {},
    })
    expect(defaultOptimizationRequest(undefined)).toEqual({
      kind: 'yearly',
      input: {},
    })
  })
})
