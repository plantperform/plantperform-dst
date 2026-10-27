// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CatchmentYearlyNLoadCaps,
  FieldRecord,
  SimulationQuotaTrade,
} from '@/api/types'
import { YearWalkthrough } from '@/components/farm/YearWalkthrough'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ROTATION_CALENDAR_YEARS,
  type CatchmentTotalsByYear,
} from '@/lib/field-domain'

const field = (id: string, catchmentId: number, nLoad: number) =>
  ({
    id,
    catchmentId,
    quotaEligible: true,
    nLoadQuotaKgN: 100,
    nLoad,
    leaching: nLoad,
    db2: 1_000,
    feedUnits: 0,
    areaHa: 10,
    rotationId: 'rotation',
    cropRotation: [],
    allowedRotationIds: [],
  }) as unknown as FieldRecord

// laterKg: what the years after the first trade, when it differs.
const trade = (
  catchmentId: number,
  tradeKg: number,
  laterKg = tradeKg,
): SimulationQuotaTrade => ({
  catchmentId,
  catchmentName: null,
  tradeKgByYear: Object.fromEntries(
    ROTATION_CALENDAR_YEARS.map((year, index) => [
      year,
      index === 0 ? tradeKg : laterKg,
    ]),
  ),
  priceDkkPerKg: 30,
  sameEachYear: tradeKg === laterKg,
  paymentDkkPerYear: 30 * tradeKg,
})

const yearTotals: CatchmentTotalsByYear = new Map([
  [1, { 1: { nLoadKg: 120, quotaKgN: 100, fieldCount: 1 } }],
  [2, { 1: { nLoadKg: 40, quotaKgN: 100, fieldCount: 1 } }],
])

describe('kvotehandel in the Årsgennemgang', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const render = (
    quotaTrades?: SimulationQuotaTrade[],
    quotaCaps?: CatchmentYearlyNLoadCaps[],
  ) =>
    act(async () =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(YearWalkthrough, {
            entries: [
              {
                year: 1,
                totalNLoadKg: 160,
                totalDb2: 2_000,
                totalFeedUnits: 0,
                fieldCount: 2,
              },
            ],
            loading: false,
            fields: [field('a', 1, 120), field('b', 2, 40)],
            selectedYearIndex: null,
            onSelectedYearIndexChange: vi.fn(),
            catchmentLabel: (id) => `Opland ${id}`,
            catchmentColor: () => 'bg-blue-700',
            lastRun: null,
            collapsed: false,
            catchmentTotalsByYear: yearTotals,
            quotaTrades,
            quotaCaps,
          }),
        ),
      ),
    )
  const bands = (className: string) =>
    container.querySelectorAll(`span.${className}`).length
  // The red top of a bar; the legend's swatch has more classes.
  const overParts = () =>
    container.querySelectorAll('span[class="bg-destructive"]').length
  const legend = () =>
    container.querySelector('section[aria-label="Gennemgang af årrække"]')
      ?.textContent ?? ''

  it('marks bought and sold kvote apart from the udledning and names them', async () => {
    await render([trade(1, 30), trade(2, -40)])
    expect(legend()).toContain('Oprindelig kvote')
    expect(legend()).toContain('Købt kvote')
    expect(legend()).toContain('Solgt kvote')
    // One band in the year's bar and one in the legend, for each kind.
    expect(bands('border-amber-500')).toBe(2)
    expect(bands('border-emerald-600')).toBe(2)
    // The kvote status still measures against the original kvote.
    expect(legend()).toContain('Over kvoten')
  })

  it('names only the kind of trade the run made', async () => {
    await render([trade(1, 30)])
    expect(legend()).toContain('Købt kvote')
    expect(legend()).not.toContain('Solgt kvote')
  })

  it('marks udledning red only over the limit after the trade', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N.
    await render([trade(1, 30)])
    expect(overParts()).toBe(0)
    await render([trade(1, 10)])
    expect(overParts()).toBe(1)
    // Opland 2 lets out 40 kg N, under its kvote but over 100 - 70 kg N.
    await render([trade(1, 30), trade(2, -70)])
    expect(overParts()).toBe(1)
  })

  it('draws each year’s own trade when it differs between years', async () => {
    // The shown first year buys nothing; later years buy 30 kg N.
    await render([trade(1, 0, 30)])
    // The legend names the bought kvote, but the first year has no band.
    expect(legend()).toContain('Købt kvote')
    expect(bands('border-amber-500')).toBe(1)
    expect(overParts()).toBe(1)
    // The first year buys 30 kg N and later years sell.
    await render([trade(1, 30, -20)])
    expect(legend()).toContain('Solgt kvote')
    expect(bands('border-amber-500')).toBe(2)
    expect(overParts()).toBe(0)
  })

  it('measures a trade from the cap under Grænser, not the kvote', async () => {
    // Opland 1 lets out 120 kg N; its kvote is 100 kg N.
    const cap = (kg: number): CatchmentYearlyNLoadCaps[] => [
      {
        catchmentId: 1,
        maxNLoadByYear: Object.fromEntries(
          ROTATION_CALENDAR_YEARS.map((year) => [year, kg]),
        ),
      },
    ]
    // A cap of 150 kg N less 20 kg N sold still covers it.
    await render([trade(1, -20)], cap(150))
    expect(overParts()).toBe(0)
    // Measured from the kvote, the same sale would leave it over.
    await render([trade(1, -20)])
    expect(overParts()).toBe(1)
    // A cap of 50 kg N with 30 kg N bought does not cover it.
    await render([trade(1, 30)], cap(50))
    expect(overParts()).toBe(1)
  })

  it('stays as before without kvotehandel', async () => {
    await render()
    expect(legend()).not.toContain('Købt kvote')
    expect(legend()).not.toContain('Oprindelig kvote')
    expect(bands('border-amber-500')).toBe(0)
    expect(overParts()).toBe(1)
  })
})
