// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { OptimizationRunsProvider } from '@/api/OptimizationRunsProvider'
import { useOptimizationRun, useOptimizationRunsContext } from '@/api/optimization-runs'
import type { Simulation, SimulationResult } from '@/api/types'
import { DEFAULT_SIMULATION_CONSTRAINTS } from '@/lib/simulation-settings'

const api = vi.hoisted(() => ({ fetcher: vi.fn(), view: vi.fn() }))
vi.mock('@/api/client', () => ({ fetcher: api.fetcher, ApiError: class extends Error {} }))
vi.mock('@/api/hooks', () => ({
  fetchSimulationView: api.view,
  simulationsKey: () => '/simulations',
  isSimulationsFieldsKey: () => false,
  isSimulationResultsKey: () => false,
}))
vi.mock('@/api/mutations', () => ({
  runSimulationOptimization: vi.fn(),
  runYearlySimulationOptimization: vi.fn(),
}))
vi.mock('swr', () => ({ mutate: vi.fn().mockResolvedValue(undefined) }))

const active = {
  status: 'in_progress', runId: 'run', kind: 'optimize', parameters: {},
  queuedAt: '2026-10-21T08:42:16Z', fieldsBefore: [], response: null,
} as unknown as SimulationResult
const simulation: Simulation = {
  id: 'sim', farmId: 'farm', result: active,
  revision: 0, name: 'Simulation', createdAt: '2026-10-21',
  constraints: DEFAULT_SIMULATION_CONSTRAINTS,
  rotationVariants: ['1'], nNormPercentages: ['100'],
  fertiliser: { farmingSystem: 'Konventionel', orgMineralN: 0,
    mineralSharePct: 100, onlyOrganic: false, nContentKgPerTon: 6 },
  catchCropSowingDate: '20/8', catchCropDailyBasis: false,
  precisionFarming: false, earlySowing: false, intermediateCrop: false,
}

const Probe = () => {
  const { syncSimulations } = useOptimizationRunsContext()
  useEffect(() => syncSimulations([simulation]), [syncSimulations])
  const run = useOptimizationRun('sim')
  return createElement('p', null, run?.status,
    run?.status === 'failed' ? `: ${run.error}` : '')
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

it('stops showing running when polling returns failure without saved output', async () => {
  api.fetcher.mockResolvedValue(active)
  await act(async () => root.render(
    createElement(OptimizationRunsProvider, { children: createElement(Probe) }),
  ))
  expect(container.textContent).toBe('running')
  api.fetcher.mockResolvedValue({ ...active, status: 'failed',
    error: { code: 'OUT_OF_MEMORY', message: 'Optimeringen løb tør for hukommelse.' } })
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toBe('failed: Optimeringen løb tør for hukommelse.')
  expect(api.view).not.toHaveBeenCalled()
  expect(api.fetcher).toHaveBeenLastCalledWith(
    '/farms/farm/simulations/sim/result?include_output=false',
  )
})
