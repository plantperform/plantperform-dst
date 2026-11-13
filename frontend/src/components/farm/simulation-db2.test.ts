import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OptimizationRun } from '@/api/optimization-runs'
import type {
  Farm,
  FieldRecord,
  SavedResultView,
  Simulation,
  SimulationQuotaTrade,
} from '@/api/types'
import { FarmSidebar } from '@/components/farm/FarmSidebar'
import { OptimizationRunProgress } from '@/components/farm/OptimizationRunProgress'
import { SimulationCard } from '@/components/farm/SimulationCard'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { STANDARD_PROFILE } from '@/lib/economics-profiles'
import {
  emptyMeasures,
  resolveFarmQuota,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import { summarizeOptimizationChanges } from '@/lib/optimization-run'

vi.mock('@/api/hooks', () => ({
  useSimulationFields: () => ({ data: fields }),
  useSimulationView: () => ({ data: { data: { savedResult } } }),
  useFieldYearValues: () => ({ data: {} }),
  useFarmFields: () => ({ data: fields }),
  useFarmEmissions: () => ({ data: [] }),
  useFarmMembers: () => ({ data: [] }),
  useQuotaValues: () => ({ data: undefined }),
}))
vi.mock('@/api/optimization-runs', () => ({
  useOptimizationRun: () => undefined,
}))
vi.mock('@/api/field-aliases', () => ({
  useFieldAliases: () => ({ data: {} }),
}))
vi.mock('@/auth/context', () => ({
  useAuth: () => ({ user: { email: 'test@example.com' } }),
}))
vi.mock('@/components/farm/economics-profiles-state', () => ({
  useEconomicsProfiles: () => ({
    appliedProfile: () => STANDARD_PROFILE,
    ready: true,
    isEconomicsCurrent: () => true,
    ownProfiles: [],
    overviewPath: '/farms/farm/economics',
  }),
}))
// Expose tooltip content in server-rendered markup, without pointer interaction.
vi.mock('@/components/ui/tooltip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/tooltip')>()),
  TooltipContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'tooltip' }, children),
}))

const field = (overrides: Partial<FieldRecord> = {}): FieldRecord => ({
  id: 'field',
  farmId: 'farm',
  imkId: null,
  name: 'Mark 1',
  catchmentId: 1,
  retention: null,
  soilTypeNumber: null,
  cropRotation: [],
  rotationId: 'rotation',
  measures: emptyMeasures(),
  allowedRotationIds: [],
  db2: 100_000,
  nLoad: 100,
  leaching: 100,
  feedUnits: 0,
  areaHa: 10,
  inTakeoutPlan: '',
  nLoadLimitKgNHa: 0,
  nLoadQuotaKgN: 200,
  quotaEligible: true,
  geometry: null,
  ...overrides,
})

const simulation = {
  id: 'sim',
  farmId: 'farm',
  name: 'Simulering',
  createdAt: '2026-11-09',
  result: { runId: 'run', status: 'completed' },
  fertiliser: { farmingSystem: 'Konventionel' },
} as Simulation

const trade = (kg: number): SimulationQuotaTrade => ({
  catchmentId: 1,
  catchmentName: null,
  tradeKgByYear: Object.fromEntries(
    ROTATION_CALENDAR_YEARS.map((year) => [year, kg]),
  ),
  buyPriceDkkPerKg: 50,
  sellPriceDkkPerKg: 50,
  paymentDkkPerYear: kg * 50,
  sameEachYear: true,
})

const saved = (
  trades?: SimulationQuotaTrade[],
  runId = 'run',
): SavedResultView =>
  ({
    runId,
    response: { quotaTrades: trades },
  }) as SavedResultView

let fields: FieldRecord[]
let savedResult: SavedResultView

beforeEach(() => {
  fields = [field()]
  savedResult = saved([trade(-100)])
})

const renderCard = () =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        TooltipProvider,
        null,
        createElement(SimulationCard, {
          farmId: 'farm',
          simulation,
          liveFields: fields,
          history: resolveFarmQuota(fields, false),
          active: false,
          copying: false,
          deleting: false,
          onOpen: vi.fn(),
          onCopy: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    ),
  )

const renderSidebar = () =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        SidebarProvider,
        null,
        createElement(FarmSidebar, {
          farm: { id: 'farm', name: 'Farm' } as Farm,
          fields,
          simulations: [simulation],
          selection: { kind: 'simulation', id: 'sim' },
          overviewActive: true,
          economicsPageActive: false,
          ownRotationsActive: false,
          aboutActive: false,
          mode: 'values',
          view: 'list',
          splitAvailable: false,
          copyingSimulationId: null,
          deletingSimulationId: null,
          recalculatingHistory: false,
          width: 300,
          onSelectionChange: vi.fn(),
          onModeChange: vi.fn(),
          onOptimize: vi.fn(),
          onViewChange: vi.fn(),
          onCopySimulation: vi.fn(),
          onDeleteSimulation: vi.fn(),
          onNewSimulation: vi.fn(),
          onRecalculateHistory: vi.fn(),
          onWidthChange: vi.fn(),
        }),
      ),
    ),
  )

const succeededRun = (
  trades: SimulationQuotaTrade[] | undefined = [trade(-100)],
  before: FieldRecord[] = fields,
): Extract<OptimizationRun, { status: 'succeeded' }> => ({
  id: 'run',
  farmId: 'farm',
  simulationId: 'sim',
  startedAt: 0,
  finishedAt: 1_000,
  kind: 'yearly',
  input: {},
  status: 'succeeded',
  refreshing: false,
  response: {
    status: 'OPTIMAL',
    objectiveDb2: 100_000,
    totalNLoadKg: 100,
    totalLeachingKg: 100,
    totalFeedUnits: 0,
    fields,
    assignments: [],
    quotaTrades: trades,
  },
  changes: summarizeOptimizationChanges(before, fields),
})

describe('simulation DB2 summaries', () => {
  it('includes sales income in the main card figure and total', () => {
    const html = renderCard()

    expect(html).toMatch(
      /Dækningsbidrag pr. år inkl. kvotehandel<\/p><p[^>]*>10.500 kr\/ha<\/p><p[^>]*>105 t.kr i alt/,
    )
  })

  it('includes purchase costs in the main card figure and total', () => {
    savedResult = saved([trade(100)])

    const html = renderCard()

    expect(html).toMatch(
      /Dækningsbidrag pr. år inkl. kvotehandel<\/p><p[^>]*>9.500 kr\/ha<\/p><p[^>]*>95 t.kr i alt/,
    )
  })

  it('keeps the trading contribution separate from the main net result', () => {
    const html = renderCard()

    expect(html).toMatch(
      /Kvotehandel pr. år<\/p><p[^>]*>\+500 kr\/ha<\/p><p[^>]*>\+5.000 kr i alt/,
    )
  })

  it.each([
    { name: 'legacy result', result: () => saved() },
    { name: 'different run', result: () => saved([trade(-100)], 'older-run') },
  ])('keeps crop DB2 for a $name', ({ result }) => {
    savedResult = result()

    const html = renderCard()

    expect(html).toMatch(
      /Dækningsbidrag pr. år<\/p><p[^>]*>10.000 kr\/ha<\/p><p[^>]*>100 t.kr i alt/,
    )
    expect(html).not.toContain('inkl. kvotehandel')
  })

  it('uses only the economics area for the net per-hectare result', () => {
    fields.push(
      field({ id: 'no-economics', areaHa: 5, economicsMissing: true, db2: 0 }),
    )

    const html = renderCard()

    expect(html).toContain('10.500 kr/ha')
  })

  it('keeps the sidebar’s short net result free of trade labels', () => {
    const html = renderSidebar()

    expect(html).toContain('10.500 kr/ha</span>')
  })

  it('shows the sidebar’s net total in its tooltip', () => {
    const html = renderSidebar()

    expect(html).toContain('DB2 inkl. kvotehandel 105.000 kr i alt')
  })

  it('shows the sidebar’s crop result when the saved trades belong to a different run', () => {
    savedResult = saved([trade(-100)], 'older-run')

    const html = renderSidebar()

    expect(html).toContain('10.000 kr/ha')
    expect(html).not.toContain('inkl. kvotehandel')
  })
})

describe('yearly optimization completion', () => {
  it('shows the final net result even when rotations are unchanged', () => {
    const run = succeededRun()

    const html = renderToStaticMarkup(
      createElement(OptimizationRunProgress, { run }),
    )

    expect(html).toMatch(
      /DB2 inkl. kvotehandel<\/dt><dd[^>]*>10.500 kr\/ha<span[^>]*>105 t.kr i alt/,
    )
  })

  it('describes unchanged rotations without claiming no other changes', () => {
    const run = succeededRun()

    const html = renderToStaticMarkup(
      createElement(OptimizationRunProgress, { run }),
    )

    expect(html).toContain('Ingen ændringer i sædskifterne.')
  })

  it('omits a DB2 before/after comparison when previous trades are unknown', () => {
    const run = succeededRun(
      [trade(100)],
      [field({ rotationId: 'before', db2: 90_000 })],
    )

    const html = renderToStaticMarkup(
      createElement(OptimizationRunProgress, { run }),
    )
    const db2Row = html.split('DB2 inkl. kvotehandel')[1].split('<dt')[0]

    expect(db2Row).toContain('9.500 kr/ha')
    expect(db2Row).not.toContain('→')
  })

  it('shows the final crop DB2 for legacy yearly runs without trades', () => {
    const run = succeededRun([])
    delete run.response.quotaTrades

    const html = renderToStaticMarkup(
      createElement(OptimizationRunProgress, { run }),
    )

    expect(html).toContain('10.000 kr/ha')
    expect(html).not.toContain('inkl. kvotehandel')
  })

  it('preserves the crop DB2 comparison for average-period optimization', () => {
    const run = {
      ...succeededRun([], [field({ rotationId: 'before', db2: 90_000 })]),
      kind: 'optimize' as const,
    }

    const html = renderToStaticMarkup(
      createElement(OptimizationRunProgress, { run }),
    )

    expect(html).toContain('9.000 kr/ha → 10.000 kr/ha')
  })
})
