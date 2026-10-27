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

  // year: the selected year's index, or null for all years. scoped: only
  // opland 1, as when it is picked.
  const render = (
    quotaTrades?: SimulationQuotaTrade[],
    quotaCaps?: CatchmentYearlyNLoadCaps[],
    {
      year = null,
      scoped = false,
    }: { year?: number | null; scoped?: boolean } = {},
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
            fields: scoped
              ? [field('a', 1, 120)]
              : [field('a', 1, 120), field('b', 2, 40)],
            selectedYearIndex: year,
            scopeLabel: scoped ? 'Opland 1' : null,
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
  const panel = () =>
    [...container.querySelectorAll('aside')]
      .map((aside) => aside.textContent)
      .join(' ')

  it('marks bought and sold kvote apart from the udledning and names them', async () => {
    await render([trade(1, 30), trade(2, -40)])
    expect(legend()).toContain('Loft før kvotehandel')
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

  // Opland 1's cap under Grænser in every year.
  const cap = (kg: number): CatchmentYearlyNLoadCaps[] => [
    {
      catchmentId: 1,
      maxNLoadByYear: Object.fromEntries(
        ROTATION_CALENDAR_YEARS.map((year) => [year, kg]),
      ),
    },
  ]
  const limitLines = () =>
    [...container.querySelectorAll<HTMLElement>('span[data-limit-line]')].map(
      (line) => line.style.bottom,
    )

  it('measures a trade from the cap under Grænser, not the kvote', async () => {
    // Opland 1 lets out 120 kg N; its kvote is 100 kg N.
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

  it('marks each bar’s limit before the trade at its own cap', async () => {
    // The kvote of 100 kg N sits at 34 % of each bar, so opland 1's cap of
    // 150 kg N sits at 51 %; opland 2 trades nothing and keeps its kvote.
    await render([trade(1, -20)], cap(150))
    expect(limitLines()).toEqual(['51%', '34%'])
    // Without a saved cap, a trading opland's limit is its kvote.
    await render([trade(1, -20)])
    expect(limitLines()).toEqual(['34%', '34%'])
  })

  it('names each opland’s trade against its cap for the whole farm', async () => {
    // A cap of 150 kg N in every year; opland 2 trades nothing.
    // Under its titled section, with its share of the cap after the row's
    // own percentage.
    await render([trade(1, 30, 60)], cap(150))
    expect(panel()).toContain('KvotehandelKøbt gns. 56 kg N/år+38 %')
    // Opland 2 has no section.
    expect(panel().split('Kvotehandel').length - 1).toBe(1)
    // The selected first year buys 30 kg N of the 150 kg N cap.
    await render([trade(1, 30, 60)], cap(150), { year: 0 })
    expect(panel()).toContain('KvotehandelKøbt 30 kg N+20 %')
    await render([trade(1, -30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelSolgt 30 kg N−30 %')
    // A year without a trade says so, with no share.
    await render([trade(1, 0, 30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelIngen handel i året')
    expect(panel()).not.toMatch(/[+−]\d+ %/)
  })

  it('shows one opland’s trade, its price and what it costs', async () => {
    await render([trade(1, 30, 60)], cap(150), { scoped: true, year: 0 })
    expect(panel()).not.toContain('År over kvoten')
    expect(panel()).not.toContain('Marker')
    expect(panel()).toContain('Kvote pr. ha')
    expect(panel()).toContain('Købt kvote30 kg N (+20 % af loftet)')
    expect(panel()).toContain('Pris30 kr/kg N')
    // 30 kg N at 30 kr.
    expect(panel()).toContain('Udgift900 kr')
    // The period's average: seven years of 60 kg N and one of 30 kg N.
    await render([trade(1, 30, 60)], cap(150), { scoped: true })
    expect(panel()).toContain('Købt kvote gns. pr. år56 kg N')
    expect(panel()).toContain('Udgift gns. pr. år1.688 kr')
    // Selling earns.
    await render([trade(1, -30)], undefined, { scoped: true, year: 0 })
    expect(panel()).toContain('Indtægt900 kr')
  })

  it('measures each year against its own limit under Grænser', async () => {
    // Opland 1 lets out 120 kg N: over its kvote of 100 kg N, but within a
    // cap of 150 kg N set for the year.
    await render(undefined, cap(150), { year: 0 })
    expect(panel()).toContain('120 af 150 kg N')
    expect(panel()).toContain('80 %')
    expect(panel()).not.toContain('120 %')
    expect(overParts()).toBe(0)
    // Picked on its own, the summary measures against the same cap.
    await render(undefined, cap(150), { year: 0, scoped: true })
    expect(panel()).toContain('80 %')
    expect(panel()).toContain('30 kg N tilbage')
    // A lower cap makes it over, though it is within its kvote.
    await render(undefined, cap(60), { year: 0, scoped: true })
    expect(panel()).toContain('200 %')
    expect(panel()).toContain('skal ned med 60 kg N')
  })

  it('stays as before without kvotehandel', async () => {
    await render()
    expect(legend()).not.toContain('Købt kvote')
    expect(legend()).not.toContain('Loft før kvotehandel')
    expect(limitLines()).toEqual([])
    expect(bands('border-amber-500')).toBe(0)
    expect(overParts()).toBe(1)
  })
})
