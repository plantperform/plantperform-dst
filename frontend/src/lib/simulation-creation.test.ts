import { describe, expect, it } from 'vitest'

import type { CreationStatus } from '@/api/types'
import {
  creationRequestIdentity,
  creationStatusLabel,
  isSimulationCreating,
  isSimulationReady,
} from '@/lib/simulation-creation'

const state = (status: CreationStatus) => ({
  creationStatus: status,
})

describe('simulation creation', () => {
  it('keeps existing simulations ready and excludes partial and failed creation', () => {
    expect(isSimulationReady({})).toBe(true)
    expect(isSimulationReady(state('done'))).toBe(true)
    for (const status of ['queued', 'running', 'failed'] as const) {
      expect(isSimulationReady(state(status))).toBe(false)
    }
    expect(isSimulationCreating(state('queued'))).toBe(true)
    expect(isSimulationCreating(state('running'))).toBe(true)
    expect(isSimulationCreating(state('failed'))).toBe(false)
    expect(isSimulationCreating(state('done'))).toBe(false)
  })

  it('shows simple creation status labels', () => {
    expect(creationStatusLabel(state('running'))).toBe('Opretter simulering…')
    expect(creationStatusLabel(state('queued'))).toBe('Opretter simulering…')
    expect(creationStatusLabel(state('failed'))).toBe('Oprettelsen fejlede')
    expect(creationStatusLabel(state('done'))).toBeNull()
  })

  it('reuses a request ID after a lost response and replaces it when the input changes', () => {
    const input = { name: 'new', optimizeOnCreate: true }
    const identity = creationRequestIdentity(input, null)
    expect(creationRequestIdentity({ ...input }, identity)).toBe(identity)
    expect(
      creationRequestIdentity({ ...input, optimizeOnCreate: false }, identity)
        .requestId,
    ).not.toBe(identity.requestId)
    expect(
      creationRequestIdentity(
        { ...input, constraints: { minFeedUnits: 5 } },
        identity,
      ).requestId,
    ).not.toBe(identity.requestId)
  })
})
