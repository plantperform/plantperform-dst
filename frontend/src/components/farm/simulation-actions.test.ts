// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CreateSimulationInput, Simulation } from '@/api/types'
import { useSimulationActions } from '@/components/farm/simulation-actions'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
} from '@/lib/simulation-settings'

const mocks = vi.hoisted(() => ({
  create:
    vi.fn<
      (farmId: string, input: CreateSimulationInput) => Promise<Simulation>
    >(),
  mutate: vi.fn().mockResolvedValue(undefined),
  startRun: vi.fn(),
  onSelectionChange: vi.fn(),
  onError: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useRotationNNormPercentages: () => ({ data: ['100', '90'] }),
  simulationsKey: (farmId: string) => `/farms/${farmId}/simulations`,
  simulationViewKey: vi.fn(),
}))
vi.mock('@/api/mutations', () => ({
  createSimulation: mocks.create,
  deleteSimulation: vi.fn(),
}))
vi.mock('@/api/optimization-runs', () => ({
  useOptimizationRunActions: () => ({ startRun: mocks.startRun }),
}))
vi.mock('swr', () => ({ mutate: mocks.mutate }))

const source: Simulation = {
  id: 'source',
  farmId: 'farm',
  name: 'Original simulation',
  createdAt: '2026-10-14',
  revision: 3,
  fieldsInitialized: true,
  creationStatus: 'done',
  result: {
    status: 'completed',
    runId: 'source-run',
    kind: 'optimize',
    inputRevision: 3,
    resultRevision: 3,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    error: null,
  },
  constraints: { ...DEFAULT_SIMULATION_CONSTRAINTS, minFeedUnits: 20 },
  optimizationSettings: {
    ...DEFAULT_OPTIMIZATION_SETTINGS,
    excludedCropCodes: [11],
  },
  rotationVariants: ['1'],
  nNormPercentages: ['100', '90'],
  fertiliser: {
    farmingSystem: 'Konventionel',
    orgMineralN: 0,
    mineralSharePct: 100,
    onlyOrganic: false,
    nContentKgPerTon: 6,
  },
  catchCropSowingDate: '20/8',
  catchCropDailyBasis: false,
  precisionFarming: true,
  earlySowing: false,
  intermediateCrop: true,
}

const savedCopy: Simulation = {
  ...source,
  id: 'copy',
  name: `${source.name} (kopi)`,
  revision: 0,
  fieldsInitialized: false,
  result: {
    ...source.result,
    status: 'not_started',
    runId: null,
    kind: null,
    inputRevision: null,
    resultRevision: null,
  },
}

describe('saving simulation copies', () => {
  let root: Root
  let container: HTMLDivElement
  let actions: ReturnType<typeof useSimulationActions>

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    mocks.create.mockResolvedValue(savedCopy)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    function Harness() {
      actions = useSimulationActions({
        farmId: 'farm',
        selection: { kind: 'simulation', id: source.id },
        onSelectionChange: mocks.onSelectionChange,
        onError: mocks.onError,
      })
      return null
    }
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each(['optimize', 'yearly'] as const)(
    'saves and selects a copy in %s mode without starting optimization',
    async (kind) => {
      const settings = { ...source.optimizationSettings!, kind }
      const created = { ...savedCopy, optimizationSettings: settings }
      mocks.create.mockResolvedValue(created)

      await act(async () =>
        actions.copySimulation({ ...source, optimizationSettings: settings }),
      )

      expect(mocks.create).toHaveBeenCalledExactlyOnceWith('farm', {
        name: savedCopy.name,
        requestId: expect.any(String),
        constraints: source.constraints,
        optimizationSettings: settings,
        allowedRotationVariants: source.rotationVariants,
        allowedNNormPercentages: source.nNormPercentages,
        fertiliser: source.fertiliser,
        catchCropSowingDate: source.catchCropSowingDate,
        catchCropDailyBasis: source.catchCropDailyBasis,
        precisionFarming: source.precisionFarming,
        earlySowing: source.earlySowing,
        intermediateCrop: source.intermediateCrop,
      })
      expect(mocks.onSelectionChange).toHaveBeenCalledExactlyOnceWith({
        kind: 'simulation',
        id: created.id,
      })
      const [key, updateCache, options] = mocks.mutate.mock.calls[0]
      expect(key).toBe('/farms/farm/simulations')
      expect(updateCache([source, savedCopy])).toEqual([source, created])
      expect(options).toEqual({ revalidate: false })
      expect(mocks.startRun).not.toHaveBeenCalled()
      expect(mocks.onError).toHaveBeenCalledExactlyOnceWith(null)
      expect(actions.copyingSimulationId).toBeNull()
      expect(created.result.status).toBe('not_started')
      expect(source.result.status).toBe('completed')
    },
  )

  it('reports a failed copy and reuses its request identity when retried', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Connection lost'))

    await act(async () => actions.copySimulation(source))

    expect(mocks.onError).toHaveBeenCalledWith(
      'Kunne ikke starte kopieringen af simuleringen. Prøv igen.',
    )
    expect(mocks.onSelectionChange).not.toHaveBeenCalled()
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(
      '/farms/farm/simulations',
    )
    expect(actions.copyingSimulationId).toBeNull()

    await act(async () => actions.copySimulation(source))

    expect(mocks.create.mock.calls[1][1]).toEqual(mocks.create.mock.calls[0][1])
    expect(mocks.onSelectionChange).toHaveBeenCalledExactlyOnceWith({
      kind: 'simulation',
      id: savedCopy.id,
    })
    expect(mocks.onError).toHaveBeenLastCalledWith(null)
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(actions.copyingSimulationId).toBeNull()
  })
})
