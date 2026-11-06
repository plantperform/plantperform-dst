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

// laterKg: what the years after the first trade, when it differs. The
// payment is the average per year, each year at its direction's price, as a
// run reports it.
const trade = (
  catchmentId: number,
  tradeKg: number,
  laterKg = tradeKg,
  { buy, sell } = { buy: 30, sell: 30 },
): SimulationQuotaTrade => {
  const kgs = ROTATION_CALENDAR_YEARS.map((_, index) =>
    index === 0 ? tradeKg : laterKg,
  )
  return {
    catchmentId,
    catchmentName: null,
    tradeKgByYear: Object.fromEntries(
      ROTATION_CALENDAR_YEARS.map((year, index) => [year, kgs[index]]),
    ),
    buyPriceDkkPerKg: buy,
    sellPriceDkkPerKg: sell,
    sameEachYear: tradeKg === laterKg,
    paymentDkkPerYear:
      kgs.reduce((sum, kg) => sum + kg * (kg > 0 ? buy : sell), 0) / kgs.length,
  }
}

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

  it('marks udledning red over the original kvote, whatever the trade', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N: red even when
    // bought kvote covers it.
    await render([trade(1, 30)])
    expect(overParts()).toBe(1)
    await render([trade(1, 10)])
    expect(overParts()).toBe(1)
    // Opland 2 lets out 40 kg N, under its kvote though over 100 - 70 kg N.
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
    expect(overParts()).toBe(1)
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
  const capLines = () =>
    [...container.querySelectorAll<HTMLElement>('span[data-cap-line]')].map(
      (line) => line.style.bottom,
    )

  // The band drawn in a bar, as a share of the kvote line's height; the
  // legend's swatch has no position.
  const drawnBand = (className: string) => {
    const kvoteLine = container.querySelector<HTMLElement>(
      'span.absolute.border-dashed',
    )
    const band = [
      ...container.querySelectorAll<HTMLElement>(`span.${className}`),
    ].find((span) => span.style.bottom !== '')
    const kvotePct = parseFloat(kvoteLine!.style.bottom)
    return {
      bottom: parseFloat(band!.style.bottom) / kvotePct,
      height: parseFloat(band!.style.height) / kvotePct,
    }
  }

  it('draws a trade from the cap under Grænser, the limit the run traded from', async () => {
    // Opland 1's cap of 150 kg N against its kvote of 100 kg N: 20 kg N sold
    // is drawn from 130 to 150 kg N.
    await render([trade(1, -20)], cap(150))
    const sold = drawnBand('border-emerald-600')
    expect(sold.bottom).toBeCloseTo(1.3)
    expect(sold.height).toBeCloseTo(0.2)
    // 30 kg N bought under a cap of 50 kg N is drawn from 50 to 80 kg N.
    await render([trade(1, 30)], cap(50))
    const bought = drawnBand('border-amber-500')
    expect(bought.bottom).toBeCloseTo(0.5)
    expect(bought.height).toBeCloseTo(0.3)
    // Without a cap, from the kvote.
    await render([trade(1, 30)])
    expect(drawnBand('border-amber-500').bottom).toBeCloseTo(1)
  })

  it('marks udledning red over the kvote, whatever the cap under Grænser', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N: red within a
    // cap of 150 kg N and with 30 kg N bought on top of it.
    await render([trade(1, 30)], cap(150))
    expect(overParts()).toBe(1)
    // Opland 2 lets out 40 kg N, under its kvote: not red, even over a cap
    // of 30 kg N. Only opland 1's bar is.
    await render(undefined, [
      {
        catchmentId: 2,
        maxNLoadByYear: Object.fromEntries(
          ROTATION_CALENDAR_YEARS.map((year) => [year, 30]),
        ),
      },
    ])
    expect(overParts()).toBe(1)
  })

  it('marks a cap under Grænser that differs from the kvote', async () => {
    // Opland 1's cap of 150 kg N sits at 1.5 times the height of its kvote
    // line; opland 2 has no cap of its own.
    await render(undefined, cap(150))
    const kvoteLine = container.querySelector<HTMLElement>(
      'span.absolute.border-dashed',
    )
    expect(capLines()).toHaveLength(1)
    expect(parseFloat(capLines()[0])).toBeCloseTo(
      1.5 * parseFloat(kvoteLine!.style.bottom),
    )
    expect(legend()).toContain('Loft under Grænser')
    // A cap equal to the kvote is not marked.
    await render(undefined, cap(100))
    expect(capLines()).toEqual([])
    expect(legend()).not.toContain('Loft under Grænser')
  })

  it('names each opland’s trade against its kvote for the whole farm', async () => {
    // Opland 2 trades nothing. Under its titled section, with its share of
    // the kvote after the row's own percentage; a cap does not change it.
    await render([trade(1, 30, 60)], cap(150))
    expect(panel()).toContain('KvotehandelKøbt gns. 56 kg N/år+56 %')
    // Opland 2 has no section.
    expect(panel().split('Kvotehandel').length - 1).toBe(1)
    // The selected first year buys 30 kg N of the 100 kg N kvote.
    await render([trade(1, 30, 60)], cap(150), { year: 0 })
    expect(panel()).toContain('KvotehandelKøbt 30 kg N+30 %')
    await render([trade(1, -30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelSolgt 30 kg N−30 %')
    // A year without a trade says so, with no share.
    await render([trade(1, 0, 30)], undefined, { year: 0 })
    expect(panel()).toContain('KvotehandelIngen handel i året')
    expect(panel()).not.toMatch(/[+−]\d+ %/)
  })

  it('shows one opland’s trade, its price and what it costs', async () => {
    await render([trade(1, 30, 60)], cap(150), { scoped: true, year: 0 })
    // The opland's own facts stay beside its trade. Its one year is over the
    // kvote, though bought kvote covers it.
    expect(panel()).toMatch(/Marker1 mark · 10 ha/)
    expect(panel()).toContain('År over kvoten1 af 1')
    expect(panel()).toContain('Kvote pr. ha')
    expect(panel()).toContain('Købt kvote30 kg N (+30 % af kvoten)')
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

  it('measures a trading opland against its kvote, whatever the trade', async () => {
    // Opland 1 lets out 120 kg N against a kvote of 100 kg N: over the kvote
    // even though 30 kg N bought covers it, with the trade shown beside it.
    await render([trade(1, 30)], undefined, { scoped: true, year: 0 })
    expect(panel()).toContain('120 %over kvote')
    expect(panel()).toContain('+30 % købt kvote')
    expect(panel()).toContain('120 af 100 kg N, skal ned med 20 kg N')
    expect(panel()).not.toContain('efter køb')
    // Nor does a cap under Grænser above it change that.
    await render([trade(1, 30)], cap(150), { scoped: true, year: 0 })
    expect(panel()).toContain('120 %over kvote')
    // Selling does not move what is over the kvote either.
    await render([trade(1, -30)], undefined, { scoped: true, year: 0 })
    expect(panel()).toContain('−30 % solgt kvote')
    expect(panel()).toContain('skal ned med 20 kg N')
    expect(panel()).not.toContain('efter salg')
  })

  it('colours each opland in Hele bedriften by its kvote, whatever the trade', async () => {
    const percent = (text: string) =>
      [...container.querySelectorAll('aside span')].find(
        (span) => span.textContent === text,
      )
    // Opland 1 is 120 % of its kvote: red with or without bought kvote.
    await render(undefined, undefined, { year: 0 })
    expect(percent('120 %')?.className).toContain('text-destructive')
    await render([trade(1, 30)], undefined, { year: 0 })
    expect(percent('120 %')?.className).toContain('text-destructive')
    expect(panel()).toContain('+30 %')
  })

  it('prices each year at its direction and averages what the run paid', async () => {
    const prices = { buy: 30, sell: 20 }
    // A year that sells 30 kg N at 20 kr, and one that buys 60 kg N at 30 kr.
    await render([trade(1, -30, 60, prices)], cap(150), {
      scoped: true,
      year: 0,
    })
    expect(panel()).toContain('Pris20 kr/kg N')
    expect(panel()).toContain('Indtægt600 kr')
    await render([trade(1, 60, -30, prices)], cap(150), {
      scoped: true,
      year: 0,
    })
    expect(panel()).toContain('Pris30 kr/kg N')
    expect(panel()).toContain('Udgift1.800 kr')
    // The first year sells and the other seven buy.
    // (7 * 1.800 - 600) / 8 kr, at both prices.
    await render([trade(1, -30, 60, prices)], cap(150), { scoped: true })
    expect(panel()).toContain('Priskøb 30, salg 20 kr/kg N')
    expect(panel()).toContain('Udgift gns. pr. år1.500 kr')
  })

  it('measures each year against the kvote and shows a different cap beside it', async () => {
    // Opland 1 lets out 120 kg N: over its kvote of 100 kg N, though within
    // a cap of 150 kg N set for the year. The cap does not hide it.
    await render(undefined, cap(150), { year: 0 })
    expect(panel()).toContain('120 af 100 kg N')
    expect(panel()).toContain('120 %')
    expect(overParts()).toBe(1)
    // Picked on its own: over the kvote, with the cap named as information.
    await render(undefined, cap(150), { year: 0, scoped: true })
    expect(panel()).toContain('120 %over kvote')
    expect(panel()).toContain('skal ned med 20 kg N')
    expect(panel()).toContain('Loft under Grænser: 150 kg N')
    // A lower cap changes nothing but the information.
    await render(undefined, cap(60), { year: 0, scoped: true })
    expect(panel()).toContain('skal ned med 20 kg N')
    expect(panel()).toContain('Loft under Grænser: 60 kg N')
    // A cap equal to the kvote is not mentioned.
    await render(undefined, cap(100), { year: 0, scoped: true })
    expect(panel()).not.toContain('Loft under Grænser')
  })

  it('stays as before without kvotehandel', async () => {
    await render()
    expect(legend()).not.toContain('Købt kvote')
    expect(legend()).not.toContain('Oprindelig kvote')
    expect(capLines()).toEqual([])
    expect(bands('border-amber-500')).toBe(0)
    expect(overParts()).toBe(1)
    // A single opland keeps its Marker and År over kvoten.
    await render(undefined, undefined, { scoped: true })
    expect(panel()).toMatch(/Marker1 mark · 10 ha/)
    expect(panel()).toContain('År over kvoten1 af 1')
  })
})
