import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { CreationStatus } from '@/api/types'
import {
  creationRequestIdentity,
  creationStatusLabel,
  isSimulationCreating,
  isSimulationReady,
  updateOrRecreate,
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
    expect(creationStatusLabel(state('running'))).toBe('Opretter simulering...')
    expect(creationStatusLabel(state('queued'))).toBe('Opretter simulering...')
    expect(creationStatusLabel(state('failed'))).toBe('Oprettelsen fejlede')
    expect(
      creationStatusLabel({
        creationStatus: 'failed',
        economicsRecalculationFailed: true,
      }),
    ).toBe('Genberegningen fejlede')
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

describe('updateOrRecreate', () => {
  const missing = () =>
    Promise.reject(new ApiError(404, 'Simulering ikke fundet'))
  const setup = (update: () => Promise<string>, canRecreate = true) => {
    const create = vi.fn(() => Promise.resolve('created'))
    const onRecreate = vi.fn()
    return {
      create,
      onRecreate,
      run: () => updateOrRecreate({ update, create, canRecreate, onRecreate }),
    }
  }

  it('keeps the update when the simulation still exists', async () => {
    const { create, onRecreate, run } = setup(() => Promise.resolve('updated'))
    await expect(run()).resolves.toBe('updated')
    expect(create).not.toHaveBeenCalled()
    expect(onRecreate).not.toHaveBeenCalled()
  })

  it('creates a new simulation when the saved one was deleted', async () => {
    const { create, onRecreate, run } = setup(missing)
    await expect(run()).resolves.toBe('created')
    expect(onRecreate).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it('does not replace a simulation that is being edited', async () => {
    const { create, onRecreate, run } = setup(missing, false)
    await expect(run()).rejects.toThrow('Simulering ikke fundet')
    expect(create).not.toHaveBeenCalled()
    expect(onRecreate).not.toHaveBeenCalled()
  })

  it('passes other errors on', async () => {
    const { create, run } = setup(() =>
      Promise.reject(new ApiError(409, 'Revisionen er ændret')),
    )
    await expect(run()).rejects.toThrow('Revisionen er ændret')
    expect(create).not.toHaveBeenCalled()
  })
})
