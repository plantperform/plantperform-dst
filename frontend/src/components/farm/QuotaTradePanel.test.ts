// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FieldRecord,
  QuotaValuePoint,
  QuotaValueResult,
  Simulation,
} from '@/api/types'
import { QuotaTradePanel } from '@/components/farm/QuotaTradePanel'

const api = vi.hoisted(() => ({
  results: [] as QuotaValueResult[],
  start: vi.fn(),
}))

vi.mock('@/api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/hooks')>()),
  useQuotaValues: () => ({
    data: api.results,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))
vi.mock('@/api/mutations', () => ({
  startQuotaValue: api.start,
  createQuotaTradeSimulation: vi.fn(),
}))
vi.mock('@/api/optimization-runs', () => ({
  useOptimizationRunActions: () => ({ startRun: vi.fn() }),
}))
vi.mock('@tanstack/charts/react', () => ({ Chart: () => null }))

const field = (
  id: string,
  catchmentId: number,
  nLoadQuotaKgN: number,
  locked = false,
): FieldRecord =>
  ({
    id,
    catchmentId,
    quotaEligible: true,
    nLoadQuotaKgN,
    rotationId: locked ? 'r' : null,
    allowedRotationIds: locked ? ['r'] : [],
  }) as FieldRecord

const fields = [field('a', 103, 20), field('b', 103, 13), field('c', 110, 175)]

const simulation = {
  id: 'sim',
  name: 'Test',
  revision: 3,
  result: { status: 'completed', kind: 'yearly', resultRevision: 3 },
} as Simulation

const point = (tradeKg: number, db2: number): QuotaValuePoint => ({
  tradeKg,
  status: 'OPTIMAL',
  db2,
  db2UpperBound: db2,
  solutionFromTradeKg: null,
  nLoadByYear: { '2027': 30 },
  feedUnitsByYear: { '2027': 0 },
  changedFields: [],
  rotations: [],
})

const completed: QuotaValueResult = {
  catchmentId: 103,
  status: 'completed',
  runId: 'run',
  baseRunId: 'base',
  inputRevision: 3,
  outdated: false,
  priceKrPerKg: 35,
  tradeRange: null,
  queuedAt: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  progress: null,
  output: {
    baseDb2: 1000,
    baseFeedUnitsByYear: {},
    minFeedUnits: null,
    maxFeedUnits: null,
    curve: {
      catchmentId: 103,
      quotaKgN: 33,
      unconstrainedTradeKg: 7,
      minimumPurchaseKg: 0,
      points: [point(0, 1000), point(7, 2000)],
    },
  },
}

const catchmentLabel = (id: number | null) =>
  id === 103 ? 'Als Fjord' : 'Nybøl Nor'

describe('QuotaTradePanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    api.results = []
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container.remove()
  })

  const mount = async () => {
    await act(async () =>
      root!.render(
        createElement(QuotaTradePanel, {
          farmId: 'farm',
          simulation,
          fields,
          catchmentLabel,
          onOpenSimulation: vi.fn(),
          onError: vi.fn(),
        }),
      ),
    )
  }
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((entry) =>
      entry.textContent?.startsWith(text),
    )!
  const typePrice = async (value: string) => {
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('starts the chosen catchment once a price is written', async () => {
    api.start.mockResolvedValue({ ...completed, status: 'queued' })
    await mount()
    expect(container.textContent).toContain(
      'Kvote 33 kg N · 2 kvotegivende markerIkke beregnet endnu',
    )
    expect(button('Beregn kvoteværdi').disabled).toBe(true)

    await typePrice('37,5')
    await act(async () => button('Nybøl Nor').click())
    await act(async () => button('Beregn kvoteværdi').click())

    expect(api.start).toHaveBeenCalledWith(
      'farm',
      'sim',
      expect.objectContaining({
        catchmentId: 110,
        priceKrPerKg: 37.5,
        tradeRange: null,
      }),
    )
  })

  it('says when every mark of a catchment is locked instead of offering a calculation', async () => {
    await act(async () =>
      root!.render(
        createElement(QuotaTradePanel, {
          farmId: 'farm',
          simulation,
          fields: [field('a', 103, 20, true), field('b', 103, 13, true)],
          catchmentLabel,
          onOpenSimulation: vi.fn(),
          onError: vi.fn(),
        }),
      ),
    )
    expect(container.textContent).toContain('Alle marker er låst')
    expect(container.textContent).toContain(
      'Alle 2 kvotegivende marker er låst',
    )
    expect(button('Beregn kvoteværdi')).toBeUndefined()
  })

  it('shows the best trade of a curve and the kvote after the trade', async () => {
    api.results = [completed]
    await mount()
    expect(container.textContent).toContain(
      'Bedst ved 35 kr/kg NKøb 7 kg N/år+755 kr/år',
    )
    expect(container.textContent).toContain('under 142,9 kr')
    expect(container.textContent).toContain('Kvote efter handel, kg N')
    expect(
      [...container.querySelectorAll('tbody td')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2027', '30', '40', '0'])
  })

  it('counts from the least purchase when the catchment must buy', async () => {
    api.results = [
      {
        ...completed,
        output: {
          ...completed.output!,
          curve: {
            ...completed.output!.curve,
            unconstrainedTradeKg: 27,
            minimumPurchaseKg: 20,
            points: [point(20, 1000), point(27, 2000)],
          },
        },
      },
    ]
    await mount()
    expect(container.textContent).toContain(
      'Oplandet skal købe mindst 20 kg N/år for at holde kvoten.',
    )
    expect(container.textContent).toContain(
      'Bedst ved 35 kr/kg NKøb 27 kg N/år+755 kr/år i forhold til mindste køb',
    )
    expect(container.textContent).toContain(
      'Planen kan ikke holde kvoten uden køb',
    )
    expect(
      [...container.querySelectorAll('tbody td')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2027', '30', '60', '0'])
  })
})
