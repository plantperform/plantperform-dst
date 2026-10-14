import { describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  postJson: vi.fn(),
  patchJson: vi.fn(),
  deleteJson: vi.fn(),
  fetcher: vi.fn(),
}))
vi.mock('@/api/client', () => client)
vi.mock('@/api/hooks', () => ({ registryFieldsBulkKey: vi.fn() }))

import {
  createSimulation,
  updateSimulation,
  runSimulationOptimization,
  runYearlySimulationOptimization,
} from '@/api/mutations'
import {
  optimizationRunRequest,
  type OptimizationRun,
} from '@/api/optimization-runs'
import { DEFAULT_OPTIMIZATION_SETTINGS } from '@/lib/simulation-settings'

describe('supported optimization request fields', () => {
  it('omits legacy durations from create, copy and edit payloads', () => {
    const legacy = {
      ...DEFAULT_OPTIMIZATION_SETTINGS,
      timeLimitSeconds: 1,
      time_limit_seconds: 7200,
    }
    createSimulation('farm', {
      name: 'Created or copied',
      optimizationSettings: legacy,
    })
    expect(client.postJson.mock.lastCall?.[1].optimizationSettings).toEqual(
      DEFAULT_OPTIMIZATION_SETTINGS,
    )
    updateSimulation('farm', 'sim', {
      expectedRevision: 3,
      optimizationSettings: legacy,
    })
    expect(client.patchJson.mock.lastCall?.[1].optimizationSettings).toEqual(
      DEFAULT_OPTIMIZATION_SETTINGS,
    )
  })

  it('omits legacy durations on both start and retry paths while preserving supported options', () => {
    const legacy = {
      expectedRevision: 3,
      runId: 'run',
      excludedCropCodes: [11],
      timeLimitSeconds: 1,
      time_limit_seconds: 7200,
      simulationSettings: {},
      db2SwingPct: 20,
      maxNLoadByCatchment: [{ catchmentId: 1, maxNLoadByYear: { 2027: 100 } }],
    }
    for (const kind of ['optimize', 'yearly'] as const) {
      const run = {
        kind,
        input: legacy,
        id: 'run',
        farmId: 'farm',
        simulationId: 'sim',
        startedAt: 0,
        status: 'failed',
        error: 'Timeout',
        cropAreaViolations: [],
      } as OptimizationRun
      const retry = optimizationRunRequest(run)
      expect(retry.input).not.toHaveProperty('timeLimitSeconds')
      expect(retry.input).not.toHaveProperty('time_limit_seconds')
      expect(retry.input).not.toHaveProperty('simulationSettings')
      const mutation =
        kind === 'yearly'
          ? runYearlySimulationOptimization
          : runSimulationOptimization
      mutation('farm', 'sim', legacy)
      const request = client.postJson.mock.lastCall?.[1]
      expect(request).not.toHaveProperty('timeLimitSeconds')
      expect(request).not.toHaveProperty('time_limit_seconds')
      expect(request.excludedCropCodes).toEqual([11])
      if (kind === 'yearly') {
        expect(request.db2SwingPct).toBe(20)
        expect(request.maxNLoadByCatchment).toEqual(legacy.maxNLoadByCatchment)
      } else expect(request).not.toHaveProperty('db2SwingPct')
    }
  })
})
