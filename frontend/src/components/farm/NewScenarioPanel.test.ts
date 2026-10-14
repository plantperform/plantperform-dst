import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldRecord, Simulation } from '@/api/types'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
} from '@/lib/simulation-settings'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'

const queries = vi.hoisted(() => ({
  farm: {
    data: [] as FieldRecord[],
    isLoading: false,
    error: undefined as Error | undefined,
    mutate: vi.fn(),
  },
  stored: {
    data: undefined as FieldRecord[] | undefined,
    isLoading: false,
    isValidating: false,
    error: undefined as Error | undefined,
    mutate: vi.fn(),
  },
  storedHook: vi.fn(),
  reference: {
    data: [],
    isLoading: false,
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  },
}))

vi.mock('@/api/hooks', () => ({
  useFarmFields: () => queries.farm,
  useStoredSimulationFields: (...args: unknown[]) => {
    queries.storedHook(...args)
    return queries.stored
  },
  useRotationCategories: () => queries.reference,
  useRotationNNormPercentages: () => queries.reference,
  useFertiliserPresets: () => queries.reference,
  simulationViewKey: vi.fn(),
  simulationsKey: vi.fn(),
}))
vi.mock('@/api/optimization-runs', () => ({
  useOptimizationRun: () => undefined,
  useOptimizationRunActions: () => ({ startRun: vi.fn() }),
}))
vi.mock('@/components/ui/step-dialog', () => ({
  StepDialog: ({
    title,
    description,
    children,
    actions,
  }: {
    title: string
    description: string
    children: ReactNode
    actions: ReactNode
  }) => createElement('div', null, title, description, children, actions),
}))

const savedField = { id: 'saved-field', areaHa: 2 } as FieldRecord
const source: Simulation = {
  id: 'sim',
  farmId: 'farm',
  name: 'Saved simulation',
  createdAt: '2026-10-14',
  revision: 3,
  fieldsInitialized: true,
  creationStatus: 'done',
  result: {
    status: 'not_started',
    runId: null,
    kind: null,
    inputRevision: null,
    resultRevision: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    error: null,
  },
  constraints: DEFAULT_SIMULATION_CONSTRAINTS,
  optimizationSettings: DEFAULT_OPTIMIZATION_SETTINGS,
  rotationVariants: ['1'],
  nNormPercentages: ['100'],
  fertiliser: {
    farmingSystem: 'Konventionel',
    orgMineralN: 0,
    mineralSharePct: 100,
    onlyOrganic: false,
    nContentKgPerTon: 6,
  },
  catchCropSowingDate: '20/8',
  catchCropDailyBasis: false,
  precisionFarming: false,
  earlySowing: false,
  intermediateCrop: false,
}

const render = (simulation = source, fields: FieldRecord[] = []) =>
  renderToStaticMarkup(
    createElement(NewScenarioPanel, {
      farmId: 'farm',
      source: simulation,
      fields,
      open: true,
      onOpenChange: vi.fn(),
      onSimulationCreated: vi.fn(),
      onError: vi.fn(),
    }),
  )

describe('settings without a simulation summary', () => {
  beforeEach(() => {
    queries.farm.data = [{ ...savedField, id: 'farm-field' }]
    queries.farm.error = undefined
    queries.stored.data = undefined
    queries.stored.isLoading = false
    queries.stored.isValidating = false
    queries.stored.error = undefined
    queries.storedHook.mockClear()
  })

  it('loads saved fields while allowing settings to be reviewed', () => {
    queries.stored.isLoading = true
    const html = render()
    expect(queries.storedHook).toHaveBeenCalledWith('farm', 'sim', 3)
    expect(html).toContain('Simuleringens indstillinger')
    expect(html).toContain('Henter simuleringens marker...')
    expect(html).not.toContain('Vælg mindst én mark')
    expect(html).toContain('Simuleringens navn')
  })

  it('uses saved fields independently of farm field errors', () => {
    queries.stored.data = [savedField]
    queries.farm.error = new Error('Farm fields unavailable')
    const html = render()
    expect(html).not.toContain('Kunne ikke hente simuleringens marker.')
    expect(html).not.toContain('Vælg mindst én mark')
  })

  it('shows field-load failures with a read-only retry', () => {
    queries.stored.error = new Error('Saved fields unavailable')
    const html = render()
    expect(html).toContain('Kunne ikke hente simuleringens marker.')
    expect(html).toContain('Prøv igen')
    expect(html).not.toContain('Vælg mindst én mark')
  })

  it('does not replace an empty saved field set with the current farm fields', () => {
    queries.stored.data = []
    expect(render()).toContain('Vælg mindst én mark')
  })

  it('continues using farm fields for simulations that have not initialized fields', () => {
    const html = render({ ...source, fieldsInitialized: false })
    expect(queries.storedHook).toHaveBeenCalledWith(undefined, 'sim', 3)
    expect(html).not.toContain('Vælg mindst én mark')
  })

  it('does not fetch fallback fields when the current summary already supplies them', () => {
    expect(render(source, [savedField])).not.toContain('Vælg mindst én mark')
    expect(queries.storedHook).toHaveBeenCalledWith(undefined, 'sim', 3)
  })
})
