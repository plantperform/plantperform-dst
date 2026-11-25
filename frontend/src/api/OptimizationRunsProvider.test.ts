// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  runSimulationOptimization,
  runYearlySimulationOptimization,
  updateSimulation,
} from '@/api/mutations'
import { OptimizationRunsProvider } from '@/api/OptimizationRunsProvider'
import { useOptimizationRun, useOptimizationRunsContext } from '@/api/optimization-runs'
import type { Simulation, SimulationResult } from '@/api/types'
import { OptimizationBanner } from '@/components/farm/OptimizationRunStatus'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
} from '@/lib/simulation-settings'

const offer = vi.hoisted(() => ({ periodAverage: true }))
vi.mock('@/lib/optimization-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/optimization-run')>()),
  get PERIOD_AVERAGE_OFFERED() {
    return offer.periodAverage
  },
}))
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
  updateSimulation: vi.fn(),
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
    mineralSharePct: 100, onlyOrganic: false, nContentKgPerTon: 6,
    organicNCeiling: 107 },
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
  offer.periodAverage = true
})

const startSavedPeriodAverageRun = async () => {
  const saved: Simulation = {
    ...simulation,
    result: { ...active, runId: null },
    revision: 3,
    optimizationSettings: { ...DEFAULT_OPTIMIZATION_SETTINGS, kind: 'optimize' },
  }
  vi.mocked(updateSimulation).mockResolvedValue({ ...saved, revision: 4 })
  vi.mocked(runSimulationOptimization).mockReturnValue(new Promise(() => {}))
  vi.mocked(runYearlySimulationOptimization).mockReturnValue(new Promise(() => {}))
  const Starter = () => {
    const { syncSimulations, startRun } = useOptimizationRunsContext()
    useEffect(() => {
      syncSimulations([saved])
      startRun({ kind: 'optimize', input: {}, farmId: 'farm', simulationId: 'sim', fieldsBefore: [] })
    }, [syncSimulations, startRun])
    return createElement('p', null, useOptimizationRun('sim')?.kind)
  }
  await act(async () => {
    root.render(createElement(OptimizationRunsProvider, { children: createElement(Starter) }))
    await vi.advanceTimersByTimeAsync(0)
  })
  return saved
}

it('saves Gennemsnit for perioden as Loft hvert år before running while it is hidden', async () => {
  offer.periodAverage = false
  const saved = await startSavedPeriodAverageRun()
  expect(updateSimulation).toHaveBeenCalledWith('farm', 'sim', {
    optimizationSettings: saved.optimizationSettings,
    expectedRevision: 3,
  })
  expect(runYearlySimulationOptimization).toHaveBeenCalledWith(
    'farm', 'sim', expect.objectContaining({ expectedRevision: 4 }),
  )
  expect(runSimulationOptimization).not.toHaveBeenCalled()
  expect(container.textContent).toBe('yearly')
})

it('runs Gennemsnit for perioden as saved while it is offered', async () => {
  await startSavedPeriodAverageRun()
  expect(updateSimulation).not.toHaveBeenCalled()
  expect(runSimulationOptimization).toHaveBeenCalledWith(
    'farm', 'sim', expect.objectContaining({ expectedRevision: 3 }),
  )
  expect(container.textContent).toBe('optimize')
})

it('polls through a large-worker handoff and keeps the original start time', async () => {
  const Inspector = () => {
    const { syncSimulations } = useOptimizationRunsContext()
    useEffect(() => syncSimulations([simulation]), [syncSimulations])
    const run = useOptimizationRun('sim')
    return createElement('div', { 'data-start': run?.startedAt },
      createElement(OptimizationBanner, {
        farmId: 'farm', simulationId: 'sim', optimizationKind: 'optimize',
        run, fields: [], rotationOptionsError: null,
      }))
  }
  api.fetcher.mockResolvedValueOnce(active)
    .mockResolvedValueOnce({ ...active, status: 'queued_large' })
    .mockResolvedValueOnce({ ...active, status: 'in_progress_large' })
  await act(async () => root.render(
    createElement(OptimizationRunsProvider, { children: createElement(Inspector) }),
  ))
  const start = container.firstElementChild?.getAttribute('data-start')

  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('Venter på mere hukommelse')
  await act(async () => vi.advanceTimersByTimeAsync(2000))

  expect(container.textContent).toContain('Kører med mere hukommelse')
  expect(container.firstElementChild?.getAttribute('data-start')).toBe(start)
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

it.each([
  ['INFEASIBLE', 'Ingen mulig løsning', 'Højst 20 ha med afgrødekode 1.'],
  ['NO_SOLUTION_WITHIN_TIME_LIMIT', 'Ingen løsning fundet',
    'Optimeringen fandt ingen løsning, der opfylder reglerne, inden for 1 time.'],
])('restores the %s result banner and opens the rules after reload', async (code, heading, reason) => {
  const saved: SimulationResult = {
    ...active, status: 'infeasible', error: { code, message: reason },
  }
  const onOpenRules = vi.fn()
  api.fetcher.mockResolvedValue(saved)
  const Inspector = () => {
    const { syncSimulations } = useOptimizationRunsContext()
    useEffect(() => syncSimulations([{ ...simulation, result: saved }]), [syncSimulations])
    return createElement(OptimizationBanner, {
      farmId: 'farm', simulationId: 'sim', optimizationKind: 'optimize',
      run: useOptimizationRun('sim'), fields: [], rotationOptionsError: null, onOpenRules,
    })
  }

  await act(async () => root.render(
    createElement(OptimizationRunsProvider, { children: createElement(Inspector) }),
  ))
  await act(async () => vi.advanceTimersByTimeAsync(6000))
  const button = container.querySelector('button')
  await act(async () => button?.click())

  expect(container.textContent).toContain(heading)
  expect(container.textContent).toContain(reason)
  expect(button?.textContent).toBe('Åbn regler')
  expect(onOpenRules).toHaveBeenCalledOnce()
  expect(api.fetcher).toHaveBeenCalledTimes(1)
})
