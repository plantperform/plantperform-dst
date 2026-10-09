import { afterEach, describe, expect, it, vi } from 'vitest'

import { retrySimulationCreation } from '@/api/mutations'

afterEach(() => vi.unstubAllGlobals())

describe('creation retry', () => {
  it.each([false, true])(
    'sends the chosen optimization preference: %s',
    async (optimizeOnCreate) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: 'simulation', creationStatus: 'queued', revision: 1 }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      vi.stubGlobal('fetch', fetch)
      const simulation = await retrySimulationCreation('farm', 'simulation', optimizeOnCreate)
      expect(fetch).toHaveBeenCalledWith(
        '/api/v0/farms/farm/simulations/simulation/creation/retry',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ optimizeOnCreate }) }),
      )
      expect(simulation.creationStatus).toBe('queued')
    },
  )

  it('defaults to creation without optimization', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    await retrySimulationCreation('farm', 'simulation')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ optimizeOnCreate: false })
  })
})
