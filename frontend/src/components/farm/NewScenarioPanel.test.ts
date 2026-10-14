// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FieldRecord,
  RotationCategoryOption,
  Simulation,
} from '@/api/types'
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  DEFAULT_SIMULATION_CONSTRAINTS,
} from '@/lib/simulation-settings'
import { NewScenarioPanel } from '@/components/farm/NewScenarioPanel'
import type { StepDialogStep } from '@/components/ui/step-dialog'
import { SIMULATION_FORM_STEPS } from '@/lib/simulation-form'
import type { StartOptimizationRun } from '@/api/optimization-runs'

const queries = vi.hoisted(() => ({
  categories: {
    data: [] as RotationCategoryOption[],
    isLoading: false,
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  },
  create: vi.fn(),
  update: vi.fn(),
  startRun: vi.fn<StartOptimizationRun>(() => 'new-run'),
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
  useRotationCategories: () => queries.categories,
  useRotationNNormPercentages: () => queries.reference,
  useFertiliserPresets: () => queries.reference,
  useCropCodes: () => queries.reference,
  useRotationCandidateOptions: () => queries.reference,
  useFarmEmissions: () => queries.reference,
  simulationViewKey: vi.fn(),
  simulationsKey: vi.fn(),
}))
vi.mock('@/api/optimization-runs', () => ({
  useOptimizationRun: () => undefined,
  useOptimizationRunActions: () => ({ startRun: queries.startRun }),
}))
vi.mock('@/api/mutations', () => ({
  createSimulation: (...args: unknown[]) => queries.create(...args),
  updateSimulation: (...args: unknown[]) => queries.update(...args),
}))
vi.mock('swr', () => ({ mutate: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/components/ui/step-dialog', () => ({
  StepDialog: ({
    title,
    description,
    children,
    actions,
    steps,
    currentIndex,
    onStepSelect,
    secondaryAction,
  }: {
    title: string
    description: string
    children: ReactNode
    actions: ReactNode
    steps: StepDialogStep[]
    currentIndex: number
    onStepSelect: (index: number) => void
    secondaryAction: ReactNode
  }) =>
    createElement(
      'div',
      null,
      title,
      description,
      createElement(
        'nav',
        null,
        steps.map((step, index) =>
          createElement(
            'button',
            {
              key: step.id,
              onClick: () => onStepSelect(index),
              'data-step': step.id,
              'data-status': step.status,
              'aria-current': index === currentIndex ? 'step' : undefined,
            },
            step.label,
          ),
        ),
      ),
      children,
      secondaryAction,
      actions,
    ),
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
    vi.clearAllMocks()
    queries.categories.data = []
    queries.farm.isLoading = false
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

describe('simulation wizard steps', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  const field = {
    ...savedField,
    catchmentId: 1,
    quotaEligible: true,
    nLoadQuotaKgN: 100,
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    queries.categories.data = []
    queries.farm.isLoading = false
    queries.farm.data = [field]
    queries.farm.error = undefined
    queries.stored.error = undefined
    queries.stored.isLoading = false
    queries.stored.isValidating = false
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    queries.update.mockResolvedValue(source)
    queries.create.mockResolvedValue(source)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container.remove()
  })

  const mount = async (simulation: Simulation | null = source, open = true) => {
    await act(async () =>
      root!.render(
        createElement(NewScenarioPanel, {
          farmId: 'farm',
          source: simulation,
          fields: [field],
          open,
          onOpenChange: vi.fn(),
          onSimulationCreated: vi.fn(),
          onError: vi.fn(),
        }),
      ),
    )
  }
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (entry) => entry.textContent === text,
    )
    expect(button, text).toBeDefined()
    await act(async () => button!.click())
  }
  const change = async (label: string, value: string) => {
    const element = [...container.querySelectorAll('label')].find((entry) =>
      entry.textContent?.includes(label),
    )
    const input =
      element?.querySelector('input') ??
      (element?.htmlFor ? document.getElementById(element.htmlFor) : null)
    expect(input, label).toBeDefined()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(input, value)
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const currentStep = () =>
    container.querySelector('[aria-current="step"]')?.textContent

  it('renders six steps and the explanatory quota choice in Grundlag', async () => {
    await mount()
    expect(SIMULATION_FORM_STEPS.map((step) => step.label)).toEqual([
      'Grundlag',
      'Sædskifter',
      'Kvælstof',
      'Dyrkningspraksis',
      'Grænser',
      'Bekræft',
    ])
    expect(container.textContent).toContain(
      'Hvordan skal udledningskvoten gælde?',
    )
    expect(container.textContent).toContain(
      'når et andet ligger tilsvarende under',
    )
    expect(container.textContent).toContain(
      'Sædskifterne kan rykkes i deres cyklus',
    )
    expect(container.textContent).not.toContain('gælder kun kørslen')
    expect(
      container.querySelectorAll(
        'input[type="radio"][name="scenario-quota-mode"]',
      ),
    ).toHaveLength(2)
    expect(
      container
        .querySelector('input[value="optimize"]')
        ?.getAttribute('checked'),
    ).not.toBeNull()
  })

  it('blocks next, step selection and saving when limits are invalid, then clears errors when corrected', async () => {
    await mount()
    await click('Grænser')
    await change('Min. foderenheder', '20')
    await change('Maks. foderenheder', '10')
    await click('Næste')
    expect(currentStep()).toBe('Grænser')
    expect(container.textContent).toContain(
      'Min. foderenheder er større end maks.',
    )
    expect(
      container
        .querySelector('[data-step="limits"]')
        ?.getAttribute('data-status'),
    ).toBe('invalid')
    await click('Bekræft')
    expect(currentStep()).toBe('Grænser')
    await change('Maks. foderenheder', '30')
    expect(container.textContent).not.toContain(
      'Min. foderenheder er større end maks.',
    )
    await click('Næste')
    expect(currentStep()).toBe('Bekræft')
    expect(container.querySelectorAll('input, select')).toHaveLength(0)
    expect(container.textContent).toContain('20 FE')
    await click('Gem')
    expect(queries.update).toHaveBeenCalledOnce()
    expect(queries.update.mock.calls[0][2].constraints).toMatchObject({
      minFeedUnits: 20,
      maxFeedUnits: 30,
    })
  })

  it('returns to invalid saved limits before confirmation', async () => {
    await mount()
    await click('Bekræft')
    // Reopen an existing simulation with invalid settings to exercise final validation.
    await mount({
      ...source,
      revision: 4,
      constraints: {
        ...source.constraints,
        minFeedUnits: 20,
        maxFeedUnits: 10,
      },
    })
    // Backward navigation lets an editor review confirmation, but saving still validates every step.
    await click('Bekræft')
    expect(currentStep()).toBe('Grænser')
    expect(queries.update).not.toHaveBeenCalled()
    expect(queries.startRun).not.toHaveBeenCalled()
  })

  it('keeps both modes’ limits and shows edit links in a read-only confirmation', async () => {
    await mount({
      ...source,
      optimizationSettings: {
        ...DEFAULT_OPTIMIZATION_SETTINGS,
        kind: 'yearly',
        db2SwingPct: 20,
        maxNLoadByCatchment: [{ catchmentId: 1, maxNLoadByYear: {} }],
      },
    })
    await click('Grænser')
    expect(container.textContent).toContain('Maks. udsving i DB2')
    await click('Grundlag')
    await act(async () =>
      (
        container.querySelector('input[value="optimize"]') as HTMLInputElement
      ).click(),
    )
    await click('Grænser')
    expect(container.textContent).toContain('Maks. gennemsnitlig udledning')
    expect(container.textContent).not.toContain('Maks. udsving i DB2')
    await click('Grundlag')
    await act(async () =>
      (
        container.querySelector('input[value="yearly"]') as HTMLInputElement
      ).click(),
    )
    await click('Bekræft')
    expect(container.textContent).toContain('20 %')
    expect(container.textContent).toContain('2027: Ingen grænse')
    expect(container.querySelectorAll('input, select')).toHaveLength(0)
    await act(async () =>
      (
        container.querySelector(
          '[aria-label="Ret Grænser"]',
        ) as HTMLButtonElement
      ).click(),
    )
    expect(currentStep()).toBe('Grænser')
    await click('Bekræft')
    await act(async () =>
      (
        container.querySelector(
          '[aria-label="Ret Grundlag"]',
        ) as HTMLButtonElement
      ).click(),
    )
    expect(currentStep()).toBe('Grundlag')
  })

  it('does not send saved legacy durations when editing and starting a run', async () => {
    const legacy = { ...DEFAULT_OPTIMIZATION_SETTINGS, timeLimitSeconds: 1 }
    const simulation = { ...source, optimizationSettings: legacy }
    queries.update.mockResolvedValue(simulation)
    await mount(simulation)
    await click('Bekræft')
    await click('Kør optimering')
    expect(
      queries.update.mock.calls[0][2].optimizationSettings,
    ).not.toHaveProperty('timeLimitSeconds')
    expect(queries.startRun.mock.calls[0][0].input).not.toHaveProperty(
      'timeLimitSeconds',
    )
  })

  it('disables quota changes during an active run while allowing a name save', async () => {
    await mount({ ...source, result: { ...source.result, status: 'queued' } })
    expect(
      container.querySelector('input[value="yearly"]')?.closest('fieldset')
        ?.disabled,
    ).toBe(true)
    expect(
      (container.querySelector('#scenario-name') as HTMLInputElement).disabled,
    ).toBe(false)
    await click('Gem navn')
    expect(queries.update.mock.calls[0][2]).toEqual({
      expectedRevision: source.revision,
      name: source.name,
    })
  })

  it('creates a new simulation through all six steps', async () => {
    queries.categories.data = [
      {
        category: 'Test',
        croppingSystem: 'Konventionel',
        rotationCount: 1,
        rotations: [
          { rotationVariant: '1', cropSequence: ['Hvede'], activeLen: 1 },
        ],
      },
    ]
    await mount(null)
    await change('Simuleringens navn', 'Ny simulering')
    await click('Næste')
    expect(currentStep()).toBe('Sædskifter')
    await click('Vælg alle')
    await click('Næste')
    expect(currentStep()).toBe('Kvælstof')
    await click('Næste')
    expect(currentStep()).toBe('Dyrkningspraksis')
    await click('Næste')
    expect(currentStep()).toBe('Grænser')
    await click('Næste')
    expect(currentStep()).toBe('Bekræft')
    await click('Gem')
    expect(queries.create).toHaveBeenCalledOnce()
    expect(queries.create.mock.calls[0][1]).toMatchObject({
      name: 'Ny simulering',
      allowedRotationVariants: ['1'],
    })
    expect(
      queries.create.mock.calls[0][1].optimizationSettings,
    ).not.toHaveProperty('timeLimitSeconds')
  })

  it('initializes yearly limits when fields arrive after the quota choice', async () => {
    queries.farm.isLoading = true
    queries.farm.data = []
    const simulation = { ...source, fieldsInitialized: false }
    await mount(simulation)
    await act(async () =>
      (
        container.querySelector('input[value="yearly"]') as HTMLInputElement
      ).click(),
    )
    queries.farm.isLoading = false
    queries.farm.data = [field]
    await mount(simulation)
    await click('Bekræft')
    expect(container.textContent).toContain('2027: 100 kg N')
    await click('Gem')
    expect(
      queries.update.mock.calls[0][2].optimizationSettings
        .maxNLoadByCatchment[0].maxNLoadByYear[2027],
    ).toBe(100)
  })

  it('preserves draft limits on close and reopen', async () => {
    await mount()
    await click('Grænser')
    await change('Min. foderenheder', '20')
    await mount(source, false)
    await mount()
    expect(currentStep()).toBe('Grænser')
    await click('Bekræft')
    expect(container.textContent).toContain('20 FE')
  })

  it('resets a new draft when only the quota choice changed', async () => {
    await mount(null)
    await act(async () =>
      (
        container.querySelector('input[value="yearly"]') as HTMLInputElement
      ).click(),
    )
    await click('Start forfra')
    expect(
      (container.querySelector('input[value="optimize"]') as HTMLInputElement)
        .checked,
    ).toBe(true)
  })
})
